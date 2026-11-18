const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {pathToFileURL}=require('node:url');
const {build}=require('esbuild');
const {mathElements}=require('./test/math-editor-harness.cjs');

function compile(source,name){
  const compiled=new Module(path.resolve(name),module);compiled.paths=module.paths;
  compiled._compile(source,compiled.id);return compiled.exports;
}
const multiply=(a,b)=>[
  a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
  a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5],
];
function transform(source){
  let matrix=[1,0,0,1,0,0];
  for(const match of (source||'').matchAll(/([a-z]+)\(([^)]*)\)/gi)){
    const values=match[2].trim().split(/[\s,]+/).map(Number);let next;
    if(match[1]==='translate')next=[1,0,0,1,values[0],values[1]??0];
    else if(match[1]==='scale')next=[values[0],0,0,values[1]??values[0],0,0];
    else if(match[1]==='matrix')next=values;
    else throw Error('Unmeasured SVG transform: '+match[0]);
    matrix=multiply(matrix,next);
  }
  return matrix;
}

/** Real MathJax SVG geometry, not jsdom/HappyDOM's zero DOM rectangles.
 * A glyph's path plus its complete transform determines its painted bounds.
 * Rules, radical bars and stretched delimiters are measured as well.
 */
function geometry(html,window){
  const parsed=new window.DOMParser().parseFromString(html,'text/html');
  assert.equal(parsed.querySelector('[data-mml-node="merror"]'),null,html);
  const svg=parsed.querySelector('svg');assert.ok(svg,html);
  const painted=[];
  function visit(element,parent){
    if(element.localName==='defs'||element.classList.contains('math-caret'))return;
    const matrix=multiply(parent,transform(element.getAttribute('transform')));
    if(['use','path','rect','line','polygon','polyline','text'].includes(element.localName)){
      const attrs={};
      for(const attr of ['x','y','width','height','x1','y1','x2','y2','points','d','stroke-width'])
        if(element.hasAttribute(attr))attrs[attr]=element.getAttribute(attr);
      if(element.localName==='use'){
        const href=element.getAttribute('xlink:href')||element.getAttribute('href');
        const glyph=parsed.getElementById(href?.slice(1));assert.ok(glyph,'Glyph path must resolve: '+href);
        attrs.d=glyph.getAttribute('d');attrs.character=element.getAttribute('data-c');
      }
      if(element.localName==='text')attrs.text=element.textContent;
      painted.push({kind:element.localName,matrix:matrix.map(value=>Math.round(value*1e6)/1e6),attrs});
    }
    for(const child of element.children)visit(child,matrix);
  }
  visit(svg,[1,0,0,1,0,0]);
  assert.ok(painted.length,'A formula fixture must contain visible geometry');
  return {viewBox:svg.getAttribute('viewBox'),width:svg.getAttribute('width'),height:svg.getAttribute('height'),baseline:svg.getAttribute('style'),painted};
}

test('caret movement and selection leave actual MathJax glyph positions and bounds unchanged',async t=>{
  const policyResult=await build({stdin:{contents:"export * from './src/mathjax-extension-policy';export {installUnicodeFonts} from './src/mathjax-unicode-fonts';export {installMathDelimiters} from './src/install-math-delimiters';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false});
  const policy=compile(policyResult.outputFiles[0].text,'.math-caret-policy-test.cjs');
  const url=directory=>pathToFileURL(path.resolve(directory)).href,plain=value=>JSON.parse(JSON.stringify(value));
  const runtime=await require('mathjax').init({
    loader:{paths:{mathjax:url('node_modules/mathjax'),fonts:url('node_modules/@mathjax'),'mathjax-bboldx-extension':url('node_modules/@mathjax/mathjax-bboldx-font-extension')},load:['input/tex','output/chtml','output/svg','[mathjax-newcm]/chtml',...policy.mathJaxExtensionLoads]},
    tex:{packages:{'[+]':plain(policy.mathJaxTexPackages),'[-]':plain(policy.mathJaxDisabledTexPackages)},require:plain(policy.mathJaxRequireOptions),textmacros:{packages:{'[+]':['textcomp']}},tags:'cases',mathStyle:'TeX',mathStyleGreekLC:true,mathStyleMathAlphabets:true},
    svg:{fontCache:'local'},
    startup:{typeset:false,output:'svg',ready(){policy.installUnicodeFonts(globalThis.MathJax._);policy.installMathDelimiters(globalThis.MathJax._);globalThis.MathJax.startup.defaultReady();}},
  });
  assert.ok(runtime,'Local MathJax must initialize');
  const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
  window.document.write('<!doctype html><body><div id="preview"><div id="textFlow"><span id="formula"></span></div><textarea id="mathInput" hidden></textarea></div><div id="mathPanel"><div id="insertToolbar"></div><div class="document-actions"><select id="formulaLayout"></select></div></div><div id="error"></div><div id="pendingFontHint"></div><div id="structureCount"></div></body>');
  for(const key of ['innerWidth','innerHeight','window','document','navigator','sessionStorage','localStorage','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLButtonElement','HTMLDialogElement','Document','DocumentFragment','MutationObserver','ResizeObserver','DOMParser','Range','Event','CustomEvent','KeyboardEvent','ClipboardEvent','DOMRect','HTMLDivElement','HTMLSpanElement','NodeFilter','ShadowRoot'])
    Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
  globalThis.getComputedStyle=window.getComputedStyle.bind(window);window.ready=false;
  globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);
  const result=await build({stdin:{contents:"export {createMathEditor} from './src/editor-ui';export {convertMath} from './src/tex-convert';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'observe-real-region-tex',setup(builder){
    builder.onLoad({filter:/src[\\/]editor-ui\.ts$/},args=>{
      let source=fs.readFileSync(args.path,'utf8');
      if(process.env.MATH_CARET_LAYOUT_REPRO==='1'){
        // Reintroduce the old zero-width TeX caret only in the test bundle.
        // This proves the geometry assertions detect the original regression.
        const before=source;
        source=source.replace("    let tex = '';\n    region.items.forEach((item, i) => {",
          "    const active=isEditing&&region.id===editor.cursor.region,caretTex='\\\\class{math-caret}{\\\\kern0pt}';\n    let tex = '';\n    region.items.forEach((item, i) => {\n      if(active&&editor.cursor.offset===i)tex+=caretTex;");
        source=source.replace('    // A space has no glyph height:',
          '    if(active&&editor.cursor.offset===region.items.length)tex+=caretTex;\n    // A space has no glyph height:');
        assert.notEqual(source,before,'Reproduce the former TeX caret in memory');
      }
      const contents=source.replace('return {initialModel,hooks,connect,openSource,render,notifyLoadFailure,dispose};',
        'return {initialModel,hooks,connect,openSource,render,notifyLoadFailure,dispose,inspect:{regionTex,async prepare(editor:EditorModel){model=editor;await validateChemistry();}}};');
      assert.notEqual(contents,source,'Observe the production region renderer without duplicating it');
      return {contents,loader:'ts',resolveDir:path.dirname(args.path)};
    });
  }}]});
  const api=compile(result.outputFiles[0].text,'.math-caret-layout-test.cjs');
  const editor=api.createMathEditor({elements:mathElements(window)});
  t.after(async()=>{editor.dispose();await window.happyDOM.abort();});
  const render=async source=>{
    runtime.texReset();
    return geometry(runtime.startup.adaptor.outerHTML(await runtime.tex2svgPromise(source,{display:true})),window);
  };
  const samples=[
    ['reported dagger, fences, hat and sans superscript',String.raw`{\left( {T}^{\dagger }\right)}^{2}{\hat{P}}^{\mathsf{T}}`],
    ['single letter accents with scripts',String.raw`\hat{P}^{T}+\bar{x}_i+\vec{v}^{2}+\tilde{a}_n`],
    ['italic correction in scripts',String.raw`T^{\dagger}+f_i+x^{N_{bead}}+P_i^T`],
    ['binary and relation spacing',String.raw`a+b=c-d\leq e+f`],
    ['indexed root inside a fraction',String.raw`\frac{\sqrt[3]{x+1}}{a+\frac{b}{c}}`],
    ['multiline alignment and scripts',String.raw`\begin{aligned}a&=T^{\dagger}+b\\c&=\hat{P}^{T}\end{aligned}`],
    ['matrix and cases',String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}+\begin{cases}x&x>0\\-x&x<0\end{cases}`],
  ];
  for(const [name,source] of samples)await t.test(name,async()=>{
    const model=api.convertMath(source);
    assert.equal([...model.nodes.values()].some(node=>node.type==='source-tex'),false,'Fixture must exercise actual editable structures');
    await editor.inspect.prepare(model);
    const idleTex=editor.inspect.regionTex(model.root,model,false),idle=await render(idleTex),exported=model.exportLatex();
    let states=0,changedInput;
    for(const region of model.regions.values())for(let offset=0;offset<=region.items.length;offset++)for(let anchor=0;anchor<=region.items.length;anchor++){
      model.setCursor(region.id,offset,anchor);
      // setCursor can normalize a structural boundary. Measure the resulting
      // actual cursor, including both directions of every local selection.
      const description=name+' at '+JSON.stringify(model.cursor);
      const activeTex=editor.inspect.regionTex(model.root,model,true),active=await render(activeTex);
      const firstDifference=active.painted.findIndex((glyph,index)=>JSON.stringify(glyph)!==JSON.stringify(idle.painted[index]));
      const summarize=shape=>({viewBox:shape.viewBox,width:shape.width,height:shape.height,baseline:shape.baseline,count:shape.painted.length,
        glyph:firstDifference<0?undefined:{index:firstDifference,character:shape.painted[firstDifference]?.attrs.character,matrix:shape.painted[firstDifference]?.matrix}});
      assert.ok(JSON.stringify(active)===JSON.stringify(idle),
        'Cursor/selection must not move glyphs, stretch rules, change baseline or resize the formula: '+description+'\nExpected '+JSON.stringify(summarize(idle))+'\nActual   '+JSON.stringify(summarize(active)));
      if(activeTex!==idleTex)changedInput??=description;
      assert.equal(model.exportLatex(),exported,'Moving the cursor must not alter mathematical content');states++;
    }
    assert.equal(changedInput,undefined,'Cursor and selection decoration must not enter MathJax input: '+changedInput);
    assert.ok(states>5,'Each fixture must exercise multiple regions or selections');
    t.diagnostic(name+': '+states+' cursor/selection states; '+idle.painted.length+' painted glyphs/rules');
  });
});

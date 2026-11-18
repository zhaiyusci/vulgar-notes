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

test('mathematical color decorations preserve actual glyph positions, sizes and formula geometry',async t=>{
  const policyResult=await build({stdin:{contents:"export * from './src/mathjax-extension-policy';export {installUnicodeFonts} from './src/mathjax-unicode-fonts';export {installMathDelimiters} from './src/install-math-delimiters';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false});
  const policy=compile(policyResult.outputFiles[0].text,'.math-decoration-policy-test.cjs');
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
      const contents=source.replace('return {initialModel,hooks,connect,openSource,render,notifyLoadFailure,dispose};',
        'return {initialModel,hooks,connect,openSource,render,notifyLoadFailure,dispose,inspect:{regionTex,async prepare(editor:EditorModel){model=editor;await validateChemistry();}}};');
      assert.notEqual(contents,source,'Observe the production region renderer without duplicating it');
      return {contents,loader:'ts',resolveDir:path.dirname(args.path)};
    });
  }}]});
  const api=compile(result.outputFiles[0].text,'.math-decoration-layout-test.cjs');
  const editor=api.createMathEditor({elements:mathElements(window)});
  t.after(async()=>{editor.dispose();await window.happyDOM.abort();});
  const render=async source=>{
    runtime.texReset();
    return geometry(runtime.startup.adaptor.outerHTML(await runtime.tex2svgPromise(source,{display:true})),window);
  };

  const samples=[
    ['reported subscript baseline',String.raw`x_2+x_2`,'2'],
    ['superscript baseline',String.raw`x^2+x^2`,'2'],
    ['second-level subscript',String.raw`x_{a_2}+x_{a_2}`,'2'],
    ['second-level superscript',String.raw`x^{a^2}+x^{a^2}`,'2'],
    ['fraction scripts',String.raw`\frac{a_2}{b_2}`,'2'],
    ['fraction inside subscript',String.raw`x_{\frac{2}{3}}+x_{\frac{2}{3}}`,'2'],
    ['root indices',String.raw`\sqrt[2]{x}+\sqrt[2]{x}`,'2'],
    ['root body scripts',String.raw`\sqrt{x_2}+\sqrt{x_2}`,'2'],
    ['binary operator spacing','a+b','+',1],
    ['relation spacing','a=b','=',1],
    ['descriptive text',String.raw`x_{\textnormal{AB}}+x_{\textnormal{AB}}`,null],
  ];
  // Background rectangles are new painted decoration; compare mathematical
  // glyphs, transforms, baseline and outer dimensions. The full transform of
  // each font path catches the earlier bug that width/height-only tests missed.
  const mathematical=shape=>({...shape,painted:shape.painted.filter(item=>item.kind!=='rect')});
  const view=async model=>{
    await editor.inspect.prepare(model);
    const tex=editor.inspect.regionTex(model.root,model,true);
    return {tex,shape:mathematical(await render(tex))};
  };
  for(const [name,source,token,index]of samples)for(const target of ['background','border','combined'])await t.test(name+' '+target,async()=>{
    const model=api.convertMath(source);
    assert.equal([...model.nodes.values()].some(node=>node.type==='source-tex'),false,'The test must use editable structures');
    let selected;
    if(token===null){const text=[...model.nodes.values()].find(node=>node.type==='text-normal');selected=model.parents.get(text.regions[0].id).region;}
    else selected=index===undefined?[...model.regions.values()].find(region=>region.items.length===1&&region.items[0]===token):model.root;
    assert.ok(selected,name+' has a selection');
    model.setCursor(selected.id,(index??0)+1,index??0);
    const before=await view(model);
    if(target==='combined'){assert.equal(model.setColor('#ffff99','background'),true);assert.equal(model.setColor('#00ffff','border'),true);}
    else assert.equal(model.setColor(target==='background'?'#ffff99':'#00ffff',target),true);
    const decoration=[...model.nodes.values()].find(node=>node.type==='math-decoration');assert.ok(decoration);
    const after=await view(model);
    assert.deepEqual(after.shape,before.shape,name+' '+target+' cannot move any glyph, including script baselines');
    for(const offset of [0,decoration.regions[0].items.length]){
      model.setCursor(decoration.regions[0].id,offset);
      const moved=await view(model);assert.equal(moved.tex,after.tex);assert.deepEqual(moved.shape,before.shape);
    }
    model.undo();if(target==='combined')model.undo();
    assert.deepEqual((await view(model)).shape,before.shape,'Undo restores mathematical geometry');
  });
  await t.test('native imported colorbox and fcolorbox retain their real box geometry',async()=>{
    const plain=api.convertMath('x_2+x_2'),reference=await view(plain);
    for(const source of [String.raw`x_{\colorbox{yellow}{$2$}}+x_2`,String.raw`x_{\fcolorbox{cyan}{white}{$2$}}+x_2`]){
      const model=api.convertMath(source),boxed=await view(model);
      assert.ok([...model.nodes.values()].some(node=>['colorbox','fcolorbox'].includes(node.type)));
      assert.equal([...model.nodes.values()].some(node=>node.type==='math-decoration'),false);
      assert.notDeepEqual(boxed.shape.painted,reference.shape.painted,'This fixture detects the original script-baseline shift');
      assert.match(model.exportLatex(),/\f?colorbox/,'Native source is not silently changed to a decoration');
    }
  });
});

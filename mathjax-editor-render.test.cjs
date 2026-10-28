const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {pathToFileURL}=require('node:url');
const {build}=require('esbuild');

test('the actual editor region renderer preserves MathJax alignment and argument lookahead',async t=>{
  // Initialize the actual local MathJax Node loader before adding the DOM used
  // by the editor. There are no network resources or rendering stand-ins.
  const policyBundle=await build({stdin:{contents:"export * from './src/mathjax-extension-policy';export {installUnicodeFonts} from './src/mathjax-unicode-fonts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false});
  const policyModule=new Module(path.resolve('.mathjax-editor-render-policy-test.cjs'),module);policyModule.paths=module.paths;policyModule._compile(policyBundle.outputFiles[0].text,policyModule.id);
  const policy=policyModule.exports,url=directory=>pathToFileURL(path.resolve(directory)).href,plain=value=>JSON.parse(JSON.stringify(value));
  const runtime=await require('mathjax').init({
    loader:{paths:{mathjax:url('node_modules/mathjax'),fonts:url('node_modules/@mathjax'),'mathjax-bboldx-extension':url('node_modules/@mathjax/mathjax-bboldx-font-extension')},load:['input/tex','output/chtml',...policy.mathJaxExtensionLoads]},
    tex:{packages:{'[+]':plain(policy.mathJaxTexPackages),'[-]':plain(policy.mathJaxDisabledTexPackages)},require:plain(policy.mathJaxRequireOptions),textmacros:{packages:{'[+]':['textcomp']}},tags:'cases',mathStyle:'TeX',mathStyleGreekLC:true,mathStyleMathAlphabets:true},
    startup:{typeset:false,output:'chtml',ready(){policy.installUnicodeFonts(globalThis.MathJax._);globalThis.MathJax.startup.defaultReady();}}
  });
  const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
  window.document.write('<!doctype html><html><body><div id="preview"><div id="textFlow"><span id="formula"></span></div><textarea id="mathInput" hidden></textarea></div><div id="mathPanel"><div id="insertToolbar"></div><div class="document-actions"><select id="formulaLayout"></select></div></div><div id="error"></div><div id="pendingFontHint"></div><div id="structureCount"></div></body></html>');
  for(const key of ['innerWidth','innerHeight','window','document','navigator','sessionStorage','localStorage','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLButtonElement','HTMLDialogElement','Document','DocumentFragment','MutationObserver','ResizeObserver','DOMParser','Range','Event','CustomEvent','KeyboardEvent','ClipboardEvent','DOMRect','HTMLDivElement','HTMLSpanElement','NodeFilter','ShadowRoot'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
  globalThis.getComputedStyle=window.getComputedStyle.bind(window);globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);window.ready=false;
  // The browser API returns a native DOM node. Node MathJax's LiteAdaptor
  // returns its own tree instead; parse the actual CHTML into HappyDOM without
  // changing the TeX parser, rendering, errors or the production preflight.
  const chtml=runtime.tex2chtmlPromise.bind(runtime);
  runtime.tex2chtmlPromise=async(...args)=>new DOMParser().parseFromString(runtime.startup.adaptor.outerHTML(await chtml(...args)),'text/html').body.firstElementChild;
  const result=await build({stdin:{contents:"export {regionTex,prepareRegionTex} from './src/editor-ui';export {convertMath} from './src/tex-convert';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'actual-region-renderer-export',setup(builder){
    builder.onLoad({filter:/src[\\/]editor-ui\.ts$/},args=>{
      let source=fs.readFileSync(args.path,'utf8');
      if(process.env.MATHJAX_EDITOR_REPRO_GROUPED_CASES==='1'){
        const before=source;source=source.replace(/  \/\/ A numbered-cases body[\s\S]*?(?=  const descriptive=)/,'');assert.notEqual(source,before,'Reproduce the previous grouped cases-body rendering in memory');
      }
      return {contents:source+'\nexport {regionTex};\nexport async function prepareRegionTex(editor:EditorModel){model=editor;await validateChemistry();}\n',loader:'ts',resolveDir:path.dirname(args.path)};
    });
  }}]});
  const compiled=new Module(path.resolve('.mathjax-editor-render-test.cjs'),module);compiled.paths=module.paths;const originalTimeout=globalThis.setTimeout;
  globalThis.setTimeout=(callback,delay,...args)=>{const timer=originalTimeout(callback,delay,...args);if(delay===10000)timer.unref();return timer;};
  try{compiled._compile(result.outputFiles[0].text,compiled.id);}finally{globalThis.setTimeout=originalTimeout;}
  const api=compiled.exports;
  const samples=[
    ['numbered cases',String.raw`\begin{numcases}{f(x)=}x&positive\\-x&otherwise\end{numcases}`],
    ['subnumbered cases',String.raw`\begin{subnumcases}{f(x)=}\frac{a}{b}&positive\\\sqrt{x}&otherwise\end{subnumcases}`],
    ['numbered cases mixed condition',String.raw`\begin{numcases}{f(x)=}x&if $x\le0$ 中文\\-x&otherwise $x>0$ 其他\end{numcases}`],
    ['subnumbered cases mixed condition',String.raw`\begin{subnumcases}{g(x)=}\frac{a}{b}&if $\alpha\le0$ 中文\\\sqrt{x}&otherwise $x>0$ 其他\end{subnumcases}`],
    ['large operator scripts',String.raw`\sum_{n=0}^{N}a_n`],
    ['operator without limits',String.raw`\sum x+\int f(x)`],
    ['forced operator limits',String.raw`\prod\limits_{n=0}^{N}a_n`],
    ['sideset operator',String.raw`\sideset{_{a}^{b}}{_{c}^{d}}\prod x`],
    ['derivative lookahead',String.raw`\dv[2]{x}{t}`],
    ['partial derivative lookahead',String.raw`\pdv{x}{y}{z}`],
    ['physics nested delimiter',String.raw`\qty(\frac{a}{b}+x)`],
    ['physics inner product',String.raw`\braket{a}{b}`],
    ['physics expectation',String.raw`\expval{\frac{a}{b}}`],
    ['nested fraction and indexed radical',String.raw`\frac{\sqrt[3]{x+1}}{a+\frac{b}{c}}`],
    ['native aligned grid',String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`],
    ['native matrix grid',String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`],
    ['native cases grid',String.raw`\begin{cases}x&x>0\\-x&x<0\end{cases}`],
    ['layout wrappers',String.raw`\mathrel{\frac{a}{b}}+\smash[t]{x}+\phantom{y}`],
    ['mathchoice',String.raw`\mathchoice{a}{b}{c}{d}`],
    ['prescript',String.raw`\prescript{a}{b}{x}`],
    ['descriptive text',String.raw`\textnormal{eq 中文 \% \_}`],
    ['long arrow',String.raw`\xrightarrow[n]{m}`]
  ];
  for(const [name,source] of samples)await t.test(name,async()=>{
    runtime.texReset();const baseline=await runtime.tex2mmlPromise(source,{display:true});assert.doesNotMatch(baseline,/<merror\b/,'The original fixture must be valid MathJax source: '+source+'\n'+baseline);
    const model=api.convertMath(source);assert.equal([...model.nodes.values()].some(node=>node.type==='source-tex'),false,'This sample must exercise native rendering, rather than show escaped source as text: '+source);
    await api.prepareRegionTex(model);
    const rendered=api.regionTex(model.root,model,false);assert.match(rendered,/\\class\{math-region region-/);assert.match(rendered,/\\class\{math-item item-/);
    // tex2mml accepts the math body, whereas the document renderer supplies
    // display delimiters. Retain that actual \[...\] envelope for diagnostics.
    const display='\\['+rendered+'\\]';runtime.texReset();
    const output=await runtime.tex2mmlPromise(display.slice(2,-2),{display:true});
    assert.doesNotMatch(output,/<merror\b/,source+'\n'+display+'\n'+output);
    assert.match(output,/class="[^"]*math-region/,'MathJax must retain the editor region markers');assert.match(output,/class="[^"]*math-item/,'MathJax must retain the editor item markers');
    for(const tag of ['mfrac','msqrt','mroot','msub','msup','msubsup','munder','mover','munderover','mtable','mtr','mlabeledtr','mtd','mmultiscripts','menclose']){
      const pattern=new RegExp('<'+tag+'\\b','g'),count=value=>(value.match(pattern)||[]).length;
      assert.equal(count(output),count(baseline),'Editor class wrappers must preserve the '+tag+' structure of the original source');
    }
    if(name.includes('mixed condition')){
      const tokens=value=>{const result=[],names=new Set(['mi','mn','mo','mtext','ms']),visit=node=>{if(names.has(node.localName))result.push([node.localName,node.textContent]);for(const child of node.children??[])visit(child);};visit(new DOMParser().parseFromString(value,'text/xml').documentElement);return result;};
      assert.deepEqual(tokens(output),tokens(baseline),'Condition spaces, descriptive text and embedded math must retain their actual rendered tokens');
      assert.ok(tokens(output).some(([type,value])=>type==='mo'&&value==='≤'),'The condition contains a rendered mathematical inequality, not the characters of its source');
      assert.ok(tokens(output).some(([type,value])=>type==='mtext'&&value.includes('中文')));assert.ok(tokens(output).some(([type,value])=>type==='mtext'&&/if[\s\u00a0]/.test(value)),'The space after if remains in the text column');
      assert.ok([...model.nodes.values()].some(node=>node.type==='case-text'),'The description has its own raw text representation rather than unsupported source');
      assert.equal(model.exportLatex().replace(/\s*(&|\\\\)\s*/g,'$1'),source.replace(/\s*(&|\\\\)\s*/g,'$1'),'Export preserves embedded-math delimiters and condition text');
    }
    if(name.includes('cases')||name.includes('grid'))assert.match(output,/<mtable\b/,'The alignment remains a table, not flattened text');
  });
  await window.happyDOM.close();
});

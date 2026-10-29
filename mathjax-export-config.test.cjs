const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');

test('HTML export enables the official MathJax menu and registers only its exact formula sources',async t=>{
 const {Window}=await import('happy-dom'),window=new Window({url:'https://example.org/export.html'});
 window.document.write('<!doctype html><body><p id="prose">Literal \\(x^2\\) in ordinary prose.</p><pre>\\alpha</pre><span id="formula"><mjx-container>Static fallback</mjx-container></span></body>');
 const source=String.raw`\begin{equation}\sigma_{\alpha}+\Tr\qty(\frac{x}{y})\end{equation}`;
 const element=window.document.getElementById('formula');element.dataset.exportMathSource=source;
 const result=await build({entryPoints:['src/mathjax-export-config.ts'],bundle:true,write:false,format:'iife',plugins:[{name:'font-shim-probe',setup(builder){
  builder.onLoad({filter:/mathjax-unicode-fonts\.ts$/},()=>({contents:'export function installUnicodeFonts(internals){globalThis.fontShimProbe=internals;}',loader:'ts'}));
 }}]});
 window.eval(result.outputFiles[0].text);
 const config=window.MathJax;
 assert.equal(config.options.enableMenu,true);assert.ok(config.loader.load.includes('ui/menu'));
 assert.equal(config.options.enableSpeech,false);assert.equal(config.options.enableExplorer,false);assert.equal(config.options.enableExplorerHelp,false);
 assert.equal(config.output.font,'mathjax-newcm');assert.deepEqual(JSON.parse(JSON.stringify(config.tex.packages['[+]'].find(value=>Array.isArray(value)&&value[0]==='physics'))),['physics',2]);
 assert.equal(config.startup.typeset,false);assert.ok(config.options.skipHtmlTags.includes('pre'));assert.ok(config.options.skipHtmlTags.includes('mjx-container'));
 let defaultReady=0,defaultPageReady=0;const requests=[];config._={font:'shared-font-internals'};
 config.startup.defaultReady=()=>{defaultReady++;};config.startup.defaultPageReady=async()=>{defaultPageReady++;};
 config.typesetPromise=async elements=>{requests.push(Array.from(elements));for(const formula of elements){assert.equal(formula.textContent,source);const output=window.document.createElement('mjx-container');output.textContent='Native MathItem';formula.replaceChildren(output);}};
 config.startup.ready();assert.equal(defaultReady,1);assert.equal(window.fontShimProbe,config._);
 await config.startup.pageReady();
 assert.equal(defaultPageReady,1);assert.equal(requests.length,1);assert.deepEqual(requests[0],[element]);
 assert.equal(element.textContent,'Native MathItem');assert.equal(element.dataset.exportMathSource,source);
 assert.equal(window.document.getElementById('prose').textContent,'Literal \\(x^2\\) in ordinary prose.');
 assert.equal(window.document.querySelector('pre').textContent,'\\alpha');
 config.typesetPromise=async()=>{throw Error('Font download failed');};config.typesetClear=()=>{};
 await assert.rejects(config.startup.pageReady(),/Font download failed/);assert.equal(element.textContent,'Native MathItem','a failed runtime registration retains the existing static formula');
 assert.equal(window.document.querySelector('dialog,[role="menu"],textarea'),null,'the export does not manufacture its own formula reader or menu');
 await window.happyDOM.abort();
});

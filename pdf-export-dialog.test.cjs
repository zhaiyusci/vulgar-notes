const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const Module=require('node:module');
const path=require('node:path');

test('PDF settings are explicit, preserve cancellation, and prevent duplicate exports',async()=>{
  const {Window}=require('happy-dom'),window=new Window({url:'http://localhost/'});
  const globals=['window','document','navigator','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLButtonElement','Element','Node','NodeFilter','Document','DocumentFragment','MutationObserver','ResizeObserver','Event','CustomEvent','KeyboardEvent','PointerEvent','MouseEvent','DOMRect','getComputedStyle','requestAnimationFrame','cancelAnimationFrame'];
  const before=new Map(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const key of globals)Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?window:typeof window[key]==='function'&&['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(key)?window[key].bind(window):window[key]});
  const React=require('react'),{createRoot}=require('react-dom/client'),{flushSync}=require('react-dom');
  let resolveExport;const result=new Promise(resolve=>{resolveExport=resolve;});
  globalThis.pdfUi={native:false,calls:[],run:render=>{void render();return result;}};
  const bundle=await build({entryPoints:['src/components/ui/pdf-export-dialog.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react-dom','react-dom/client'],plugins:[{name:'pdf-ui-adapters',setup(b){
    const adapters={
      '@/i18n':'export const t=value=>value;',
      '@/pdf-export':'export const nativePdfAvailable=()=>globalThis.pdfUi.native;export const exportPdfDocument=(render,options)=>{globalThis.pdfUi.calls.push(options);return globalThis.pdfUi.run(render,options);};',
    };
    b.onResolve({filter:/.*/},args=>Object.hasOwn(adapters,args.path)?{path:args.path,namespace:'pdf-ui-test'}:undefined);
    b.onLoad({filter:/.*/,namespace:'pdf-ui-test'},args=>({contents:adapters[args.path],loader:'ts'}));
  }}]});
  const mod=new Module(path.resolve('.pdf-ui-test.cjs'),module);mod.filename=mod.id;mod.paths=module.paths;mod._compile(bundle.outputFiles[0].text,mod.id);
  const {PdfExportDialog}=mod.exports,mount=document.createElement('div');document.body.append(mount);
  const root=createRoot(mount),closed=[],rendered=[];
  const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
  const button=label=>[...document.querySelectorAll('button')].find(node=>node.textContent===label);
  const render=()=>flushSync(()=>root.render(React.createElement(PdfExportDialog,{open:true,onOpenChange:value=>closed.push(value),render:async options=>{rendered.push(options);return '<html>print</html>';}})));
  try{
    render();await tick();
    assert.equal(document.querySelector('[aria-label="Paper size"]').value,'a4');
    assert.equal(document.querySelector('[aria-label="Margins (mm)"]').value,'20');
    assert.equal(document.querySelector('input[type=checkbox]').checked,true);
    assert.match(document.body.textContent,/Turn off headers and footers in the browser print settings\./);
    assert.equal(globalThis.pdfUi.calls.length,0,'opening the settings does not start export');
    flushSync(()=>button('Cancel').click());assert.deepEqual(closed,[false]);assert.equal(rendered.length,0);
    for(const [label,value]of [['Paper size','letter'],['Orientation','landscape']]){
      const select=document.querySelector(`[aria-label="${label}"]`);
      flushSync(()=>{select.value=value;select.dispatchEvent(new window.Event('change',{bubbles:true}));});
    }
    flushSync(()=>document.querySelector('input[type=checkbox]').click());
    const form=document.querySelector('form');
    flushSync(()=>form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
    flushSync(()=>form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
    assert.equal(globalThis.pdfUi.calls.length,1);
    assert.deepEqual(globalThis.pdfUi.calls[0],{paper:'letter',landscape:true,marginMm:20,pageNumbers:false});
    assert.deepEqual(rendered,globalThis.pdfUi.calls);
    assert.equal(button('Preparing PDF…').disabled,true);assert.equal(button('Cancel').disabled,true);
    resolveExport(false);await tick();
    assert.deepEqual(closed,[false],'cancelling the native save would leave these settings available');
    assert.equal(button('Print / Save as PDF').disabled,false);
    globalThis.pdfUi.native=true;globalThis.pdfUi.run=async()=>{throw Error('Print failed');};render();
    assert.doesNotMatch(document.body.textContent,/Turn off headers and footers/,'the native exporter controls these settings itself');
    flushSync(()=>form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));await tick();
    assert.equal(document.querySelector('[role="alert"]').textContent,'Print failed');
    assert.equal(button('Save PDF').disabled,false,'failed exports may be retried');
  }finally{
    flushSync(()=>root.unmount());await window.happyDOM.abort();delete globalThis.pdfUi;
    for(const [key,descriptor]of before)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
});

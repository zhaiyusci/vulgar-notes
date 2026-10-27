const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const path=require('node:path');
const code=build({entryPoints:['src/components/ui/document-file-toolbar-buttons.tsx'],bundle:true,write:false,platform:'node',format:'cjs',target:'es2022',jsx:'automatic',external:['react','react/*','react-dom','react-dom/*'],plugins:[{name:'document-toolbar-adapters',setup(b){
 const adapters={
  '@/document-lifecycle':`export const getDocumentState=()=>globalThis.documentToolbarTest.state;export const subscribeDocumentState=listener=>{const s=globalThis.documentToolbarTest;s.listeners.add(listener);return()=>s.listeners.delete(listener);};export const runDocumentCommand=async action=>{globalThis.documentToolbarTest.actions.push(action);};`,
  '@/i18n':'export const t=value=>value;',
  './toolbar':'export const ToolbarButton=({tooltip,...props})=><button type="button" title={tooltip} {...props}/>;',
 };
 b.onResolve({filter:/.*/},args=>Object.hasOwn(adapters,args.path)?{path:args.path,namespace:'document-toolbar-test'}:undefined);
 b.onLoad({filter:/.*/,namespace:'document-toolbar-test'},args=>({contents:adapters[args.path],loader:'tsx',resolveDir:process.cwd()}));
}}]}).then(r=>r.outputFiles[0].text);

test('file toolbar delegates to shared document actions and reflects file/unsaved state',async t=>{
 const {Window}=await import('happy-dom');const window=new Window({url:'http://localhost/vulgar-notes/'});
 for(const key of ['window','document','navigator','Node','Element','HTMLElement','MutationObserver','Event','CustomEvent','MouseEvent','KeyboardEvent'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
 const React=require('react'),{createRoot}=require('react-dom/client'),{flushSync}=require('react-dom');const compiled={exports:{}};new Function('require','module','exports',await code)(require,compiled,compiled.exports);
 const state=globalThis.documentToolbarTest={state:{name:'research.vulgar',dirty:true,busy:false,active:true,sessionId:'specific-document'},actions:[],listeners:new Set()};
 const mount=document.createElement('div');document.body.append(mount);const root=createRoot(mount);flushSync(()=>root.render(React.createElement(compiled.exports.DocumentFileToolbarButtons)));
 t.after(async()=>{flushSync(()=>root.unmount());mount.remove();delete globalThis.documentToolbarTest;await window.happyDOM.abort();});
 const button=name=>mount.querySelector(`button[aria-label="${name}"]`);
 const update=next=>flushSync(()=>{state.state={...state.state,...next};for(const listener of state.listeners)listener();});
 for(const [name,action] of [['Recent documents','home'],['New document','new'],['Open document','open'],['Save document','save'],['Save document as','saveAs']]){
  assert.ok(button(name),name+' must be available');flushSync(()=>button(name).click());assert.equal(state.actions.at(-1),action);
 }
 const status=mount.querySelector('[data-document-status]');assert.equal(status.textContent,'• research.vulgar');assert.equal(status.title,'research.vulgar');assert.equal(status.getAttribute('aria-live'),'polite');
 update({dirty:false,name:'renamed.vulgar'});assert.equal(status.textContent,'renamed.vulgar');assert.equal(status.title,'renamed.vulgar');
 update({busy:true});assert.ok([...mount.querySelectorAll('button')].every(node=>node.disabled));const before=state.actions.length;button('New document').click();assert.equal(state.actions.length,before);
 update({busy:false,active:false,name:'Untitled'});assert.equal(button('Save document').disabled,true);assert.equal(button('Save document as').disabled,true);assert.equal(button('Open document').disabled,false);assert.equal(button('New document').disabled,false);
});

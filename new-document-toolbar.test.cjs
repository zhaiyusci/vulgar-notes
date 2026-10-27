const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const path=require('node:path');

const code=build({
 stdin:{contents:"export {DocumentFileToolbarButtons} from './document-file-toolbar-buttons';export {HostContext} from '@/plate-math-element';",resolveDir:path.resolve('src/components/ui'),loader:'tsx'},
 bundle:true,write:false,platform:'node',format:'cjs',target:'es2022',jsx:'automatic',external:['react','react/*','react-dom','react-dom/*'],
 plugins:[{name:'document-toolbar-adapters',setup(build){
  const adapters={
   '@/plate-math-element':`import{createContext}from'react';export const HostContext=createContext(null);`,
   '@/plate-document':`export const parseDocumentFile=source=>{const data=JSON.parse(source);if(data.version!==1||!Array.isArray(data.value))throw Error('Invalid document format');return data.value;};`,
   '@/platform':`export const defaultDocumentName='document.vulgar';export const documentSessionId=()=>globalThis.documentToolbarTest.sessionId;
     export const newDocumentWindow=()=>{const state=globalThis.documentToolbarTest;state.calls.new++;return state.create();};
     export const confirmReplaceDocument=async()=>{globalThis.documentToolbarTest.calls.confirm++;return true;};
     export const openDocumentFile=async()=>{globalThis.documentToolbarTest.calls.picker++;return null;};
     export const saveDocumentFile=async(source,path,name)=>{const state=globalThis.documentToolbarTest;state.calls.save.push({source,path,name});return state.saveResult;};`,
   '@/i18n':`export const t=value=>value;`,
   './toolbar':`export const ToolbarButton=({tooltip,...props})=><button type="button" title={tooltip} {...props}/>;`,
   'sonner':`export const toast={success:(...args)=>globalThis.documentToolbarTest.calls.success.push(args),error:(...args)=>globalThis.documentToolbarTest.calls.error.push(args)};`,
  };
  build.onResolve({filter:/.*/},args=>Object.hasOwn(adapters,args.path)?{path:args.path,namespace:'document-toolbar-test'}:undefined);
  build.onLoad({filter:/.*/,namespace:'document-toolbar-test'},args=>({contents:adapters[args.path],loader:'tsx',resolveDir:process.cwd()}));
 }}],
}).then(result=>result.outputFiles[0].text);

test('new document toolbar preserves the current document and its save destination',async t=>{
 const {Window}=await import('happy-dom');
 const window=new Window({url:'http://localhost/vulgar-notes/'});
 for(const key of ['window','document','navigator','sessionStorage','Node','Element','HTMLElement','MutationObserver','Event','CustomEvent','MouseEvent','KeyboardEvent'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
 const React=require('react'),{createRoot}=require('react-dom/client'),{flushSync}=require('react-dom');
 const compiled={exports:{}};new Function('require','module','exports',await code)(require,compiled,compiled.exports);
 const api=compiled.exports,tick=()=>new Promise(resolve=>setTimeout(resolve,10));
 const original=JSON.stringify({version:1,value:[{type:'p',children:[{text:'Original saved document'}]}]});
 const edited=JSON.stringify({version:1,value:[{type:'p',children:[{text:'Unsaved text and α'}]}]});
 const originalFile={path:'C:\\notes\\original.vulgar',name:'original.vulgar',baseline:original};
 const id='6fb73c41-018b-4ce0-957b-0123456789ab';
 const metadataKey=sessionId=>'editor.open-document'+(sessionId?':'+sessionId:'');
 const openFixtures=[];
 t.after(async()=>{for(const h of openFixtures)h.close();delete globalThis.documentToolbarTest;await window.happyDOM.abort();});

 function setup({sessionId=null,metadata={},create=()=>Promise.resolve(),host=true}={}){
  sessionStorage.clear();
  for(const [key,value] of Object.entries(metadata))sessionStorage.setItem(key,JSON.stringify(value));
  sessionStorage.setItem('math-plate-document-v1','original draft remains');
  const calls={new:0,persist:0,open:[],mark:[],confirm:0,picker:0,save:[],success:[],error:[]};
  const state=globalThis.documentToolbarTest={sessionId,calls,create,saveResult:{path:'C:\\notes\\new.vulgar',name:'new.vulgar'}};
  const hostValue=host?{persist(){calls.persist++;},serializeDocument(){return edited;},hasUnsavedChanges(){return true;},openDocument(source){calls.open.push(source);},markDocumentSaved(source){calls.mark.push(source);}}:null;
  const mount=document.createElement('div');document.body.append(mount);const root=createRoot(mount);
  flushSync(()=>root.render(React.createElement(api.HostContext.Provider,{value:hostValue},React.createElement(api.DocumentFileToolbarButtons))));
  let closed=false;
  const h={mount,calls,state,button:label=>mount.querySelector('button[aria-label="'+label+'"]'),close(){if(closed)return;closed=true;flushSync(()=>root.unmount());mount.remove();}};
  openFixtures.push(h);return h;
 }
 const click=button=>{assert.ok(button,'the document command must be visible');flushSync(()=>button.click());};
 function shortcut(key,options={}){
  const event=new window.KeyboardEvent('keydown',{key,ctrlKey:true,bubbles:true,cancelable:true,...options});
  flushSync(()=>document.dispatchEvent(event));return event;
 }

 await t.test('New creates a separate editor without replacing unsaved text, baseline or original save path',async()=>{
  const h=setup({metadata:{[metadataKey(null)]:originalFile}}),before=sessionStorage.getItem(metadataKey(null));
  assert.deepEqual(h.calls.mark,[original]);
  click(h.button('New document'));await tick();
  assert.equal(h.calls.new,1);assert.equal(h.calls.persist,1);
  assert.equal(h.calls.open.length,0);assert.equal(h.calls.confirm,0);assert.equal(h.calls.picker,0);
  assert.deepEqual(h.calls.mark,[original],'New must not mark the edited document as saved');
  assert.equal(sessionStorage.getItem(metadataKey(null)),before);
  assert.equal(sessionStorage.getItem('math-plate-document-v1'),'original draft remains');
  click(h.button('Save document'));await tick();
  assert.deepEqual(h.calls.save,[{source:edited,path:originalFile.path,name:originalFile.name}]);h.close();
 });

 await t.test('a new child ignores copied opener metadata and saves as an untitled document',async()=>{
  const h=setup({sessionId:id,metadata:{[metadataKey(null)]:originalFile,[metadataKey('df0ee916-b2a7-4ab4-997c-9876543210ab')]:{...originalFile,path:'C:\\notes\\other.vulgar'}}});
  assert.deepEqual(h.calls.mark,[],'the opener baseline must not become the child baseline');
  click(h.button('Save document'));await tick();
  assert.deepEqual(h.calls.save,[{source:edited,path:undefined,name:'document.vulgar'}]);
  assert.deepEqual(JSON.parse(sessionStorage.getItem(metadataKey(null))),originalFile);
  assert.equal(JSON.parse(sessionStorage.getItem(metadataKey(id))).path,'C:\\notes\\new.vulgar');h.close();
 });

 await t.test('reloading a child restores only that child’s file and baseline',async()=>{
  const childFile={...originalFile,path:'C:\\notes\\child.vulgar',name:'child.vulgar',baseline:edited};
  const h=setup({sessionId:id,metadata:{[metadataKey(null)]:originalFile,[metadataKey(id)]:childFile}});
  assert.deepEqual(h.calls.mark,[edited]);click(h.button('New document'));await tick();click(h.button('Save document'));await tick();
  assert.deepEqual(h.calls.save,[{source:edited,path:childFile.path,name:childFile.name}]);
  assert.deepEqual(JSON.parse(sessionStorage.getItem(metadataKey(null))),originalFile);h.close();
 });

 await t.test('failed window creation reports the failure and permits retry without modifying document state',async()=>{
  const h=setup({metadata:{[metadataKey(null)]:originalFile},create:()=>Promise.reject(Error('Window creation failed'))});
  click(h.button('New document'));await tick();
  assert.equal(h.calls.error.length,1);assert.equal(h.calls.error[0][0],'Unable to create document');
  assert.match(h.calls.error[0][1].description,/Window creation failed/);assert.equal(h.button('New document').disabled,false);
  assert.deepEqual(h.calls.mark,[original]);assert.equal(h.calls.open.length,0);
  h.state.create=()=>Promise.resolve();click(h.button('New document'));await tick();
  assert.equal(h.calls.new,2);assert.equal(h.calls.error.length,1);
  assert.deepEqual(JSON.parse(sessionStorage.getItem(metadataKey(null))),originalFile);h.close();
 });

 await t.test('Ctrl+N creates once while pending and ignores repeat, Shift, Alt and open dialogs',async()=>{
  let finish;const pending=new Promise(resolve=>finish=resolve);
  const h=setup({create:()=>pending});
  assert.equal(shortcut('n').defaultPrevented,true);assert.equal(h.calls.new,1);assert.equal(h.button('New document').disabled,true);
  shortcut('n');shortcut('n',{repeat:true});click(h.button('New document'));assert.equal(h.calls.new,1);
  finish();await tick();assert.equal(h.button('New document').disabled,false);
  shortcut('n',{repeat:true});assert.equal(h.calls.new,1);
  assert.equal(shortcut('n',{shiftKey:true}).defaultPrevented,false);
  assert.equal(shortcut('n',{altKey:true}).defaultPrevented,false);
  const dialog=document.createElement('dialog');dialog.setAttribute('open','');document.body.append(dialog);
  assert.equal(shortcut('n').defaultPrevented,false);assert.equal(h.calls.new,1);dialog.remove();
  assert.equal(shortcut('n',{ctrlKey:false,metaKey:true}).defaultPrevented,true);await tick();assert.equal(h.calls.new,2);h.close();
 });
});

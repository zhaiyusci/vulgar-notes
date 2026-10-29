const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');

const platformAdapters={name:'platform-test-adapters',setup(b){
  b.onResolve({filter:/^@tauri-apps\//},args=>({path:args.path,namespace:'platform-test'}));
  b.onResolve({filter:/^\.\/i18n$/},()=>({path:'i18n',namespace:'platform-test'}));
  b.onLoad({filter:/.*/,namespace:'platform-test'},({path})=>({contents:path==='i18n'
   ?'export const t=value=>value;'
   :path.endsWith('/core')
    ?`export const isTauri=()=>globalThis.platformTest.desktop;export const invoke=async command=>{
       const s=globalThis.platformTest;if(command!=='take_system_document')return;
       s.systemTakes=(s.systemTakes??0)+1;if(s.systemError)throw Error(s.systemError);
       const file=s.systemFile??null;s.systemFile=null;return file;
      };`
    :path.endsWith('/plugin-dialog')
     ?`export const open=async options=>{const s=globalThis.platformTest;s.opens.push(options);return s.openPath;};
       export const save=async options=>{const s=globalThis.platformTest;s.saves.push(options);return s.savePath;};
       export const confirm=async()=>true;`
     :path.endsWith('/webviewWindow')
      ?`export class WebviewWindow {
        constructor(label,options){
         const s=globalThis.platformTest;if(s.windowConstructorError)throw Error(s.windowConstructorError);
         this.label=label;this.options=options;this.listeners=new Map();s.windows.push(this);
         if(s.autoWindowEvent)queueMicrotask(()=>this.emit(s.autoWindowEvent,s.windowError));
        }
        once(name,handler){this.listeners.set(name,handler);return Promise.resolve(()=>this.listeners.delete(name));}
        emit(name,payload){this.listeners.get(name)?.({payload});}
       }`
     :`export const readTextFile=async path=>{const s=globalThis.platformTest;s.reads.push(path);if(s.blocked?.has(path))throw Error('File access denied');if(!(path in s.files))throw Error('File not found');return s.files[path];};
       export const writeFile=async(path,data)=>{globalThis.platformTest.writes.push({path,data});};`,loader:'js'}));
 }};
const source=build({
 entryPoints:['src/platform.ts'],bundle:true,write:false,format:'iife',globalName:'platform',plugins:[platformAdapters],
}).then(result=>result.outputFiles[0].text);
const recentSource=build({stdin:{contents:'export * from "./src/platform";export * from "./src/recent-documents";',resolveDir:__dirname,loader:'ts'},
 bundle:true,write:false,format:'iife',globalName:'platform',plugins:[platformAdapters],
}).then(result=>result.outputFiles[0].text);

async function harness(t,desktop=true,url='http://localhost/',bundle=source){
 const {Window}=await import('happy-dom');
 const window=new Window({url});
 window.document.write('<!doctype html><body></body>');
 const state=window.platformTest={desktop,openPath:null,savePath:null,opens:[],saves:[],reads:[],writes:[],files:{},downloads:[],windows:[],tabs:[],autoWindowEvent:'tauri://created'};
 let uuidCounter=0;
 Object.defineProperty(window,'crypto',{value:{randomUUID:()=>`6b363044-6c9a-4653-a2ba-${String(++uuidCounter).padStart(12,'0')}`},configurable:true});
 window.open=(...args)=>{state.tabs.push(args);return null;};
 window.TextEncoder=TextEncoder;
 window.URL.createObjectURL=blob=>{state.downloadBlob=blob;return 'blob:test-document';};
 window.URL.revokeObjectURL=()=>{};
 window.setTimeout=()=>0;
 window.document.addEventListener('click',event=>{
  if(event.target.tagName==='A'){
   event.preventDefault();state.downloads.push({name:event.target.download,url:event.target.href});
  }
 });
 const reload=async()=>{window.eval(await bundle+'\nwindow.platform=platform;');return window.platform;};
 await reload();
 t.after(()=>window.happyDOM.abort());
 return {window,state,api:window.platform,reload};
}

async function browserSelection(h,file,{cancel=false,bibtex=false}={}){
 const pending=bibtex?h.api.openBibtexFile():h.api.openDocumentFile();
 const input=h.window.document.querySelector('input[type="file"]');
 assert.ok(input,'opening a browser document must create a file picker');
 if(bibtex)assert.match(input.accept,/(?:^|,)\s*\.bib(?:,|$)/i);
 else{
  assert.match(input.accept,/(?:^|,)\s*\.vulgar(?:,|$)/i);
  assert.match(input.accept,/(?:^|,)\s*\.json(?:,|$)/i);
 }
 if(cancel)input.dispatchEvent(new h.window.Event('cancel'));
 else{
  Object.defineProperty(input,'files',{value:file?[file]:[]});
  input.dispatchEvent(new h.window.Event('change'));
 }
 return pending.finally(()=>assert.equal(h.window.document.querySelector('input[type="file"]'),null,'the temporary picker must be removed'));
}

test('desktop opens native and legacy documents case-insensitively with their data and original path',async t=>{
 const h=await harness(t),text='{"version":1,"value":[{"text":"数学"}]}';
 for(const path of ['C:\\notes\\draft.vulgar','C:\\notes\\legacy.JSON','C:\\notes\\DRAFT.VULGAR']){
  h.state.openPath=path;h.state.files[path]=text;
  const opened=await h.api.openDocumentFile();
  assert.equal(opened.path,path);assert.equal(opened.name,path.split('\\').pop());assert.equal(opened.text,text);
 }
 const filters=h.state.opens[0].filters;
 assert.ok(filters.some(filter=>/Vulgar Notes/i.test(filter.name)));
 assert.deepEqual(Array.from(new Set(filters.flatMap(filter=>Array.from(filter.extensions)))).sort(),['json','vulgar']);
 assert.equal(h.state.reads.length,3);
});

test('desktop cancellation and unrelated extensions never read document data',async t=>{
 const h=await harness(t);
 assert.equal(await h.api.openDocumentFile(),null);
 for(const path of ['C:\\notes\\draft.md','C:\\notes\\draft.vulgar.bak','C:\\notes\\draft.json.exe']){
  h.state.openPath=path;await assert.rejects(h.api.openDocumentFile());
 }
 assert.equal(h.state.reads.length,0);
});

test('a native system-open request uses its window-bound file without a second picker',async t=>{
 const h=await harness(t),file={name:'量子 笔记.VULGAR',path:'C:\\论文 文件\\量子 笔记.VULGAR',text:'{"version":1,"value":[]}'};
 h.state.systemFile=file;
 assert.deepEqual(JSON.parse(JSON.stringify(await h.api.takeSystemDocumentFile())),file);
 assert.equal(await h.api.takeSystemDocumentFile(),null,'navigation cannot reopen an already claimed request');
 assert.equal(h.state.systemTakes,2);assert.equal(h.state.opens.length,0);assert.equal(h.state.reads.length,0);
 const web=await harness(t,false);web.state.systemFile=file;
 assert.equal(await web.api.takeSystemDocumentFile(),null);assert.equal(web.state.systemTakes,undefined);
});

test('native system-open failures and invalid payloads remain ordinary open errors',async t=>{
 const h=await harness(t);h.state.systemError='File not found: missing.vulgar';
 await assert.rejects(h.api.takeSystemDocumentFile(),/File not found/);h.state.systemError=null;
 for(const file of [{name:'note.vulgar',text:'{}'},{name:'note.vulgar',path:'C:\\note.vulgar',text:3},{name:'note.md',path:'C:\\note.md',text:'{}'}]){
  h.state.systemFile=file;await assert.rejects(h.api.takeSystemDocumentFile());
 }
 assert.equal(h.state.opens.length,0);assert.equal(h.state.reads.length,0);
});

test('browser opens native and legacy files with their actual JSON contents',async t=>{
 const h=await harness(t,false),text='{"version":1,"value":[{"text":"α 中文"}]}';
 for(const name of ['draft.vulgar','legacy.JSON','DRAFT.VULGAR']){
  const opened=await browserSelection(h,new h.window.File([text],name,{type:'application/json'}));
  assert.equal(opened.name,name);assert.equal(opened.text,text);assert.equal(opened.path,undefined);
 }
});

test('browser cancellation, empty selection and unsupported extensions do not produce a document',async t=>{
 const h=await harness(t,false);
 assert.equal(await browserSelection(h,null,{cancel:true}),null);
 assert.equal(await browserSelection(h,null),null);
 await assert.rejects(browserSelection(h,new h.window.File(['{}'],'draft.md',{type:'application/json'})));
});

test('new desktop saves and Save As use the native suffix and preserve JSON bytes',async t=>{
 const h=await harness(t),text='{"version":1,"value":[{"text":"β 中文"}]}';
 h.state.savePath='C:\\notes\\document.vulgar';
 let saved=await h.api.saveDocumentFile(text);
 assert.equal(saved.name,'document.vulgar');assert.equal(saved.path,h.state.savePath);
 assert.equal(h.state.saves[0].defaultPath,'document.vulgar');
 assert.deepEqual(Array.from(h.state.saves[0].filters.flatMap(filter=>Array.from(filter.extensions))),['vulgar']);
 assert.equal(Buffer.from(h.state.writes[0].data).toString('utf8'),text);
 h.state.savePath='C:\\notes\\legacy.vulgar';
 saved=await h.api.saveDocumentFile(text,undefined,'legacy.JSON');
 assert.equal(h.state.saves[1].defaultPath,'legacy.vulgar');assert.equal(saved.name,'legacy.vulgar');
 assert.equal(Buffer.from(h.state.writes[1].data).toString('utf8'),text);
});

test('direct desktop Save keeps the original native or legacy path without prompting',async t=>{
 const h=await harness(t),text='{"version":1,"value":[]}';
 for(const path of ['C:\\notes\\draft.vulgar','C:\\notes\\DRAFT.VULGAR','C:\\notes\\legacy.JSON']){
  const saved=await h.api.saveDocumentFile(text,path,path.split('\\').pop());
  assert.equal(saved.path,path);assert.equal(h.state.writes.at(-1).path,path);
  assert.equal(Buffer.from(h.state.writes.at(-1).data).toString('utf8'),text);
 }
 assert.equal(h.state.saves.length,0);
});

test('cancelled desktop saves and invalid new file suffixes never write data',async t=>{
 const h=await harness(t);
 assert.equal(await h.api.saveDocumentFile('{}'),null);
 for(const path of ['C:\\notes\\draft','C:\\notes\\draft.md','C:\\notes\\draft.json','C:\\notes\\draft.vulgar.bak']){
  h.state.savePath=path;await assert.rejects(h.api.saveDocumentFile('{}'));
 }
 assert.equal(h.state.writes.length,0);
});

test('browser saves download native files containing the unchanged JSON data',async t=>{
 const h=await harness(t,false),text='{"version":1,"value":[{"text":"正文"}]}';
 for(const [name,expected] of [[undefined,'document.vulgar'],['legacy.JSON','legacy.vulgar'],['draft.vulgar','draft.vulgar']]){
  const saved=await h.api.saveDocumentFile(text,undefined,name);
  assert.equal(saved.name,expected);assert.equal(saved.path,undefined);
  assert.equal(h.state.downloads.at(-1).name,expected);
  assert.equal(await h.state.downloadBlob.text(),text);
  assert.match(h.state.downloadBlob.type,/^application\/json/);
  assert.equal(h.window.document.querySelector('a'),null,'temporary download links must be removed');
 }
});

test('desktop bibliography picker is separate from native document opening and preserves BibTeX source',async t=>{
 const h=await harness(t),source='@article{paper, title={中文 and {LaTeX}}, year={2026}}';
 h.state.openPath='C:\\notes\\library.BIB';h.state.files[h.state.openPath]=source;
 const opened=await h.api.openBibtexFile();
 assert.equal(opened.name,'library.BIB');assert.equal(opened.text,source);
 assert.deepEqual(Array.from(h.state.opens[0].filters[0].extensions),['bib']);
 await assert.rejects(h.api.openDocumentFile());
 h.state.openPath='C:\\notes\\document.vulgar';await assert.rejects(h.api.openBibtexFile());
 assert.equal(h.state.reads.length,1);
 h.state.openPath=null;assert.equal(await h.api.openBibtexFile(),null);
});

test('browser bibliography picker accepts .bib only and cleans up after selection or cancellation',async t=>{
 const h=await harness(t,false),source='@book{2026/key, title={A book}}';
 const opened=await browserSelection(h,new h.window.File([source],'source.BIB'),{bibtex:true});
 assert.equal(opened.name,'source.BIB');assert.equal(opened.text,source);
 await assert.rejects(browserSelection(h,new h.window.File(['{}'],'document.json'),{bibtex:true}));
 assert.equal(await browserSelection(h,null,{bibtex:true,cancel:true}),null);
});

test('document sessions accept one UUIDv4 parameter and cannot use arbitrary storage suffixes',async t=>{
 const h=await harness(t,false);
 assert.equal(h.api.documentSessionId(),null);
 const id='6B363044-6C9A-4653-A2BA-000000000001';
 h.window.location.href=`https://example.org/vulgar-notes/?document=${id}`;
 assert.equal(h.api.documentSessionId(),id.toLowerCase());
 for(const suffix of ['', '../draft', 'legacy', '6b363044-6c9a-1653-a2ba-000000000001',`${id}&document=${id}`,`${id}/extra`]){
  h.window.location.href=`https://example.org/vulgar-notes/?document=${suffix}`;
  assert.equal(h.api.documentSessionId(),null,suffix);
 }
 const vm=require('node:vm'),context={};
 vm.runInNewContext(await source,context);
 assert.equal(context.platform.documentSessionId(),null,'non-browser test hosts do not have a session');
 context.window={};
 assert.equal(context.platform.documentSessionId(),null,'incomplete location mocks safely use the legacy draft');
});

test('web New opens a fresh same-origin tab synchronously without touching the current editor or drafts',async t=>{
 const oldId='6b363044-6c9a-4653-a2ba-000000000099';
 const h=await harness(t,false,`https://www.zhaiyusci.net/vulgar-notes/?mode=test&document=${oldId}#formula`);
 h.window.sessionStorage.setItem('math-plate-document-v1','original prose and formula');
 h.window.localStorage.setItem('math-plate-document-v1','desktop original');
 const originalURL=h.window.location.href;
 const first=h.api.newDocumentWindow();
 assert.equal(h.state.tabs.length,1,'open must run before the first await to retain the user gesture');
 await first;
 await h.api.newDocumentWindow();
 assert.equal(h.state.tabs.length,2);
 for(const [index,args] of h.state.tabs.entries()){
  const [href,target,features]=args,url=new URL(href);
  assert.equal(url.origin,'https://www.zhaiyusci.net');
  assert.equal(url.pathname,'/vulgar-notes/');
  assert.equal(url.searchParams.get('mode'),'test');
  assert.equal(url.searchParams.getAll('document').length,1);
  assert.equal(url.searchParams.get('document'),`6b363044-6c9a-4653-a2ba-${String(index+1).padStart(12,'0')}`);
  assert.equal(url.hash,'');assert.equal(target,'_blank');assert.equal(features,'noopener');
 }
 assert.equal(h.window.location.href,originalURL);
 assert.equal(h.window.sessionStorage.getItem('math-plate-document-v1'),'original prose and formula');
 assert.equal(h.window.localStorage.getItem('math-plate-document-v1'),'desktop original');
 assert.equal(h.state.windows.length,0);assert.equal(h.state.writes.length,0);
});

test('desktop New creates independent local windows with the editor drag and size settings',async t=>{
 const h=await harness(t,true,'http://tauri.localhost/index.html?document=6b363044-6c9a-4653-a2ba-000000000099#formula');
 const config=require('./src-tauri/tauri.conf.json').app.windows[0];
 const originalURL=h.window.location.href;
 h.window.localStorage.setItem('math-plate-document-v1','unchanged desktop draft');
 await h.api.newDocumentWindow();await h.api.newDocumentWindow();
 assert.equal(h.state.windows.length,2);
 for(const [index,created] of h.state.windows.entries()){
  const id=`6b363044-6c9a-4653-a2ba-${String(index+1).padStart(12,'0')}`;
  assert.equal(created.label,`document-${id}`);
  assert.equal(created.options.url,`./index.html?document=${id}`);
  for(const key of ['title','width','height','minWidth','minHeight','dragDropEnabled'])assert.equal(created.options[key],config[key],key);
  assert.equal(created.listeners.size,0,'creation listeners are released on success');
 }
 assert.equal(h.window.location.href,originalURL);
 assert.equal(h.window.localStorage.getItem('math-plate-document-v1'),'unchanged desktop draft');
 assert.equal(h.state.tabs.length,0);assert.equal(h.state.writes.length,0);
});

test('desktop New waits for creation and reports failures without altering drafts',async t=>{
 const h=await harness(t);
 h.state.autoWindowEvent=null;
 let completed=false;
 const pending=h.api.newDocumentWindow().then(()=>{completed=true;});
 while(!h.state.windows.length)await new Promise(setImmediate);
 assert.equal(completed,false);
 h.state.windows[0].emit('tauri://created');await pending;
 assert.equal(completed,true);assert.equal(h.state.windows[0].listeners.size,0);
 h.state.autoWindowEvent='tauri://error';h.state.windowError='window creation denied';
 await assert.rejects(h.api.newDocumentWindow(),/window creation denied/);
 assert.equal(h.state.windows[1].listeners.size,0,'error listeners are released on failure');
 h.state.windowConstructorError='invalid native window';
 await assert.rejects(h.api.newDocumentWindow(),/invalid native window/);
 assert.equal(h.state.writes.length,0);assert.equal(h.state.tabs.length,0);
});

test('new desktop document windows get the same local file capabilities without broad remote access',()=>{
 const capability=require('./src-tauri/capabilities/main.json');
 assert.deepEqual(capability.windows,['main','document-*']);
 assert.ok(capability.permissions.includes('core:webview:allow-create-webview-window'));
 for(const permission of ['dialog:allow-open','dialog:allow-save','dialog:allow-confirm','fs:allow-read-text-file','fs:allow-write-file']){
  assert.ok(capability.permissions.includes(permission),permission);
 }
 assert.equal(capability.remote,undefined);
 assert.ok(!capability.permissions.includes('core:webview:allow-create-webview'));
});

function documentHandleStorage(state){
 state.persistedHandles=new Map();state.hasHandleStore=false;
 return {open(){const request={};queueMicrotask(()=>{
  request.result={objectStoreNames:{contains:()=>state.hasHandleStore},createObjectStore(){state.hasHandleStore=true;},close(){},transaction(){
   const transaction={objectStore:()=>({get:id=>operate(()=>state.persistedHandles.get(id)),put:(handle,id)=>operate(()=>state.persistedHandles.set(id,handle)),delete:id=>operate(()=>state.persistedHandles.delete(id))})};
   function operate(action){const operation={result:action()};queueMicrotask(()=>transaction.oncomplete?.());return operation;}
   return transaction;
  }};if(!state.hasHandleStore)request.onupgradeneeded?.();request.onsuccess?.();
 });return request;}};
}
function enableDocumentHandles(h){
 Object.defineProperty(h.window,'indexedDB',{value:documentHandleStorage(h.state),configurable:true});
 h.state.openHandles=[];h.state.saveHandles=[];
 h.window.showOpenFilePicker=async options=>{h.state.openHandles.push(options);if(h.state.pickHandle instanceof Error)throw h.state.pickHandle;return h.state.pickHandle?[h.state.pickHandle]:[];};
 h.window.showSaveFilePicker=async options=>{h.state.saveHandles.push(options);if(h.state.saveHandle instanceof Error)throw h.state.saveHandle;return h.state.saveHandle;};
}
function documentHandle(h,name='original.vulgar',identity=name){
 const state={text:'initial file contents',gets:0,checks:[],requests:[],permission:'granted',requested:'granted',writes:0,closes:0,aborts:0,writeError:null};
 const value={kind:'file',name,identity,
  getFile:async()=>{state.gets++;return new h.window.File([state.text],name);},
  isSameEntry:async other=>other.identity===identity,
  queryPermission:async options=>{state.checks.push(options.mode);return state.permission;},
  requestPermission:async options=>{state.requests.push(options.mode);return state.requested;},
  createWritable:async()=>{let pending;return {write:async text=>{state.writes++;if(state.writeError)throw state.writeError;pending=text;},close:async()=>{state.closes++;state.text=pending;},abort:async()=>{state.aborts++;}};},
 };return {value,state};
}
async function chooseDocument(h,pending,file,{cancel=false}={}){
 for(let i=0;i<5&&!h.window.document.querySelector('input[type="file"]');i++)await Promise.resolve();
 const input=h.window.document.querySelector('input[type="file"]');assert.ok(input);
 if(cancel)input.dispatchEvent(new h.window.Event('cancel'));
 else{Object.defineProperty(input,'files',{value:file?[file]:[]});input.dispatchEvent(new h.window.Event('change'));}
 return pending.finally(()=>assert.equal(h.window.document.querySelector('input[type="file"]'),null));
}

test('recent native documents deduplicate real paths, reread fresh bytes and never store document text',async t=>{
 const h=await harness(t,true,'http://localhost/',recentSource),path='C:\\notes\\original.vulgar';
 h.state.openPath=path;h.state.files[path]='first private text';
 const opened=await h.api.openDocumentFile(),recent=await h.api.rememberRecentDocument(opened);
 const registry=h.window.localStorage.getItem(h.api.RECENT_DOCUMENTS_KEY);assert.doesNotMatch(registry,/first private text/);
 const second=await h.api.rememberRecentDocument({name:'ORIGINAL.vulgar',path:'c:/NOTES/ORIGINAL.vulgar'});
 assert.equal(second.id,recent.id);assert.equal(h.api.listRecentDocuments().length,1);
 // Re-register the spelling supplied by the original native dialog.
 await h.api.rememberRecentDocument(opened);h.api=await h.reload();h.state.files[path]='edited outside the application';
 const target=await h.api.getRecentDocumentTarget(recent.id);assert.equal(target.path,path);assert.equal(h.state.reads.length,1,'recovering a save target must not read the file');
 const fresh=await h.api.openRecentDocument(recent.id);assert.equal(fresh.text,h.state.files[path]);assert.equal(h.state.opens.length,1,'a remembered native path does not show a new chooser');
 assert.equal((await h.api.rememberRecentDocument(fresh)).id,recent.id);
 h.state.blocked=new Set([path]);const before=h.window.localStorage.getItem(h.api.RECENT_DOCUMENTS_KEY);
 h.state.openPath='C:\\other\\original.vulgar';h.state.files[h.state.openPath]='unrelated';
 await assert.rejects(h.api.openRecentDocument(recent.id),/original document/);assert.ok(!h.state.reads.includes(h.state.openPath));
 h.state.openPath=null;assert.equal(await h.api.openRecentDocument(recent.id),null);assert.equal(h.window.localStorage.getItem(h.api.RECENT_DOCUMENTS_KEY),before);
});

test('browser recent handles survive reload and restore Save targets without permission checks or stale contents',async t=>{
 const h=await harness(t,false,'http://localhost/',recentSource);enableDocumentHandles(h);
 const original=documentHandle(h);h.state.pickHandle=original.value;
 const opened=await h.api.openDocumentFile(),recent=await h.api.rememberRecentDocument(opened);
 assert.deepEqual(Object.keys(opened).sort(),['name','text']);
 assert.doesNotMatch(h.window.localStorage.getItem(h.api.RECENT_DOCUMENTS_KEY),/initial file contents|getFile|identity/);
 h.api=await h.reload();const target=await h.api.getRecentDocumentTarget(recent.id);
 assert.equal(original.state.gets,1);assert.equal(original.state.checks.length,0);assert.equal(original.state.requests.length,0);
 await h.api.saveDocumentFile('saved after page reload',target);assert.equal(original.state.text,'saved after page reload');assert.deepEqual(original.state.checks,['readwrite']);assert.equal(h.state.saveHandles.length,0);
 original.state.text='changed externally';const fresh=await h.api.openRecentDocument(recent.id);assert.equal(fresh.text,'changed externally');assert.equal(original.state.gets,2);
 assert.deepEqual(original.state.checks,['readwrite','read']);assert.equal(h.state.openHandles.length,1);
 assert.equal((await h.api.rememberRecentDocument(fresh)).id,recent.id);
 const equivalent=documentHandle(h,'original.vulgar');h.state.pickHandle=equivalent.value;
 const same=await h.api.rememberRecentDocument(await h.api.openDocumentFile());assert.equal(same.id,recent.id);assert.equal(h.api.listRecentDocuments().length,1);
 const distinct=documentHandle(h,'original.vulgar','a different directory');h.state.pickHandle=distinct.value;
 const another=await h.api.rememberRecentDocument(await h.api.openDocumentFile());assert.notEqual(another.id,recent.id);assert.equal(h.api.listRecentDocuments().length,2,'same filename alone must not merge different files');
});

test('browser native Save overwrites, Save As selects a new target, and canceled or failed writes keep the original file',async t=>{
 const h=await harness(t,false,'http://localhost/',recentSource);enableDocumentHandles(h);
 const original=documentHandle(h),replacement=documentHandle(h,'copy.vulgar');h.state.pickHandle=original.value;
 const opened=await h.api.openDocumentFile();h.state.saveHandle=replacement.value;
 const saved=await h.api.saveDocumentFile('new document text',opened);assert.equal(saved.name,'original.vulgar');assert.equal(original.state.text,'new document text');assert.equal(h.state.saveHandles.length,0);
 const copied=await h.api.saveDocumentFile('copy contents',undefined,opened.name);assert.equal(copied.name,'copy.vulgar');assert.equal(replacement.state.text,'copy contents');assert.equal(original.state.text,'new document text');
 assert.equal(h.state.saveHandles[0].suggestedName,'original.vulgar');assert.deepEqual(Array.from(h.state.saveHandles[0].types[0].accept['application/json']),['.vulgar']);
 const aborted=Error('picker canceled');aborted.name='AbortError';h.state.saveHandle=aborted;h.state.pickHandle=aborted;
 assert.equal(await h.api.saveDocumentFile('must not write'),null);assert.equal(await h.api.openDocumentFile(),null);
 original.state.permission='prompt';original.state.requested='denied';assert.equal(await h.api.saveDocumentFile('denied',saved),null);assert.equal(original.state.text,'new document text');assert.deepEqual(original.state.requests,['readwrite']);
 original.state.permission='granted';original.state.writeError=Error('disk full');await assert.rejects(h.api.saveDocumentFile('failed',saved),/disk full/);
 assert.equal(original.state.aborts,1);assert.equal(original.state.text,'new document text');
 const fileFailure=Error('file access failed after choosing a target');fileFailure.name='SecurityError';replacement.state.writeError=fileFailure;h.state.saveHandle=replacement.value;
 await assert.rejects(h.api.saveDocumentFile('must not silently download'),/file access failed/);assert.equal(h.state.downloads.length,0);
 const readFailure=Error('file read failed after selection');readFailure.name='SecurityError';h.state.pickHandle={...replacement.value,getFile:async()=>{throw readFailure;}};
 await assert.rejects(h.api.openDocumentFile(),/file read failed/);assert.equal(h.window.document.querySelector('input[type="file"]'),null);
});

test('recent plain-file fallback requests the original name and never reuses an immutable File snapshot',async t=>{
 const h=await harness(t,false,'http://localhost/',recentSource);
 const opened=await chooseDocument(h,h.api.openDocumentFile(),new h.window.File(['old text'],'original.vulgar'));
 const recent=await h.api.rememberRecentDocument(opened),before=h.window.localStorage.getItem(h.api.RECENT_DOCUMENTS_KEY);h.api=await h.reload();
 await assert.rejects(chooseDocument(h,h.api.openRecentDocument(recent.id),new h.window.File(['wrong text'],'other.vulgar')),/original document/);
 assert.equal(await chooseDocument(h,h.api.openRecentDocument(recent.id),null,{cancel:true}),null);assert.equal(h.window.localStorage.getItem(h.api.RECENT_DOCUMENTS_KEY),before);
 const fresh=await chooseDocument(h,h.api.openRecentDocument(recent.id),new h.window.File(['fresh selected text'],'original.vulgar'));
 assert.equal(fresh.text,'fresh selected text');assert.equal((await h.api.rememberRecentDocument(fresh)).id,recent.id);
 const restored=await h.api.getRecentDocumentTarget(recent.id),saved=await h.api.saveDocumentFile('downloaded update',restored);
 assert.equal(saved,restored,'download fallback retains the known recent identity');assert.equal((await h.api.rememberRecentDocument(saved)).id,recent.id);
});

test('removing a recent entry deletes only its local link and sees later registry updates from another tab',async t=>{
 const h=await harness(t,false,'http://localhost/',recentSource);enableDocumentHandles(h);
 const first=documentHandle(h,'first.vulgar'),second=documentHandle(h,'second.vulgar');h.state.pickHandle=first.value;
 const a=await h.api.rememberRecentDocument(await h.api.openDocumentFile());h.state.pickHandle=second.value;
 const b=await h.api.rememberRecentDocument(await h.api.openDocumentFile());
 await h.api.removeRecentDocument(a.id);assert.deepEqual(Array.from(h.api.listRecentDocuments(),entry=>entry.id),[b.id]);assert.equal(h.state.persistedHandles.has(a.id),false);
 assert.equal(first.state.text,'initial file contents');assert.equal(first.state.writes,0);
 const stored=JSON.parse(h.window.localStorage.getItem(h.api.RECENT_DOCUMENTS_KEY));stored.documents[0].name='renamed.vulgar';h.window.localStorage.setItem(h.api.RECENT_DOCUMENTS_KEY,JSON.stringify(stored));
 assert.equal(h.api.listRecentDocuments()[0].name,'renamed.vulgar','old JavaScript maps do not override another tab\'s metadata');
});

test('recovery storage is durable and shared while document UUIDs provide isolation',async t=>{
 const h=await harness(t,false);assert.equal(h.api.draftStorage(),h.window.localStorage);
 h.api.draftStorage().setItem('math-plate-document-v1:first','first');h.api.draftStorage().setItem('math-plate-document-v1:second','second');
 assert.equal(h.api.draftStorage().getItem('math-plate-document-v1:first'),'first');assert.equal(h.api.draftStorage().getItem('math-plate-document-v1:second'),'second');
});

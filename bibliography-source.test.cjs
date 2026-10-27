const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');

const bundled=build({entryPoints:['src/bibliography-source.ts'],bundle:true,write:false,format:'iife',globalName:'bibliographySource',plugins:[{name:'source-test-adapters',setup(b){
 b.onResolve({filter:/^@tauri-apps\//},args=>({path:args.path,namespace:'source-test'}));
 b.onResolve({filter:/^\.\/i18n$/},()=>({path:'i18n',namespace:'source-test'}));
 b.onLoad({filter:/.*/,namespace:'source-test'},({path})=>({loader:'js',contents:path==='i18n'?'export const t=value=>value;':path.endsWith('/core')?'export const isTauri=()=>globalThis.sourceTest.desktop;':path.endsWith('/plugin-dialog')?
  `export const open=async options=>{const s=globalThis.sourceTest;s.opens.push(options);if(s.authorizeOnOpen&&s.openPath)s.blocked.delete(s.openPath);return s.openPath;};`:
  `export const readTextFile=async path=>{const s=globalThis.sourceTest;s.reads.push(path);if(s.blocked.has(path))throw Error('File access denied');if(!(path in s.files))throw Error('File not found');return s.files[path];};`}));
}}]}).then(result=>result.outputFiles[0].text);

// Exercise the application's IndexedDB request/transaction contract. Handles
// intentionally survive a module reload while its JavaScript maps do not.
function indexedDBAdapter(state){
 return {open(){
  const request={};
  queueMicrotask(()=>{
   if(state.idbFailure){request.error=Error('IndexedDB unavailable');request.onerror?.();return;}
   request.result={
    objectStoreNames:{contains:()=>state.hasHandleStore},createObjectStore(){state.hasHandleStore=true;},close(){},
    transaction(){
     const transaction={objectStore:()=>({
      get:id=>operate(()=>state.persistedHandles.get(id)),
      put:(handle,id)=>operate(()=>{state.persistedHandles.set(id,handle);}),
      delete:id=>operate(()=>{state.persistedHandles.delete(id);}),
     })};
     function operate(action){const operation={result:action()};queueMicrotask(()=>transaction.oncomplete?.());return operation;}
     return transaction;
    },
   };
   if(!state.hasHandleStore)request.onupgradeneeded?.();
   request.onsuccess?.();
  });return request;
 }};
}
async function harness(t,{desktop=false,handles=false}={}){
 const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
 window.document.write('<!doctype html><body></body>');
 const state=window.sourceTest={desktop,files:{},reads:[],opens:[],openPath:null,blocked:new Set(),authorizeOnOpen:false,persistedHandles:new Map(),hasHandleStore:false,idbFailure:false,picks:[],pickResult:null};
 if(handles){
  Object.defineProperty(window,'indexedDB',{value:indexedDBAdapter(state),configurable:true});
  window.showOpenFilePicker=async options=>{state.picks.push(options);if(state.pickResult instanceof Error)throw state.pickResult;return state.pickResult?[state.pickResult]:[];};
 }
 const reload=async()=>{window.eval(await bundled+'\nwindow.sourceApi=bibliographySource;');return window.sourceApi;};
 const h={window,state,api:await reload(),reload};t.after(()=>window.happyDOM.abort());return h;
}
function handle(h,name='original.bib'){
 const state={text:'@book{a,title={Original}}',gets:0,permission:'granted',requested:'granted',requests:0,permissionChecks:0};
 const value={kind:'file',name,
  getFile:async()=>{state.gets++;return new h.window.File([state.text],name);},
  queryPermission:async options=>{assert.equal(options.mode,'read');state.permissionChecks++;return state.permission;},
  requestPermission:async options=>{assert.equal(options.mode,'read');state.requests++;return state.requested;},
 };
 return {value,state};
}
async function select(h,pending,file,{cancel=false}={}){
 const input=h.window.document.querySelector('input[type="file"]');assert.ok(input,'the fallback asks for a fresh file selection');
 assert.match(input.accept,/(?:^|,)\.bib(?:,|$)/);
 if(cancel)input.dispatchEvent(new h.window.Event('cancel'));
 else{Object.defineProperty(input,'files',{value:file?[file]:[]});input.dispatchEvent(new h.window.Event('change'));}
 return pending.finally(()=>assert.equal(h.window.document.querySelector('input[type="file"]'),null));
}

test('desktop refresh rereads the original path after restart without serializing it into the opened source',async t=>{
 const h=await harness(t,{desktop:true}),path='C:\\papers\\original.bib';
 h.state.openPath=path;h.state.files[path]='@book{a,title={Initial}}';
 const file=await h.api.openBibliographySource();assert.equal(file.path,path);
 assert.equal((await h.api.rememberBibliographySource('library',file)).persisted,true);
 const saved=h.window.localStorage.getItem(h.api.BIBLIOGRAPHY_SOURCE_KEY);
 assert.match(saved,/original\.bib/);assert.doesNotMatch(saved,/@book|Initial/);
 assert.deepEqual(Object.keys(file).sort(),['name','path','text'],'opaque browser/native origin state is not portable document data');
 h.state.files[path]='@book{a,title={Edited outside the app}}';
 h.api=await h.reload();const refreshed=await h.api.refreshBibliographySource('library','original.bib');
 assert.equal(refreshed.text,h.state.files[path]);assert.equal(h.state.opens.length,1);assert.deepEqual(h.state.reads,[path,path]);
});

test('desktop reauthorization permits only the original path and cancellation retains the source link',async t=>{
 const h=await harness(t,{desktop:true}),path='C:\\papers\\original.bib';h.state.openPath=path;h.state.files[path]='old';
 const original=await h.api.openBibliographySource();await h.api.rememberBibliographySource('library',original);
 const before=h.window.localStorage.getItem(h.api.BIBLIOGRAPHY_SOURCE_KEY);h.state.blocked.add(path);
 h.state.openPath='C:\\different\\original.bib';h.state.files[h.state.openPath]='unrelated';
 await assert.rejects(h.api.refreshBibliographySource('library','original.bib'),/original \.bib file/);
 assert.equal(h.state.opens.at(-1).defaultPath,path);assert.ok(!h.state.reads.includes(h.state.openPath));
 h.state.openPath=null;assert.equal(await h.api.refreshBibliographySource('library','original.bib'),null);
 assert.equal(h.window.localStorage.getItem(h.api.BIBLIOGRAPHY_SOURCE_KEY),before);
 h.state.openPath=path;h.state.authorizeOnOpen=true;h.state.files[path]='updated';
 assert.equal((await h.api.refreshBibliographySource('library','original.bib')).text,'updated');
});

test('desktop legacy links require the original filename and unsupported files are never read',async t=>{
 const h=await harness(t,{desktop:true});h.state.openPath='C:\\papers\\other.bib';h.state.files[h.state.openPath]='other';
 await assert.rejects(h.api.refreshBibliographySource('legacy','original.bib'),/original\.bib/);
 h.state.openPath='C:\\papers\\original.json';await assert.rejects(h.api.openBibliographySource(),/BibTeX library/);
 assert.equal(h.state.reads.length,0);h.state.openPath=null;assert.equal(await h.api.openBibliographySource(),null);
});

test('browser handles persist in IndexedDB and get a fresh File on every refresh, including after reload',async t=>{
 const h=await harness(t,{handles:true}),original=handle(h);h.state.pickResult=original.value;
 const file=await h.api.openBibliographySource();assert.equal(file.text,original.state.text);
 assert.equal((await h.api.rememberBibliographySource('library',file)).persisted,true);
 assert.deepEqual(Object.keys(file).sort(),['name','text']);
 const registry=h.window.localStorage.getItem(h.api.BIBLIOGRAPHY_SOURCE_KEY);assert.doesNotMatch(registry,/getFile|@book|Original/);
 original.state.text='@book{a,title={Fresh disk contents}}';
 assert.equal((await h.api.refreshBibliographySource('library','original.bib')).text,original.state.text);
 h.api=await h.reload();original.state.text='@book{a,title={After page restart}}';
 assert.equal((await h.api.refreshBibliographySource('library','original.bib')).text,original.state.text);
 assert.equal(original.state.gets,3);assert.equal(h.state.picks.length,1,'refresh must not re-open a chooser when the original handle is usable');
 assert.equal(original.state.permissionChecks,2);
});

test('browser refresh requests only read permission and declining access leaves the saved link unchanged',async t=>{
 const h=await harness(t,{handles:true}),original=handle(h);h.state.pickResult=original.value;
 const file=await h.api.openBibliographySource();await h.api.rememberBibliographySource('library',file);
 const before=h.window.localStorage.getItem(h.api.BIBLIOGRAPHY_SOURCE_KEY);
 original.state.permission='prompt';original.state.requested='denied';
 assert.equal(await h.api.refreshBibliographySource('library','original.bib'),null);assert.equal(original.state.gets,1);
 assert.equal(h.window.localStorage.getItem(h.api.BIBLIOGRAPHY_SOURCE_KEY),before);
 original.state.requested='granted';original.state.text='revised';
 assert.equal((await h.api.refreshBibliographySource('library','original.bib')).text,'revised');assert.equal(original.state.requests,2);
 const cancellation=Error('Cancelled');cancellation.name='AbortError';h.state.pickResult=cancellation;
 assert.equal(await h.api.openBibliographySource(),null);
});

test('browser fallback requires fresh same-name selection instead of reading an old immutable File',async t=>{
 const h=await harness(t),original=new h.window.File(['old snapshot'],'original.bib');
 const file=await select(h,h.api.openBibliographySource(),original);await h.api.rememberBibliographySource('library',file);
 const before=h.window.localStorage.getItem(h.api.BIBLIOGRAPHY_SOURCE_KEY);
 await assert.rejects(select(h,h.api.refreshBibliographySource('library','original.bib'),new h.window.File(['wrong'],'other.bib')),/original\.bib/);
 assert.equal(await select(h,h.api.refreshBibliographySource('library','original.bib'),null,{cancel:true}),null);
 assert.equal(h.window.localStorage.getItem(h.api.BIBLIOGRAPHY_SOURCE_KEY),before);
 const updated=await select(h,h.api.refreshBibliographySource('library','original.bib'),new h.window.File(['fresh bytes'],'original.bib'));
 assert.equal(updated.text,'fresh bytes');assert.equal(file.text,'old snapshot');
});

test('registry storage failure reports an unpersisted link but keeps the current session refresh usable',async t=>{
 const h=await harness(t,{handles:true}),original=handle(h);h.state.pickResult=original.value;
 const file=await h.api.openBibliographySource();h.state.idbFailure=true;
 const storage=h.window.localStorage;
 Object.defineProperty(h.window,'localStorage',{value:{getItem:key=>storage.getItem(key),setItem(){throw Error('Quota exceeded');}},configurable:true});
 assert.equal((await h.api.rememberBibliographySource('library',file)).persisted,false);
 original.state.text='still fresh';assert.equal((await h.api.refreshBibliographySource('library','original.bib')).text,'still fresh');
});

test('forgetting a source removes only its local path or handle, retaining other source links',async t=>{
 const h=await harness(t,{handles:true}),first=handle(h,'first.bib'),second=handle(h,'second.bib');
 h.state.pickResult=first.value;await h.api.rememberBibliographySource('first',await h.api.openBibliographySource());
 h.state.pickResult=second.value;await h.api.rememberBibliographySource('second',await h.api.openBibliographySource());
 await h.api.forgetBibliographySource('first');h.api=await h.reload();
 assert.equal(h.state.persistedHandles.has('first'),false);assert.equal(h.state.persistedHandles.has('second'),true);
 const saved=JSON.parse(h.window.localStorage.getItem(h.api.BIBLIOGRAPHY_SOURCE_KEY));assert.deepEqual(saved.sources.map(source=>source.id),['second']);
 second.state.text='remaining source';assert.equal((await h.api.refreshBibliographySource('second','second.bib')).text,'remaining source');
});

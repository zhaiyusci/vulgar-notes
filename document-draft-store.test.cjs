const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const {IDBFactory}=require('fake-indexeddb');

const DATABASE='vulgar-notes-document-drafts';
const bundled=build({entryPoints:['src/document-draft-store.ts'],bundle:true,write:false,format:'iife',globalName:'draftStore'})
 .then(result=>result.outputFiles[0].text);

function quotaStorage(limit=5*1024*1024){
 const values=new Map();let writes=0;
 return {get length(){return values.size;},get writes(){return writes;},key:index=>[...values.keys()][index]??null,
  getItem:key=>values.get(String(key))??null,
  setItem(key,value){key=String(key);value=String(value);let size=key.length+value.length;for(const [other,text]of values)if(other!==key)size+=other.length+text.length;
   if(size>limit)throw new DOMException('The localStorage quota was exceeded.','QuotaExceededError');values.set(key,value);writes++;},
  removeItem:key=>values.delete(String(key)),clear:()=>values.clear()};
}
function instrument(factory,state){
 return {open(...args){
  const request=factory.open(...args);
  request.addEventListener('success',()=>{
   const database=request.result,originalTransaction=database.transaction.bind(database);
   database.transaction=(...parameters)=>{
    const transaction=originalTransaction(...parameters);
    if(parameters[1]==='readwrite'){
     const record={completed:false,aborted:false,requests:0};state.transactions.push(record);
     transaction.addEventListener('complete',()=>{record.completed=true;});
     transaction.addEventListener('abort',()=>{record.aborted=true;});
     const originalObjectStore=transaction.objectStore.bind(transaction);
     transaction.objectStore=name=>{
      const store=originalObjectStore(name),put=store.put.bind(store);
      store.put=(...values)=>{
       record.requests++;
       if(state.failPutAt===record.requests){state.failPutAt=0;throw new DOMException('Test disk quota failure.','QuotaExceededError');}
       const operation=put(...values);
       operation.addEventListener('success',()=>{
        state.onPutSuccess?.(record);
        if(state.abortNext){state.abortNext=false;transaction.abort();}
       });return operation;
      };return store;
     };
    }return transaction;
   };
  });return request;
 }};
}
function controlledTimers(window){
 let now=0,next=0;const tasks=new Map();
 window.setTimeout=(callback,delay=0,...args)=>{const id=++next;tasks.set(id,{at:now+delay,callback:()=>callback(...args)});return id;};
 window.clearTimeout=id=>{tasks.delete(id);};
 return {get pending(){return tasks.size;},advance(milliseconds){
  const end=now+milliseconds;
  while(true){const due=[...tasks].filter(([,task])=>task.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;
   now=due[1].at;tasks.delete(due[0]);due[1].callback();
  }now=end;
 }};
}
async function harness(t,{factory=new IDBFactory(),local=quotaStorage(),unavailable=false,controlled=false}={}){
 const {Window}=await import('happy-dom');const window=new Window({url:'http://localhost/'});
 const state={transactions:[],failPutAt:0,abortNext:false,onPutSuccess:null};
 Object.defineProperty(window,'localStorage',{value:local,configurable:true});
 Object.defineProperty(window,'indexedDB',{value:unavailable?undefined:instrument(factory,state),configurable:true});
 const clock=controlled?controlledTimers(window):null;
 window.eval(await bundled+'\nwindow.api=draftStore;');
 const events=[];
 window.addEventListener('vulgar-draft-storage-error',event=>events.push({type:'error',error:event.detail.error}));
 window.addEventListener('vulgar-draft-storage-restored',()=>events.push({type:'restored'}));
 t.after(()=>window.happyDOM.abort());return {window,api:window.api,state,factory,local,events,clock};
}
async function entries(factory){
 return new Promise((resolve,reject)=>{
  const request=factory.open(DATABASE,1);
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{
   const database=request.result,transaction=database.transaction('entries','readonly'),result=new Map();
   const cursor=transaction.objectStore('entries').openCursor();
   cursor.onsuccess=()=>{if(cursor.result){result.set(cursor.result.key,cursor.result.value);cursor.result.continue();}};
   transaction.oncomplete=()=>{database.close();resolve(result);};transaction.onabort=()=>reject(transaction.error);
  };
 });
}
const textOf=value=>typeof value==='string'?value:value?.value;

test('typing coalesces one bounded recovery write while synchronous reads keep the latest edit',async t=>{
 const h=await harness(t,{controlled:true});await h.api.initializeDocumentDraftStore();const storage=h.api.getDocumentDraftStorage(),key='math-plate-document-v1:paper';
 storage.setItem(key,'first');h.clock.advance(150);storage.setItem(key,'second');h.clock.advance(150);storage.setItem(key,'latest');
 assert.equal(storage.getItem(key),'latest');assert.equal(h.clock.pending,1);assert.equal(h.state.transactions.length,0);
 h.clock.advance(49);assert.equal(h.state.transactions.length,0);
 h.clock.advance(1);await h.api.flushDocumentDraftStore();
 assert.equal(h.clock.pending,0);assert.equal(h.state.transactions.length,1);assert.equal(h.state.transactions[0].requests,1);
 assert.equal(textOf((await entries(h.factory)).get(key)),'latest','later keystrokes must not postpone the first recovery beyond 350 ms');
});

test('explicit flush bypasses and cancels the typing delay',async t=>{
 const h=await harness(t,{controlled:true});await h.api.initializeDocumentDraftStore();const storage=h.api.getDocumentDraftStorage();
 storage.setItem('math-plate-document-v1:paper','save immediately');assert.equal(h.clock.pending,1);
 const flushing=h.api.flushDocumentDraftStore();assert.equal(h.clock.pending,0);assert.equal(h.state.transactions.length,1);await flushing;
 h.clock.advance(1000);assert.equal(h.state.transactions.length,1,'a canceled timer must not write the saved document again');
 assert.equal(textOf((await entries(h.factory)).get('math-plate-document-v1:paper')),'save immediately');
});

test('explicit flush drains deferred host serialization before its transaction and unregister removes the producer',async t=>{
 const h=await harness(t,{controlled:true});await h.api.initializeDocumentDraftStore();const storage=h.api.getDocumentDraftStorage(),key='math-plate-document-v1:paper';
 let pendingSource='latest host content',calls=0;
 const unregister=h.api.registerDocumentDraftProducer(()=>{calls++;if(pendingSource!==null){storage.setItem(key,pendingSource);pendingSource=null;}});
 await h.api.flushDocumentDraftStore();assert.equal(calls,1);assert.equal(h.clock.pending,0);assert.equal(textOf((await entries(h.factory)).get(key)),'latest host content');
 pendingSource='must not be recreated after Discard';unregister();await h.api.flushDocumentDraftStore();
 assert.equal(calls,1);assert.equal(textOf((await entries(h.factory)).get(key)),'latest host content');
});

test('a producer failure rejects the flush without discarding queued recovery data',async t=>{
 const h=await harness(t,{controlled:true});await h.api.initializeDocumentDraftStore();const storage=h.api.getDocumentDraftStorage(),key='math-plate-document-v1:paper';
 storage.setItem(key,'queued recovery');const unregister=h.api.registerDocumentDraftProducer(()=>{throw Error('Serialization failed');});
 await assert.rejects(h.api.flushDocumentDraftStore(),/Serialization failed/);
 assert.equal(storage.getItem(key),'queued recovery');assert.equal(h.clock.pending,0);assert.equal(h.state.transactions.length,0);assert.equal(h.events.at(-1).type,'error');
 unregister();await h.api.flushDocumentDraftStore();assert.equal(textOf((await entries(h.factory)).get(key)),'queued recovery');assert.equal(h.events.at(-1).type,'restored');
});

test('producer barriers also run before IndexedDB initialization for the legacy synchronous fallback',async t=>{
 const h=await harness(t,{controlled:true});const unregister=h.api.registerDocumentDraftProducer(()=>h.api.getDocumentDraftStorage().setItem('math-plate-document-v1:paper','legacy pending content'));
 await h.api.flushDocumentDraftStore();assert.equal(h.local.getItem('math-plate-document-v1:paper'),'legacy pending content');unregister();
});

test('hiding or leaving the page starts pending recovery before background timer throttling',async t=>{
 const h=await harness(t,{controlled:true});await h.api.initializeDocumentDraftStore();const storage=h.api.getDocumentDraftStorage(),key='math-plate-document-v1:paper';
 storage.setItem(key,'hidden-tab edit');Object.defineProperty(h.window.document,'visibilityState',{value:'hidden',configurable:true});
 h.window.document.dispatchEvent(new h.window.Event('visibilitychange'));assert.equal(h.clock.pending,0);assert.equal(h.state.transactions.length,1);await h.api.flushDocumentDraftStore();
 storage.setItem(key,'leaving-page edit');h.window.dispatchEvent(new h.window.Event('pagehide'));assert.equal(h.clock.pending,0);assert.equal(h.state.transactions.length,2);await h.api.flushDocumentDraftStore();
 assert.equal(textOf((await entries(h.factory)).get(key)),'leaving-page edit');
});

test('a 4.9 MB document and saved baseline survive restart without spending localStorage quota',async t=>{
 const local=quotaStorage(),key='math-plate-document-v1:paper',baseline='editor.open-document:paper';
 const source=JSON.stringify({version:1,document:'x'.repeat(4_902_000)});
 local.setItem(key,source);assert.throws(()=>local.setItem(baseline,source),{name:'QuotaExceededError'});
 const h=await harness(t,{local});assert.equal(h.api.getDocumentDraftStorage(),local,'pre-initialization callers retain the old Storage API');
 const initializing=h.api.initializeDocumentDraftStore();assert.equal(h.api.initializeDocumentDraftStore(),initializing,'initialization shares one transaction sequence');await initializing;
 const storage=h.api.getDocumentDraftStorage();assert.notEqual(storage,local);assert.equal(storage.getItem(key),source);
 storage.setItem(baseline,source);storage.setItem(key,source+' ');await h.api.flushDocumentDraftStore();
 assert.equal(local.writes,1,'migration and all new writes preserve the original legacy bytes');assert.equal(local.getItem(key),source);
 const reopened=await harness(t,{factory:h.factory,local});await reopened.api.initializeDocumentDraftStore();
 assert.equal(reopened.api.getDocumentDraftStorage().getItem(key),source+' ','stale localStorage must never replace newer IndexedDB content');
 assert.equal(reopened.api.getDocumentDraftStorage().getItem(baseline),source);assert.equal(reopened.api.getDocumentDraftStorage().length,2);
});

test('flush waits for committed transactions and includes edits made while a transaction is active',async t=>{
 const h=await harness(t);await h.api.initializeDocumentDraftStore();const storage=h.api.getDocumentDraftStorage();
 let resolved=false,requestSeen=0;
 h.state.onPutSuccess=record=>{requestSeen++;assert.equal(resolved,false);assert.equal(record.completed,false);if(requestSeen===1)storage.setItem('math-plate-document-v1:paper','second edit');};
 storage.setItem('math-plate-document-v1:paper','first edit');
 await h.api.flushDocumentDraftStore().then(()=>{resolved=true;});
 assert.equal(requestSeen,2);assert.equal(h.state.transactions.length,2);assert.ok(h.state.transactions.every(transaction=>transaction.completed));
 assert.equal(textOf((await entries(h.factory)).get('math-plate-document-v1:paper')),'second edit');
});

test('an aborted write keeps old durable bytes and every pending edit can be retried',async t=>{
 const h=await harness(t);await h.api.initializeDocumentDraftStore();const storage=h.api.getDocumentDraftStorage(),key='math-plate-document-v1:paper';
 storage.setItem(key,'original');await h.api.flushDocumentDraftStore();h.state.abortNext=true;
 storage.setItem(key,'unsaved revision');storage.setItem('editor.open-document:paper','new baseline');
 await assert.rejects(h.api.flushDocumentDraftStore());
 assert.equal(storage.getItem(key),'unsaved revision','an async failure must not discard the editor\'s current contents');
 const before=await entries(h.factory);assert.equal(textOf(before.get(key)),'original');assert.equal(before.has('editor.open-document:paper'),false,'the transaction cannot persist a partial source/baseline pair');
 assert.equal(h.events.at(-1).type,'error');await h.api.flushDocumentDraftStore();
 const after=await entries(h.factory);assert.equal(textOf(after.get(key)),'unsaved revision');assert.equal(textOf(after.get('editor.open-document:paper')),'new baseline');
 assert.equal(h.events.at(-1).type,'restored');
});

test('quota failure aborts the whole batch, reports autosave failure without an unhandled rejection, and retries',async t=>{
 const h=await harness(t,{controlled:true});await h.api.initializeDocumentDraftStore();const storage=h.api.getDocumentDraftStorage();
 storage.setItem('math-plate-document-v1:a','old a');storage.setItem('math-plate-document-v1:b','old b');await h.api.flushDocumentDraftStore();
 const unhandled=[];const listener=error=>unhandled.push(error);process.on('unhandledRejection',listener);t.after(()=>process.off('unhandledRejection',listener));
 const failed=new Promise(resolve=>h.window.addEventListener('vulgar-draft-storage-error',resolve,{once:true}));
 h.state.failPutAt=2;storage.setItem('math-plate-document-v1:a','new a');storage.setItem('math-plate-document-v1:b','new b');h.clock.advance(350);await failed;
 await new Promise(resolve=>setImmediate(resolve));assert.equal(unhandled.length,0);
 const before=await entries(h.factory);assert.equal(textOf(before.get('math-plate-document-v1:a')),'old a');assert.equal(textOf(before.get('math-plate-document-v1:b')),'old b');
 assert.equal(storage.getItem('math-plate-document-v1:a'),'new a');await h.api.flushDocumentDraftStore();
 const after=await entries(h.factory);assert.equal(textOf(after.get('math-plate-document-v1:a')),'new a');assert.equal(textOf(after.get('math-plate-document-v1:b')),'new b');assert.equal(h.events.at(-1).type,'restored');
});

test('legacy import is selective and keeps recovery originals; deleted legacy drafts do not resurrect',async t=>{
 const local=quotaStorage();const keys=['math-plate-document-v1','math-plate-document-v1:doc:recovery','editor.open-document:doc','math-tiptap-document-v1','math-text-flow-state','vulgar-notes-legacy-recovery:old'];
 for(const key of keys)local.setItem(key,'original bytes for '+key);local.setItem('vulgar-notes-preferences','{"theme":"dark"}');
 const h=await harness(t,{local});await h.api.initializeDocumentDraftStore();const storage=h.api.getDocumentDraftStorage();
 assert.equal(storage.length,keys.length);assert.equal(storage.getItem('vulgar-notes-preferences'),null);for(const key of keys)assert.equal(storage.getItem(key),local.getItem(key));
 storage.removeItem(keys[0]);await h.api.flushDocumentDraftStore();assert.ok(local.getItem(keys[0]));
 const reopened=await harness(t,{factory:h.factory,local});await reopened.api.initializeDocumentDraftStore();
 assert.equal(reopened.api.getDocumentDraftStorage().getItem(keys[0]),null);assert.equal(local.length,keys.length+1);
});

test('two windows mutate only their keys, refresh sees other drafts, and clear does not wipe unseen sessions',async t=>{
 const factory=new IDBFactory(),first=await harness(t,{factory}),second=await harness(t,{factory});
 await Promise.all([first.api.initializeDocumentDraftStore(),second.api.initializeDocumentDraftStore()]);
 const a=first.api.getDocumentDraftStorage(),b=second.api.getDocumentDraftStorage();
 a.setItem('math-plate-document-v1:first','first window');b.setItem('math-plate-document-v1:second','second window');
 await Promise.all([first.api.flushDocumentDraftStore(),second.api.flushDocumentDraftStore()]);
 assert.equal((await entries(factory)).size,2);a.clear();await first.api.flushDocumentDraftStore();
 assert.equal(textOf((await entries(factory)).get('math-plate-document-v1:second')),'second window');
 await first.api.refreshDocumentDraftStore();assert.equal(a.getItem('math-plate-document-v1:second'),'second window');assert.equal(a.getItem('math-plate-document-v1:first'),null);
 b.setItem('math-plate-document-v1:second','updated second');await second.api.flushDocumentDraftStore();await first.api.refreshDocumentDraftStore();assert.equal(a.getItem('math-plate-document-v1:second'),'updated second');
});

test('unavailable initialization rejects without changing or replacing legacy storage',async t=>{
 const local=quotaStorage();local.setItem('math-plate-document-v1:old','original');const h=await harness(t,{local,unavailable:true});
 await assert.rejects(h.api.initializeDocumentDraftStore(),/unavailable/);assert.equal(h.api.getDocumentDraftStorage(),local);assert.equal(local.getItem('math-plate-document-v1:old'),'original');
});

test('a failed legacy migration remains atomic, keeps originals, and initialization can retry',async t=>{
 const local=quotaStorage();local.setItem('math-plate-document-v1:first','first original');local.setItem('math-plate-document-v1:second','second original');
 const h=await harness(t,{local});h.state.failPutAt=2;
 await assert.rejects(h.api.initializeDocumentDraftStore(),{name:'QuotaExceededError'});
 assert.equal(h.api.getDocumentDraftStorage(),local);assert.equal((await entries(h.factory)).size,0);assert.equal(local.length,2);
 await h.api.initializeDocumentDraftStore();assert.equal(h.api.getDocumentDraftStorage().getItem('math-plate-document-v1:second'),'second original');assert.equal(local.writes,2);assert.equal(h.events.at(-1).type,'restored');
});

test('blocked initialization leaves fallback untouched and can retry after the blocker is gone',async t=>{
 const local=quotaStorage();local.setItem('math-plate-document-v1:old','original');const h=await harness(t,{local});
 Object.defineProperty(h.window,'indexedDB',{value:{open(){const request={};queueMicrotask(()=>request.onblocked?.());return request;}},configurable:true});
 await assert.rejects(h.api.initializeDocumentDraftStore(),/blocked/);assert.equal(h.api.getDocumentDraftStorage(),local);assert.equal(local.getItem('math-plate-document-v1:old'),'original');
 Object.defineProperty(h.window,'indexedDB',{value:instrument(h.factory,h.state),configurable:true});
 await h.api.initializeDocumentDraftStore();assert.notEqual(h.api.getDocumentDraftStorage(),local);assert.equal(h.api.getDocumentDraftStorage().getItem('math-plate-document-v1:old'),'original');
});

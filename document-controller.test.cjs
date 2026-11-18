const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {build}=require('esbuild');

const compiled=build({entryPoints:['src/document-controller.ts'],bundle:true,write:false,platform:'node',format:'cjs',metafile:true}).then(result=>{
 const module={exports:{}};
 // Intentionally no DOM, web storage, Tauri, timers, crypto or i18n globals.
 vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports});
 return {api:module.exports,inputs:Object.keys(result.metafile.inputs)};
});
const id='751aac72-4837-4326-a9c0-111111111111',otherId='512cefc0-af04-4619-930c-222222222222';
const doc=text=>JSON.stringify({version:1,value:[{type:'p',children:[{text}]}]});
const blank=doc(''),saved=doc('Saved text'),edited=doc('Changed text α');
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}

async function harness({metadata,content=edited,baseline=blank,sessionId=id,attach=true}={}){
 const {api}=await compiled,records=new Map();
 const state={id:sessionId,decision:'cancel',saveResult:null,saveGate:null,saveError:null,openResult:null,asks:[],saves:[],navigations:[],errors:[],remembered:[],scheduled:[],savedEvents:0,marks:[],canceledRecovery:0,newWindows:0};
 const storage={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,String(value)),removeItem:key=>records.delete(key)};
 if(sessionId){storage.setItem(api.documentDraftKey(sessionId),content);if(metadata)storage.setItem(api.documentMetadataKey(sessionId),JSON.stringify(metadata));}
 const ports={
  defaultDocumentName:'document.vulgar',documentSessionId:()=>state.id,draftStorage:()=>storage,legacyMetadata:()=>null,
  flushDocumentDraftStore:async()=>{},createId:()=>otherId,
  parseDocumentFile:source=>{const data=JSON.parse(source);if(data.version!==1||!Array.isArray(data.value)||!data.value.length)throw Error('Invalid document');return data.value;},
  documentContentKey:source=>JSON.stringify(JSON.parse(source)),newDocumentWindow:async()=>{state.newWindows++;},
  openDocumentFile:async()=>state.openResult,
  saveDocumentFile:async(source,target,name)=>{state.saves.push({source,target,name});if(state.saveGate)await state.saveGate.promise;if(state.saveError)throw Error(state.saveError);return state.saveResult;},
  takeSystemDocumentFile:async()=>null,getRecentDocumentTarget:async()=>null,openRecentDocument:async()=>state.openResult,
  rememberRecentDocument:async file=>{state.remembered.push(file);return {id:'recent-file'};},
  askToSave:async name=>{state.asks.push(name);return typeof state.decision==='function'?state.decision():state.decision;},
  navigate:target=>state.navigations.push(plain(target)),saved:()=>{state.savedEvents++;},reportError:(action,error)=>state.errors.push({action,error}),
  recordRuntimeEvent:async()=>{},schedule:(callback,delay)=>state.scheduled.push({callback,delay}),
 };
 const controller=api.createDocumentController(ports);
 const host={content,baseline,persist(){if(state.id)storage.setItem(api.documentDraftKey(state.id),this.content);},cancelPendingRecovery(){state.canceledRecovery++;},serializeDocument(){return this.content;},hasUnsavedChanges(){return this.content!==this.baseline;},markDocumentSaved(source){state.marks.push(source);this.baseline=source;},openDocument(source){this.content=source;}};
 if(attach)controller.attachDocumentHost(host);
 return {api,controller,host,state,storage,records,ports};
}

test('document controller bundles and runs without UI, platform or ambient browser dependencies',async()=>{
 const {inputs}=await compiled;
 assert.deepEqual(inputs,['src/document-controller.ts']);
 const h=await harness({attach:false,sessionId:null});
 assert.deepEqual(plain(h.controller.getDocumentState()),{name:null,dirty:false,busy:false,active:false,sessionId:null});
 await h.controller.runDocumentCommand('new');
 assert.deepEqual(h.state.navigations,[{kind:'document',documentId:otherId}]);
 assert.equal(h.records.size,0,'creating a new session does not invent a singleton draft');
});

test('independent controllers isolate state, subscriptions and pending file operations; untitled is data, not translated UI',async()=>{
 const a=await harness(),b=await harness({sessionId:otherId});
 assert.equal(a.controller.getDocumentState().name,null);assert.equal(b.controller.getDocumentState().name,null);
 let changesA=0,changesB=0;
 const unsubscribeA=a.controller.subscribeDocumentState(()=>changesA++),unsubscribeB=b.controller.subscribeDocumentState(()=>changesB++);
 a.state.saveGate=deferred();a.state.saveResult={name:'first.vulgar'};
 const savingA=a.controller.runDocumentCommand('save');await tick();
 assert.equal(a.controller.getDocumentState().busy,true);assert.equal(b.controller.getDocumentState().busy,false);assert.equal(changesB,0);
 const beforeA=changesA;b.state.saveResult={name:'second.vulgar'};await b.controller.runDocumentCommand('save');
 assert.equal(b.controller.getDocumentState().name,'second.vulgar');assert.equal(b.controller.getDocumentState().dirty,false);assert.equal(changesA,beforeA);
 assert.equal(a.controller.getDocumentState().name,null);assert.equal(a.controller.getDocumentState().dirty,true);
 a.state.saveGate.resolve();await savingA;
 assert.equal(a.controller.getDocumentState().name,'first.vulgar');assert.equal(a.controller.getDocumentState().dirty,false);
 assert.equal(b.controller.getDocumentState().name,'second.vulgar');assert.equal(a.state.saves.length,1);assert.equal(b.state.saves.length,1);
 unsubscribeA();unsubscribeB();
});

test('Save, Discard and Cancel decisions retain their file and recovery semantics without a dialog',async()=>{
 for(const decision of ['save','discard','cancel']){
  const h=await harness({metadata:{name:'paper.vulgar',baseline:saved},baseline:saved});
  h.state.decision=decision;h.state.saveResult={name:'paper.vulgar'};
  await h.controller.runDocumentCommand('home');
  assert.deepEqual(h.state.asks,['paper.vulgar']);assert.equal(h.host.content,edited);
  if(decision==='cancel'){
   assert.deepEqual(h.state.navigations,[]);assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),edited);assert.equal(h.host.baseline,saved);assert.equal(h.state.saves.length,0);
  }else{
   assert.deepEqual(h.state.navigations,[{kind:'home'}]);
   if(decision==='discard'){
    assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),saved);assert.equal(h.state.canceledRecovery,1);assert.equal(h.state.saves.length,0);
   }else{
    assert.equal(h.state.saves[0].source,edited);assert.equal(h.host.baseline,edited);assert.equal(JSON.parse(h.storage.getItem(h.api.documentMetadataKey(id))).baseline,edited);assert.equal(h.state.savedEvents,1);
   }
  }
 }
});

test('failed or canceled saves cannot leave the document, and edits during Save remain unsaved',async()=>{
 for(const failure of ['cancel','disk full']){
  const h=await harness({metadata:{name:'paper.vulgar',baseline:saved},baseline:saved});h.state.decision='save';
  if(failure!=='cancel')h.state.saveError=failure;
  await h.controller.runDocumentCommand('home');
  assert.deepEqual(h.state.navigations,[]);assert.equal(h.host.content,edited);assert.equal(h.host.baseline,saved);assert.equal(h.controller.getDocumentState().dirty,true);
  assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),edited);assert.equal(h.state.errors.length,failure==='cancel'?0:1);
 }
 const h=await harness({metadata:{name:'paper.vulgar',baseline:saved},baseline:saved});h.state.decision='save';h.state.saveResult={name:'paper.vulgar'};h.state.saveGate=deferred();
 const pending=h.controller.runDocumentCommand('home');await tick();
 const newer=doc('Newer edit during save');h.host.content=newer;h.host.persist();h.state.saveGate.resolve();await pending;
 assert.deepEqual(h.state.navigations,[]);assert.equal(h.state.saves[0].source,edited);assert.equal(h.host.baseline,edited);assert.equal(h.host.content,newer);assert.equal(h.controller.getDocumentState().dirty,true);
 assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),newer);
});

test('recovering an existing session preserves its saved baseline and does not pretend to open a recent file',async()=>{
 const h=await harness({attach:false,sessionId:null});
 const metadata=JSON.stringify({name:'recovered.vulgar',baseline:saved,path:'C:/notes/recovered.vulgar'});
 h.storage.setItem(h.api.documentDraftKey(otherId),edited);h.storage.setItem(h.api.documentMetadataKey(otherId),metadata);
 await h.controller.openRecoveredDocumentCommand(otherId);
 assert.deepEqual(h.state.navigations,[{kind:'document',documentId:otherId}]);assert.equal(h.storage.getItem(h.api.documentMetadataKey(otherId)),metadata);assert.equal(h.state.remembered.length,0);
 h.state.id=otherId;
 const reopened=h.api.createDocumentController(h.ports);reopened.attachDocumentHost(h.host);
 assert.equal(h.host.baseline,saved);assert.equal(h.host.content,edited);assert.equal(reopened.getDocumentState().dirty,true);assert.equal(reopened.getDocumentState().name,'recovered.vulgar');
});

test('invalid or vanished recovery targets never discard current edits',async()=>{
 for(const target of ['bad-id',otherId]){
  const h=await harness({metadata:{name:'active.vulgar',baseline:saved},baseline:saved});h.state.decision='discard';
  await h.controller.openRecoveredDocumentCommand(target);
  assert.equal(h.state.errors.length,1);assert.equal(h.state.errors[0].error.code,target==='bad-id'?'invalid-recovery':'missing-recovery');
  assert.equal(h.state.asks.length,0);assert.equal(h.state.canceledRecovery,0);assert.deepEqual(h.state.navigations,[]);assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),edited);
 }
 const h=await harness({metadata:{name:'active.vulgar',baseline:saved},baseline:saved});h.storage.setItem(h.api.documentDraftKey(otherId),doc('Recovery text'));
 h.state.decision=()=>{h.storage.removeItem(h.api.documentDraftKey(otherId));return 'discard';};
 await h.controller.openRecoveredDocumentCommand(otherId);
 assert.equal(h.state.errors[0].error.code,'missing-recovery');assert.equal(h.state.canceledRecovery,0);assert.deepEqual(h.state.navigations,[]);assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),edited);assert.equal(h.host.content,edited);
});

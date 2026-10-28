const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const source=build({entryPoints:['src/document-lifecycle.ts'],bundle:true,write:false,format:'iife',globalName:'lifecycle',plugins:[{name:'lifecycle-adapters',setup(b){
 const stubs={
  '@tauri-apps/api/core':'export const isTauri=()=>globalThis.lifecycleTest.desktop;export const invoke=async()=>{};',
  '@tauri-apps/api/window':`export const getCurrentWindow=()=>({setTitle:async title=>globalThis.lifecycleTest.titles.push(title),onCloseRequested:async handler=>{globalThis.lifecycleTest.closeHandler=handler;return()=>{globalThis.lifecycleTest.closeHandler=null;};},destroy:async()=>{const s=globalThis.lifecycleTest;if(s.beforeUnloadOnDestroy)window.dispatchEvent(new Event('beforeunload',{cancelable:true}));if(s.destroyError)throw Error(s.destroyError);s.destroyed++;}});`,
  './i18n':'export const t=value=>value;',
  './plate-document':`export const parseDocumentFile=source=>{const data=JSON.parse(source);if(data.version!==1||!Array.isArray(data.value)||!data.value.length)throw Error('Invalid document format');return data.value;};export const documentContentKey=source=>JSON.stringify(JSON.parse(source),(key,value)=>key==='snapshot'&&typeof value==='string'?JSON.parse(value).root:value);`,
  './platform':`export const defaultDocumentName='document.vulgar';export const documentSessionId=()=>new URL(window.location.href).searchParams.get('document');export const draftStorage=()=>{const s=globalThis.lifecycleTest,storage=s.desktop?localStorage:sessionStorage;return s.storageFail?{getItem:key=>storage.getItem(key),removeItem:key=>storage.removeItem(key),setItem:()=>{throw Error('storage quota');}}:storage;};
   export const flushDocumentDraftStore=async()=>{const s=globalThis.lifecycleTest;s.flushes++;if(s.flushPending&&(!s.flushPendingAt||s.flushPendingAt===s.flushes))await s.flushPending;if(s.flushError&&(!s.flushErrorAt||s.flushErrorAt===s.flushes))throw Error(s.flushError);};
   export const newDocumentWindow=async()=>{const s=globalThis.lifecycleTest;s.newWindows++;if(s.newError)throw Error(s.newError);if(s.newPending)await s.newPending;};
   export const openDocumentFile=async()=>{const s=globalThis.lifecycleTest;s.pickers++;if(s.openError)throw Error(s.openError);if(s.openPending)await s.openPending;return s.openResult;};
   export const saveDocumentFile=async(source,target,name)=>{const s=globalThis.lifecycleTest;s.saves.push({source,target,name});if(s.saveError)throw Error(s.saveError);if(s.savePending)await s.savePending;return s.saveResult;};`,
  './recent-documents':`export const rememberRecentDocument=async file=>{const s=globalThis.lifecycleTest;s.remembered.push(file);if(s.rememberPending)await s.rememberPending;return {id:s.recentId};};export const openRecentDocument=async id=>{const s=globalThis.lifecycleTest;s.openedRecent.push(id);if(s.openPending)await s.openPending;return s.openResult;};export const getRecentDocumentTarget=async id=>{const s=globalThis.lifecycleTest;s.restored.push(id);if(s.restorePending)await s.restorePending;return s.restoredTarget;};`,
 };
 b.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'lifecycle-test'}:undefined);
 b.onLoad({filter:/.*/,namespace:'lifecycle-test'},args=>({contents:stubs[args.path],loader:'js'}));
}}]}).then(r=>r.outputFiles[0].text);
const id='6fb73c41-018b-4ce0-957b-0123456789ab';
const doc=text=>JSON.stringify({version:1,value:[{type:'p',children:[{text}]}]});
const blank=doc(''),saved=doc('Previously saved'),edited=doc('Unsaved CJK 中文 and formula');
async function harness(t,{desktop=false,home=false,metadata,content=edited,baseline=saved}={}){
 const {Window}=await import('happy-dom');
 const window=new Window({url:'http://localhost/vulgar-notes/'+(home?'':'?document='+id)});
 let counter=0;Object.defineProperty(window,'crypto',{configurable:true,value:{randomUUID:()=>`6b363044-6c9a-4653-a2ba-${String(++counter).padStart(12,'0')}`}});
 const state=window.lifecycleTest={desktop,titles:[],newWindows:0,pickers:0,saves:[],remembered:[],openedRecent:[],restored:[],destroyed:0,openResult:null,saveResult:null,recentId:'recent-test',restoredTarget:null,flushes:0};
 const storage=desktop?window.localStorage:window.sessionStorage;
 if(metadata)storage.setItem('editor.open-document:'+id,JSON.stringify(metadata));
 storage.setItem('math-plate-document-v1:'+id,content);
 const events={start:[],home:[],saved:[],errors:[]};
 for(const [name,key] of [['vulgar-document-start','start'],['vulgar-document-home','home'],['vulgar-document-saved','saved'],['vulgar-document-error','errors']])window.addEventListener(name,e=>events[key].push(e.detail));
 window.eval(await source+'\nwindow.lifecycle=lifecycle;');
 const api=window.lifecycle;
 const calls={persist:0,marks:[],opened:[]};
 const host={content,baseline,persist(){calls.persist++;storage.setItem('math-plate-document-v1:'+id,this.content);},serializeDocument(){if(state.persistOnSerialize)this.persist();return this.content;},hasUnsavedChanges(){return this.serializeDocument()!==this.baseline;},markDocumentSaved(value){calls.marks.push(value);this.baseline=value;},openDocument(value){calls.opened.push(value);this.content=value;}};
 let detach;if(!home)detach=api.attachDocumentHost(host);
 const cleanup=api.initDocumentLifecycle();
 const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
 const prompt=choice=>{const button=window.document.querySelector(`dialog[data-document-unsaved-prompt] button[data-choice="${choice}"]`);assert.ok(button,'Save / Discard / Cancel must be explicit choices');button.click();};
 t.after(async()=>{detach?.();cleanup();await window.happyDOM.abort();});
 return {window,storage,state,api,host,calls,events,tick,prompt,reattach(){detach?.();detach=api.attachDocumentHost(host);}};
}

test('home opens a validated file with its own prepared draft, baseline and recent source',async t=>{
 const h=await harness(t,{home:true});const file=h.state.openResult={name:'actual.vulgar',path:'C:\\notes\\actual.vulgar',text:saved};
 await h.api.runDocumentCommand('open');assert.equal(h.events.start.length,1);
 const start=h.events.start[0];assert.equal(start.opened,file);assert.notEqual(start.documentId,id);
 assert.equal(h.storage.getItem(h.api.documentDraftKey(start.documentId)),saved);
 const metadata=JSON.parse(h.storage.getItem(h.api.documentMetadataKey(start.documentId)));
 assert.equal(metadata.baseline,saved);assert.equal(metadata.name,file.name);assert.equal(metadata.recentId,'recent-test');assert.equal(metadata.pendingOpen,true);
 assert.equal(h.state.remembered[0],file);assert.equal(h.api.getDocumentState().active,false);
});

test('reload restores a saved baseline without marking recovered edits as saved',async t=>{
 const metadata={name:'actual.vulgar',path:'C:\\notes\\actual.vulgar',recentId:'original',baseline:saved};
 const h=await harness(t,{desktop:true,metadata});await h.tick();
 assert.deepEqual(h.calls.marks,[saved]);assert.equal(h.api.getDocumentState().dirty,true);assert.equal(h.api.getDocumentState().name,'actual.vulgar');
 assert.match(h.window.document.title,/^\* actual\.vulgar/);assert.equal(h.host.content,edited);
 assert.deepEqual(h.state.restored,['original']);assert.equal(h.storage,h.window.localStorage);
 h.reattach();assert.equal(h.api.getDocumentState().dirty,true);assert.deepEqual(h.calls.marks,[saved,saved]);
});

test('first open may normalize its baseline once, but the next reload preserves edits',async t=>{
 const h=await harness(t,{metadata:{name:'normalized.vulgar',baseline:saved,pendingOpen:true},content:doc('Normalized with stable IDs')});
 assert.equal(h.api.getDocumentState().dirty,false);assert.equal(JSON.parse(h.storage.getItem(h.api.documentMetadataKey(id))).pendingOpen,undefined);
 const normalized=h.host.content;h.host.content=edited;h.reattach();
 assert.equal(h.host.baseline,normalized);assert.equal(h.api.getDocumentState().dirty,true);
});

test('Cancel retains unsaved content and Discard resets only that document recovery',async t=>{
 const h=await harness(t,{metadata:{name:'original.vulgar',baseline:saved}});
 h.state.persistOnSerialize=true;
 const other='math-plate-document-v1:another';h.storage.setItem(other,'other document');
 let pending=h.api.runDocumentCommand('home');await h.tick();h.prompt('cancel');await pending;
 assert.equal(h.events.home.length,0);assert.equal(h.host.content,edited);assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),edited);
 pending=h.api.runDocumentCommand('home');await h.tick();h.prompt('discard');await pending;
 assert.equal(h.events.home.length,1);assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),saved);assert.equal(h.storage.getItem(other),'other document');
});

test('discarding a never-saved document removes its recovery instead of creating a default file',async t=>{
 const h=await harness(t,{baseline:blank});const pending=h.api.runDocumentCommand('home');await h.tick();h.prompt('discard');await pending;
 assert.equal(h.events.home.length,1);assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),null);assert.equal(h.api.getDocumentState().name,'Untitled');
});

test('cancelled or failed Save never continues Open, Home or native close',async t=>{
 const h=await harness(t,{metadata:{name:'saved.vulgar',baseline:saved}});
 let pending=h.api.runDocumentCommand('open');await h.tick();h.prompt('save');await pending;
 assert.equal(h.state.saves.length,1);assert.equal(h.state.pickers,0);assert.equal(h.events.start.length,0);assert.equal(h.api.getDocumentState().dirty,true);
 h.state.saveError='disk full';pending=h.api.runDocumentCommand('home');await h.tick();h.prompt('save');await pending;
 assert.equal(h.events.home.length,0);assert.equal(h.events.errors.length,1);assert.match(h.events.errors[0].error,/disk full/);
 assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),edited);assert.equal(h.calls.marks.length,1);
});

test('Save commits a real target and baseline before returning Home',async t=>{
 const h=await harness(t,{metadata:{name:'saved.vulgar',baseline:saved}});const file=h.state.saveResult={name:'new.vulgar',path:'C:\\notes\\new.vulgar'};
 const pending=h.api.runDocumentCommand('home');await h.tick();h.prompt('save');await pending;
 assert.equal(h.events.home.length,1);assert.equal(h.api.getDocumentState().dirty,false);assert.equal(h.host.baseline,edited);
 const metadata=JSON.parse(h.storage.getItem(h.api.documentMetadataKey(id)));assert.equal(metadata.baseline,edited);assert.equal(metadata.name,file.name);assert.equal(metadata.recentId,'recent-test');
 assert.equal(h.state.remembered.at(-1),file);assert.equal(h.events.saved.length,1);
});

test('a canceled picker or invalid new file keeps even a Discard decision uncommitted',async t=>{
 const h=await harness(t,{metadata:{name:'saved.vulgar',baseline:saved}});
 for(const result of [null,{name:'invalid.vulgar',text:'not JSON'}]){
  h.state.openResult=result;const pending=h.api.runDocumentCommand('open');await h.tick();h.prompt('discard');await pending;
  assert.equal(h.events.start.length,0);assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),edited);
 }
 assert.equal(h.events.errors.length,1);assert.equal(h.host.content,edited);
});

test('preparing another document is transactional when recovery storage is unavailable',async t=>{
 const h=await harness(t,{metadata:{name:'saved.vulgar',baseline:saved}});h.state.openResult={name:'next.vulgar',text:saved};
 const pending=h.api.runDocumentCommand('open');await h.tick();
 h.state.storageFail=true;
 h.prompt('discard');await pending;
 assert.equal(h.events.start.length,0);assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),edited);assert.equal(h.events.errors.length,1);
});

test('Open waits for the prepared document to commit before navigating',async t=>{
 const h=await harness(t,{home:true});let release;
 h.state.flushPending=new Promise(resolve=>release=resolve);h.state.flushPendingAt=2;
 h.state.openResult={name:'large.vulgar',text:doc('Full paper with embedded images')};
 const pending=h.api.runDocumentCommand('open');await h.tick();
 assert.equal(h.state.flushes,2);assert.equal(h.events.start.length,0);
 release();await pending;
 assert.equal(h.events.start.length,1);assert.equal(h.events.errors.length,0);
});

test('a failed document commit removes only the abandoned session and keeps the current recovery',async t=>{
 const h=await harness(t,{metadata:{name:'saved.vulgar',baseline:saved}});
 h.state.openResult={name:'large.vulgar',text:doc('Full paper')};h.state.flushError='IndexedDB quota';h.state.flushErrorAt=2;
 const pending=h.api.runDocumentCommand('open');await h.tick();h.prompt('discard');await pending;
 assert.equal(h.events.start.length,0);assert.equal(h.host.content,edited);
 assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),edited);assert.equal(h.storage.length,2);
 assert.equal(h.state.flushes,3,'cleanup is committed after the failed preparation');assert.match(h.events.errors[0].error,/IndexedDB quota/);
});

test('edits made while the new document commits cancel Open and clean its prepared session',async t=>{
 const h=await harness(t,{metadata:{name:'saved.vulgar',baseline:saved},content:saved});let release;
 h.state.flushPending=new Promise(resolve=>release=resolve);h.state.flushPendingAt=2;
 h.state.openResult={name:'next.vulgar',text:doc('Other paper')};
 const pending=h.api.runDocumentCommand('open');await h.tick();
 assert.equal(h.state.flushes,2);h.host.content=edited;h.host.persist();release();await pending;
 assert.equal(h.events.start.length,0);assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),edited);
 assert.equal(h.storage.length,2);assert.match(h.events.errors[0].error,/document changed/);
});

test('Home flushes the latest recovery before deciding whether unsaved edits need a prompt',async t=>{
 const h=await harness(t,{metadata:{name:'saved.vulgar',baseline:saved}});let release;
 h.state.flushPending=new Promise(resolve=>release=resolve);
 const pending=h.api.runDocumentCommand('home');await h.tick();
 assert.equal(h.events.home.length,0);assert.equal(h.window.document.querySelector('dialog'),null);
 const newer=doc('Typed while recovery was committing');h.host.content=newer;h.host.persist();release();await h.tick();
 h.prompt('cancel');await pending;
 assert.equal(h.events.home.length,0);assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),newer);
 assert.equal(h.host.baseline,saved);assert.equal(h.events.errors.length,0);
});

test('a successful file Save remains successful when recovery commit fails',async t=>{
 const h=await harness(t,{metadata:{name:'saved.vulgar',baseline:saved}});
 h.state.saveResult={name:'saved.vulgar'};h.state.flushError='IndexedDB quota';
 await h.api.runDocumentCommand('save');
 assert.equal(h.state.saves.length,1);assert.equal(h.host.baseline,edited);assert.equal(h.events.saved.length,1);
 assert.equal(h.events.errors.length,0);assert.equal(h.api.getDocumentState().dirty,false);
});

test('Save then Home can leave after the file is safe even if its recovery cache cannot commit',async t=>{
 const h=await harness(t,{metadata:{name:'saved.vulgar',baseline:saved}});
 h.state.saveResult={name:'saved.vulgar'};h.state.flushError='IndexedDB quota';
 const pending=h.api.runDocumentCommand('home');await h.tick();h.prompt('save');await pending;
 assert.equal(h.events.home.length,1);assert.equal(h.events.saved.length,1);assert.equal(h.events.errors.length,0);
});

test('edits made during Open or recent-file reading abort navigation and remain recoverable',async t=>{
 for(const recent of [false,true]){
  const h=await harness(t,{metadata:{name:'saved.vulgar',baseline:saved},content:saved});h.state.persistOnSerialize=true;
  let release;h.state.openPending=new Promise(resolve=>release=resolve);h.state.openResult={name:'next.vulgar',text:saved};
  const pending=recent?h.api.openRecentDocumentCommand('recent-source'):h.api.runDocumentCommand('open');await h.tick();
  h.host.content=edited;release();await pending;
  assert.equal(h.events.start.length,0);assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),edited);assert.equal(h.api.getDocumentState().dirty,true);assert.match(h.events.errors[0].error,/document changed/);
  assert.equal(h.storage.length,2,'aborted opens must not leave a second document session behind');
 }
});

test('edits after Discard while recent-handle registration awaits invalidate the prior choice',async t=>{
 const h=await harness(t,{metadata:{name:'saved.vulgar',baseline:saved}});h.state.persistOnSerialize=true;
 let release;h.state.rememberPending=new Promise(resolve=>release=resolve);h.state.openResult={name:'next.vulgar',text:saved};
 const pending=h.api.runDocumentCommand('open');await h.tick();h.prompt('discard');await h.tick();
 const newer=doc('Typed after the picker closed');h.host.content=newer;release();await pending;
 assert.equal(h.events.start.length,0);assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),newer);assert.equal(h.host.baseline,saved);assert.equal(h.storage.length,2);assert.match(h.events.errors[0].error,/document changed/);
});

test('New in an active document creates a separate editor without changing its target or baseline',async t=>{
 const h=await harness(t,{metadata:{name:'saved.vulgar',path:'C:\\notes\\saved.vulgar',baseline:saved}});const before=h.storage.getItem(h.api.documentMetadataKey(id));
 await h.api.runDocumentCommand('new');assert.equal(h.state.newWindows,1);assert.equal(h.events.start.length,0);assert.equal(h.host.content,edited);assert.equal(h.host.baseline,saved);assert.equal(h.storage.getItem(h.api.documentMetadataKey(id)),before);
 h.state.newError='creation denied';await h.api.runDocumentCommand('new');assert.equal(h.events.errors.length,1);assert.equal(h.api.getDocumentState().busy,false);
});

test('home New has a UUID and no preloaded sample or default document',async t=>{
 const h=await harness(t,{home:true});await h.api.runDocumentCommand('new');assert.equal(h.state.newWindows,0);assert.equal(h.events.start.length,1);assert.match(h.events.start[0].documentId,/^[\da-f-]{36}$/);assert.equal(h.events.start[0].opened,undefined);
});

test('recent files reopen their current source through the same UUID preparation path',async t=>{
 const h=await harness(t,{home:true});h.state.openResult={name:'recent.vulgar',text:doc('Fresh file bytes')};
 await h.api.openRecentDocumentCommand('recent-source');assert.deepEqual(h.state.openedRecent,['recent-source']);
 assert.equal(h.state.pickers,0);assert.equal(h.events.start.length,1);const started=h.events.start[0];
 assert.equal(h.storage.getItem(h.api.documentDraftKey(started.documentId)),doc('Fresh file bytes'));
 h.state.openResult=null;await h.api.openRecentDocumentCommand('canceled-source');assert.equal(h.events.start.length,1);
});

test('Save preserves restored browser targets; Save As deliberately asks for a new target',async t=>{
 const target={name:'original.vulgar',opaqueHandle:'private-to-platform'};
 const h=await harness(t,{metadata:{name:'original.vulgar',baseline:saved,recentId:'original'}});h.state.restoredTarget=target;
 h.reattach();h.state.saveResult={name:'saved.vulgar'};await h.api.runDocumentCommand('save');assert.equal(h.state.saves[0].target,target);
 const retained=h.state.saveResult;await h.api.runDocumentCommand('save');assert.equal(h.state.saves[1].target,retained);
 await h.api.runDocumentCommand('saveAs');assert.equal(h.state.saves[2].target,undefined);assert.equal(h.state.saves[2].name,'saved.vulgar');
});

test('editing during an asynchronous save keeps newer changes unsaved and prevents navigation',async t=>{
 const h=await harness(t,{metadata:{name:'saved.vulgar',baseline:saved}});let release;h.state.savePending=new Promise(resolve=>release=resolve);h.state.saveResult={name:'saved.vulgar'};
 const pending=h.api.runDocumentCommand('home');await h.tick();h.prompt('save');await h.tick();h.host.content=doc('Typed while saving');release();await pending;
 assert.equal(h.host.baseline,edited);assert.equal(h.api.getDocumentState().dirty,true);assert.equal(h.events.home.length,0);
});

test('browser close warns for dirty documents and only a confirmed navigation bypasses it once',async t=>{
 const h=await harness(t,{metadata:{name:'saved.vulgar',baseline:saved}});
 const unload=()=>{const event=new h.window.Event('beforeunload',{cancelable:true});h.window.dispatchEvent(event);return event.defaultPrevented;};
 assert.equal(unload(),true);
 const pending=h.api.runDocumentCommand('home');await h.tick();h.prompt('discard');await pending;
 assert.equal(unload(),false);assert.equal(unload(),true);
});

test('native close offers the same three choices and canceled Save cannot destroy the window',async t=>{
 const h=await harness(t,{desktop:true,metadata:{name:'saved.vulgar',baseline:saved}});await h.tick();assert.equal(typeof h.state.closeHandler,'function');
 let prevented=0;h.state.closeHandler({preventDefault(){prevented++;}});await h.tick();h.prompt('save');await h.tick();assert.equal(h.state.destroyed,0);assert.equal(prevented,1);
 h.state.closeHandler({preventDefault(){prevented++;}});await h.tick();h.prompt('cancel');await h.tick();assert.equal(h.state.destroyed,0);
 h.state.closeHandler({preventDefault(){prevented++;}});await h.tick();h.prompt('discard');await h.tick();assert.equal(h.state.destroyed,1);assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),saved);
});

test('native close commits the latest clean-document recovery before destroying its window',async t=>{
 const h=await harness(t,{desktop:true,metadata:{name:'saved.vulgar',baseline:saved},content:saved});await h.tick();let release;
 h.state.flushPending=new Promise(resolve=>release=resolve);
 let prevented=0;h.state.closeHandler({preventDefault(){prevented++;}});await h.tick();
 assert.equal(prevented,1);assert.equal(h.state.destroyed,0);assert.equal(h.window.document.querySelector('dialog'),null);
 release();await h.tick();assert.equal(h.state.destroyed,1);assert.equal(h.events.errors.length,0);
});

test('edits during the recovery commit after Save remain dirty and prevent Home',async t=>{
 const h=await harness(t,{metadata:{name:'saved.vulgar',baseline:saved}});let release;
 h.state.saveResult={name:'saved.vulgar'};h.state.flushPending=new Promise(resolve=>release=resolve);h.state.flushPendingAt=2;
 const pending=h.api.runDocumentCommand('home');await h.tick();h.prompt('save');await h.tick();
 const newer=doc('Typed after the real file write');h.host.content=newer;h.host.persist();release();await pending;
 assert.equal(h.host.baseline,edited);assert.equal(h.host.content,newer);assert.equal(h.events.home.length,0);
 assert.equal(h.events.saved.length,1);assert.equal(h.api.getDocumentState().dirty,true);assert.equal(h.events.errors.length,0);
});

test('a rejected native close restores the unsaved recovery and dirty protection',async t=>{
 const h=await harness(t,{desktop:true,metadata:{name:'saved.vulgar',baseline:saved}});h.state.persistOnSerialize=true;h.state.destroyError='window close rejected';await h.tick();
 h.state.closeHandler({preventDefault(){}});await h.tick();h.prompt('discard');await h.tick();
 assert.equal(h.state.destroyed,0);assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),edited);assert.equal(h.api.getDocumentState().dirty,true);assert.equal(h.api.getDocumentState().busy,false);assert.match(h.events.errors[0].error,/window close rejected/);
});

test('native beforeunload during confirmed destruction cannot recreate discarded recovery',async t=>{
 for(const metadata of [{name:'saved.vulgar',baseline:saved},undefined]){
  const h=await harness(t,{desktop:true,metadata,baseline:blank});h.state.persistOnSerialize=true;h.state.beforeUnloadOnDestroy=true;await h.tick();
  h.state.closeHandler({preventDefault(){}});await h.tick();h.prompt('discard');await h.tick();
  assert.equal(h.state.destroyed,1);assert.equal(h.storage.getItem(h.api.documentDraftKey(id)),metadata?saved:null);
 }
});

test('keyboard New locks while pending, ignores repeats, modifiers and modal dialogs',async t=>{
 const h=await harness(t);let release;h.state.newPending=new Promise(resolve=>release=resolve);
 const shortcut=(key,options={})=>{const event=new h.window.KeyboardEvent('keydown',{key,ctrlKey:true,bubbles:true,cancelable:true,...options});h.window.document.dispatchEvent(event);return event;};
 assert.equal(shortcut('n').defaultPrevented,true);assert.equal(h.state.newWindows,1);assert.equal(h.api.getDocumentState().busy,true);shortcut('n');shortcut('n',{repeat:true});assert.equal(h.state.newWindows,1);
 release();await h.tick();assert.equal(h.api.getDocumentState().busy,false);
 assert.equal(shortcut('n',{shiftKey:true}).defaultPrevented,false);assert.equal(shortcut('n',{altKey:true}).defaultPrevented,false);
 assert.equal(shortcut('n',{isComposing:true}).defaultPrevented,false);assert.equal(shortcut('n',{keyCode:229}).defaultPrevented,false);assert.equal(h.state.newWindows,1);
 const dialog=h.window.document.createElement('dialog');h.window.document.body.append(dialog);dialog.showModal();assert.equal(shortcut('n').defaultPrevented,false);dialog.remove();
 shortcut('n',{ctrlKey:false,metaKey:true});await h.tick();assert.equal(h.state.newWindows,2);
});

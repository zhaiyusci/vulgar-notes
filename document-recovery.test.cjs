const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const vm=require('node:vm');
const crypto=require('node:crypto').webcrypto;
const compiled=build({entryPoints:['src/document-recovery.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'recovery-adapters',setup(build){
 build.onResolve({filter:/^(\.\/platform|\.\/i18n)$/},args=>({path:args.path,namespace:'recovery-test'}));
 build.onLoad({filter:/.*/,namespace:'recovery-test'},args=>({contents:args.path.endsWith('platform')?'export const draftStorage=()=>localStorage;export const documentSessionId=()=>activeId;':"export const locale='en';export const t=value=>value;"}));
}}]}).then(result=>result.outputFiles[0].text);
function storage(){const entries=new Map();return {get length(){return entries.size},key:i=>[...entries.keys()][i]??null,getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,String(value)),removeItem:key=>entries.delete(key)};}
async function load(localStorage=storage(),sessionStorage=storage(),activeId=null){
 const module={exports:{}};vm.runInNewContext(await compiled,{module,exports:module.exports,console,crypto,TextEncoder,TextDecoder,localStorage,sessionStorage,activeId});return {api:module.exports,localStorage,sessionStorage};
}
const doc=(text,extra={})=>JSON.stringify({version:1,value:[{type:'p',children:[{text}],...extra}]});
const id='11111111-1111-4111-8111-111111111111',key='math-plate-document-v1:'+id;

test('startup creates no singleton or sample document',async()=>{
 const h=await load();await h.api.prepareDocumentRecovery();assert.equal(h.localStorage.length,0);assert.equal(h.api.listRecoverableDocuments().length,0);
});
test('old tab drafts migrate once to durable per-file recovery and preserve saved baselines',async()=>{
 const h=await load(),original=doc('Saved'),edited=doc('Unsaved formula prose α');
 h.sessionStorage.setItem(key,edited);h.sessionStorage.setItem('editor.open-document:'+id,JSON.stringify({name:'Paper.vulgar',baseline:original,path:'C:\\notes\\Paper.vulgar'}));
 await h.api.prepareDocumentRecovery();assert.equal(h.localStorage.getItem(key),edited);assert.equal(h.sessionStorage.getItem(key),edited);
 assert.deepEqual(JSON.parse(JSON.stringify(h.api.listRecoverableDocuments())),[{id,name:'Paper.vulgar'}]);
 h.localStorage.setItem(key,doc('Newer edits'));await h.api.prepareDocumentRecovery();assert.equal(h.api.listRecoverableDocuments().length,1,'stale original tab data must not duplicate a newer recovered view');assert.equal(h.localStorage.getItem(key),doc('Newer edits'));
});
test('conflicting old-tab recovery retains both documents instead of overwriting',async()=>{
 const h=await load();h.localStorage.setItem(key,doc('Durable content'));h.sessionStorage.setItem(key,doc('Other original tab content'));
 await h.api.prepareDocumentRecovery();assert.equal(h.api.listRecoverableDocuments().length,2);assert.equal(h.localStorage.getItem(key),doc('Durable content'));
 await h.api.prepareDocumentRecovery();assert.equal(h.api.listRecoverableDocuments().length,2);
});
test('an upgraded active tab follows its own migrated edits when a durable view differs',async()=>{
 const local=storage(),session=storage(),h=await load(local,session,id);local.setItem(key,doc('Other durable view'));session.setItem(key,doc('This tab unsaved text'));
 const remapped=await h.api.prepareDocumentRecovery();assert.ok(remapped);assert.notEqual(remapped,id);assert.equal(local.getItem('math-plate-document-v1:'+remapped),doc('This tab unsaved text'));assert.equal(local.getItem(key),doc('Other durable view'));
 assert.equal(await (await load(local,session,remapped)).api.prepareDocumentRecovery(),undefined);assert.equal(h.api.listRecoverableDocuments().length,2);
});
test('legacy singleton becomes a recovery item without changing original bytes or duplicating on restart',async()=>{
 const h=await load(),raw=doc('Previous default draft');h.localStorage.setItem('math-plate-document-v1',raw);
 await h.api.prepareDocumentRecovery();const items=h.api.listRecoverableDocuments();assert.equal(items.length,1);assert.notEqual(items[0].id,id);assert.equal(h.localStorage.getItem('math-plate-document-v1'),raw);
 await h.api.prepareDocumentRecovery();assert.equal(h.api.listRecoverableDocuments().length,1);
});
test('clean saved files and pristine normalized blanks do not appear as unsaved documents',async()=>{
 const h=await load();h.localStorage.setItem(key,doc('Saved content'));h.localStorage.setItem('editor.open-document:'+id,JSON.stringify({name:'Saved.vulgar',baseline:doc('Saved content')}));
 assert.equal(h.api.listRecoverableDocuments().length,0);
 h.localStorage.setItem(key,doc('',{id:'normalized-plate-id'}));h.localStorage.removeItem('editor.open-document:'+id);assert.equal(h.api.listRecoverableDocuments().length,0);
 h.localStorage.setItem(key,JSON.stringify({version:1,value:[{type:'h1',children:[{text:''}]}]}));assert.equal(h.api.listRecoverableDocuments().length,1,'a formatting change still belongs to the document');
});
test('migrating a clean legacy file does not confuse absent and empty library metadata',async()=>{
 const h=await load(),source=doc('Already saved');h.localStorage.setItem('math-plate-document-v1',source);h.sessionStorage.setItem('editor.open-document',JSON.stringify({name:'Saved.vulgar',baseline:source}));
 await h.api.prepareDocumentRecovery();assert.equal(h.api.listRecoverableDocuments().length,0);
});
test('corrupt metadata and old malformed bytes never erase readable recovery content',async()=>{
 const h=await load();h.localStorage.setItem(key,doc('Readable content'));h.localStorage.setItem('editor.open-document:'+id,'bad metadata');
 h.localStorage.setItem('math-plate-document-v1','bad original document');await h.api.prepareDocumentRecovery();assert.equal(h.api.listRecoverableDocuments().length,1);assert.equal(h.localStorage.getItem('math-plate-document-v1'),'bad original document');
 assert.deepEqual(JSON.parse(JSON.stringify(h.api.listRecoverableDocuments())),[{id}],'missing names remain data, not a translated UI label');
 h.localStorage.setItem('editor.open-document:'+id,JSON.stringify({name:''}));
 assert.deepEqual(JSON.parse(JSON.stringify(h.api.listRecoverableDocuments())),[{id}],'an empty name does not invent a document title');
});

const preferencesUI=build({entryPoints:['src/document-recovery-preferences.ts'],bundle:true,write:false,format:'iife',globalName:'recoveryPreferences',plugins:[{name:'recovery-ui-locale',setup(b){
 b.onResolve({filter:/^\.\/i18n$/},()=>({path:'i18n',namespace:'recovery-ui-test'}));
 b.onLoad({filter:/.*/,namespace:'recovery-ui-test'},()=>({contents:"export const locale='en';export const t=value=>value;"}));
}}]}).then(result=>result.outputFiles[0].text);
async function recoveryUI(t,list){
 const {Window}=await import('happy-dom'),fs=require('node:fs');
 const window=new Window({url:'http://localhost/'});t.after(()=>window.happyDOM.abort());
 const markup=fs.readFileSync('mathjax4_editor_prototype_document_typeset.html','utf8').match(/<dialog id="preferencesDialog"[\s\S]*?<\/dialog>/)[0];
 window.document.write(markup);window.eval(await preferencesUI+'\nwindow.recoveryPreferences=recoveryPreferences;');
 const dialog=window.document.getElementById('preferencesDialog'),section=window.document.getElementById('documentRecovery'),opened=[];
 window.recoveryPreferences.initDocumentRecoveryPreferences({list,open:id=>opened.push({id,preferencesOpen:dialog.open})});
 const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
 return {window,dialog,section,opened,tick};
}

test('recovery is read only on explicit expansion in Preferences, never on the start page',async t=>{
 let reads=0;
 const h=await recoveryUI(t,async()=>{reads++;return [{id,name:'<img src=x>.vulgar',updatedAt:1793050000000},{id:'unnamed'}];});
 await h.tick();assert.equal(reads,0);
 h.dialog.showModal();await h.tick();assert.equal(reads,0,'opening Preferences does not scan documents');
 h.section.open=true;await h.tick();assert.equal(reads,1);
 const button=h.section.querySelector('[data-recovery-id]');assert.equal(button.textContent.startsWith('<img src=x>.vulgar'),true);assert.equal(h.section.querySelector('img'),null);
 assert.equal(h.section.querySelector('[data-recovery-id="unnamed"]').textContent,'Untitled','only the UI supplies the missing-name label');
 button.click();await h.tick();assert.deepEqual(h.opened,[{id,preferencesOpen:false}]);
 assert.equal(h.section.open,false);assert.equal(h.section.querySelector('[data-recovery-id]'),null);
 h.dialog.showModal();await h.tick();assert.equal(reads,1,'reopening Preferences leaves recovery collapsed');
});

test('closing Preferences ignores late recovery results; failures leave old recovery available to retry',async t=>{
 let resolve,fail=false;
 const h=await recoveryUI(t,()=>fail?Promise.reject(Error('unavailable')):new Promise(done=>{resolve=done;}));
 h.dialog.showModal();h.section.open=true;await h.tick();h.dialog.close();
 resolve([{id,name:'late.vulgar'}]);await h.tick();assert.equal(h.section.querySelector('[data-recovery-id]'),null);assert.deepEqual(h.opened,[]);
 fail=true;h.dialog.showModal();h.section.open=true;await h.tick();
 assert.equal(h.window.document.getElementById('documentRecoveryStatus').textContent,'Local recovery storage could not be read. Existing data has been kept.');
 assert.equal(h.dialog.open,true);
});

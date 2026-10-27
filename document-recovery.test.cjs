const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const vm=require('node:vm');
const crypto=require('node:crypto').webcrypto;
const compiled=build({entryPoints:['src/document-recovery.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'recovery-adapters',setup(build){
 build.onResolve({filter:/^(\.\/platform|\.\/i18n)$/},args=>({path:args.path,namespace:'recovery-test'}));
 build.onLoad({filter:/.*/,namespace:'recovery-test'},args=>({contents:args.path.endsWith('platform')?'export const draftStorage=()=>localStorage;export const documentSessionId=()=>activeId;':'export const t=value=>value;'}));
}}]}).then(result=>result.outputFiles[0].text);
function storage(){const entries=new Map();return {get length(){return entries.size},key:i=>[...entries.keys()][i]??null,getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,String(value)),removeItem:key=>entries.delete(key)};}
async function load(localStorage=storage(),sessionStorage=storage(),activeId=null){
 const module={exports:{}};vm.runInNewContext(await compiled,{module,exports:module.exports,console,crypto,TextEncoder,localStorage,sessionStorage,activeId});return {api:module.exports,localStorage,sessionStorage};
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
});

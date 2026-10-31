const test=require('node:test'),assert=require('node:assert/strict');
const {build}=require('esbuild');
let api;
test.before(async()=>{
const source=(await build({stdin:{contents:`export * from './src/collaboration-navigation';export {createHostedInvite,collaborationInviteUrl,parseCollaborationInvite} from './src/collaboration-invite';`,resolveDir:__dirname,loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'navigation-fixture',setup(build){
  build.onLoad({filter:/src[\\/]platform\.ts$/},()=>({contents:`export const documentSessionId=()=>new URL(location.href).searchParams.get('document');`,loader:'ts'}));
  build.onResolve({filter:/^@tauri-apps\/api\/(core|webviewWindow)$/},args=>({path:args.path,namespace:'fixture'}));
  build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.endsWith('/core')?`export const isTauri=()=>globalThis.fixtureTauri;`:`export class WebviewWindow {constructor(label,options){globalThis.fixtureNative={label,options};}once(name,listener){if(name==='tauri://created')queueMicrotask(()=>listener({}));return Promise.resolve(()=>{});}}`,loader:'ts'}));
}}]})).outputFiles[0].text;
const compiled={exports:{}};new Function('require','module','exports',source)(require,compiled,compiled.exports);
api=compiled.exports;
});
function setup(t,url){
  const keys=['location','history','sessionStorage','window','fixtureTauri','fixtureNative'],before=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const data=new Map(),replacements=[],opened=[];
  const location={href:url,replace(value){replacements.push(value);this.href=value;}};
  for(const [key,value] of Object.entries({location,history:{replaceState(a,b,value){location.href=value;}},sessionStorage:{setItem:(key,value)=>data.set(key,String(value)),getItem:key=>data.get(key)??null,removeItem:key=>data.delete(key)},window:{open:(...args)=>{const tab={opener:{}};opened.push({args,tab});return tab;}},fixtureTauri:false}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  t.after(()=>{for(const [key,descriptor] of before){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  return {data,replacements,opened,location};
}
test('an invitation always owns a fresh local draft rather than overwriting an existing document query',async t=>{
  const {invite}=await api.createHostedInvite(),link=new URL(api.collaborationInviteUrl(invite,'https://example.test/notes/'));link.searchParams.set('document','existing-unsaved-draft');
  const state=setup(t,link.href),result=api.prepareCollaborationInvitation();
  assert.equal(result.redirected,true);assert.equal(state.replacements.length,1);
  const localId=new URL(state.location.href).searchParams.get('document');assert.notEqual(localId,'existing-unsaved-draft');assert.match(localId,/^[a-f0-9-]{36}$/);
  assert.equal(state.data.has('vulgar.collaboration-document:existing-unsaved-draft'),false);
  assert.equal(state.data.get('vulgar.collaboration-document:'+localId),invite.room);
  assert.equal(JSON.stringify([...state.data]).includes(invite.password),false);
  assert.equal(api.prepareCollaborationInvitation().redirected,false,'refreshing the same invitation reuses this draft');
  assert.equal(state.replacements.length,1);
});
test('invalid links cannot navigate, and leaving removes the invitation without changing document identity',async t=>{
  const state=setup(t,'https://example.test/notes/?document=existing#collab=bad');
  assert.throws(()=>api.prepareCollaborationInvitation(),{message:'This collaboration link is invalid.'});assert.equal(state.replacements.length,0);assert.equal(state.data.size,0);
  const {invite}=await api.createHostedInvite();api.rememberCollaborationInvite(invite);api.forgetCollaborationInvite();
  assert.equal(new URL(state.location.href).searchParams.get('document'),'existing');assert.equal(new URL(state.location.href).hash,'');assert.equal(state.data.size,0);
});
test('joining from the web opens an independent tab and leaves the existing document intact',async t=>{
  const state=setup(t,'https://example.test/notes/?document=current#label'),{invite}=await api.createHostedInvite();
  await api.openCollaborationInvitation(invite);assert.equal(state.opened.length,1);assert.equal(state.opened[0].args[1],'_blank');assert.equal(state.opened[0].tab.opener,null);
  assert.equal(new URL(state.opened[0].args[0]).search,'');assert.equal(new URL(state.location.href).searchParams.get('document'),'current');
  window.open=()=>null;await assert.rejects(api.openCollaborationInvitation(invite),{message:'The new tab could not be opened. Please allow pop-ups for this site.'});
});
test('desktop invitations open a permitted independent local WebView with no old document query',async t=>{
  const state=setup(t,'http://tauri.localhost/?document=current'),{invite}=await api.createHostedInvite();globalThis.fixtureTauri=true;
  await api.openCollaborationInvitation(invite);assert.match(fixtureNative.label,/^document-collaboration-/);const opened=new URL(fixtureNative.options.url);
  assert.equal(opened.origin,'http://tauri.localhost');assert.equal(opened.pathname,'/index.html');assert.equal(opened.search,'');assert.deepEqual(api.parseCollaborationInvite(opened.href),invite);
  assert.equal(state.location.href,'http://tauri.localhost/?document=current');
});

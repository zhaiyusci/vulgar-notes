const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {build}=require('esbuild');

const markup=fs.readFileSync('mathjax4_editor_prototype_document_typeset.html','utf8').match(/<dialog id="preferencesDialog"[\s\S]*?<\/dialog>/)[0];
const compiled=build({stdin:{contents:"export * from './src/proofreading-settings';export {initPreferences} from './src/preferences';export {initLocale,t} from './src/i18n';",resolveDir:__dirname,loader:'ts'},
  bundle:true,write:false,format:'iife',globalName:'proofreadingSettingsTest',plugins:[{name:'preferences-platform',setup(b){
    b.onResolve({filter:/^@tauri-apps\/api\/core$/},()=>({path:'platform',namespace:'proofreading-settings-test'}));
    b.onResolve({filter:/^\.\/document-draft-store$/},()=>({path:'recovery',namespace:'proofreading-settings-test'}));
    b.onLoad({filter:/.*/,namespace:'proofreading-settings-test'},({path})=>({contents:path==='platform'?'export const isTauri=()=>false;':
      'export const flushDocumentDraftStore=async()=>{window.preferencesTest.flushes++;if(window.preferencesTest.pending)await window.preferencesTest.pending;if(window.preferencesTest.flushError)throw Error("Recovery failed");};',loader:'js'}));
  }}]}).then(result=>result.outputFiles[0].text);

const languageToolDefaults={languageToolEndpoint:'http://127.0.0.1:8081/v2',languageToolLanguage:'en-US'};
const legacyAI={enabled:true,endpoint:'http://localhost:11434/v1',apiKey:'',model:'local-model',rememberKey:false};
const base={...legacyAI,provider:'ai',...languageToolDefaults};
const localKey='editor.proofreading',sessionKey='editor.proofreading.apiKey';
async function harness(t,{locale='en',local={},session={}}={}){
  const {Window}=await import('happy-dom');const window=new Window({url:'http://localhost/'});
  window.document.write('<!doctype html><button id="openPreferences">Preferences</button><main id="draft">UNCHANGED DOCUMENT α</main>'+markup);
  window.localStorage.setItem('editor.locale',locale);
  for(const [key,value] of Object.entries(local))window.localStorage.setItem(key,value);
  for(const [key,value] of Object.entries(session))window.sessionStorage.setItem(key,value);
  window.preferencesTest={flushes:0,reloads:0};window.location.reload=()=>window.preferencesTest.reloads++;
  window.eval(await compiled+'\nwindow.proofreadingSettingsTest=proofreadingSettingsTest;');
  const api=window.proofreadingSettingsTest,document=window.document;
  api.initLocale();api.initPreferences();
  t.after(()=>window.happyDOM.abort());
  const get=id=>document.getElementById(id),form=get('preferencesForm');
  return {api,window,document,get,form,state:window.preferencesTest,
    open:()=>get('openPreferences').click(),
    submit:action=>form.dispatchEvent(new window.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:form.querySelector(`button[value="${action}"]`)})),
    tick:()=>new Promise(resolve=>setTimeout(resolve,0)),
    fill:next=>{get('proofreadingEnabled').checked=next.enabled;get('proofreadingProvider').value=next.provider??'ai';get('proofreadingProvider').dispatchEvent(new window.Event('change'));
      get('languageToolEndpoint').value=next.languageToolEndpoint??languageToolDefaults.languageToolEndpoint;get('languageToolLanguage').value=next.languageToolLanguage??languageToolDefaults.languageToolLanguage;
      get('proofreadingEndpoint').value=next.endpoint;get('proofreadingModel').value=next.model;
      get('proofreadingApiKey').value=next.apiKey;get('proofreadingRememberKey').checked=next.rememberKey;get('proofreadingRememberKey').dispatchEvent(new window.Event('change'));},
  };
}
const plain=value=>JSON.parse(JSON.stringify(value));
const records=storage=>Object.fromEntries(Array.from({length:storage.length},(_,i)=>{const key=storage.key(i);return [key,storage.getItem(key)];}));

test('proofreading is off by default and settings reads return one immutable snapshot',async t=>{
  const h=await harness(t),first=h.api.readProofreadingSettings();
  assert.deepEqual(plain(first),{enabled:false,provider:'languagetool',...languageToolDefaults,endpoint:'',apiKey:'',model:'',rememberKey:false});
  assert.equal(h.api.readProofreadingSettings(),first);assert.equal(Object.isFrozen(first),true);
  assert.equal(h.window.localStorage.getItem(localKey),null);assert.equal(h.window.sessionStorage.getItem(sessionKey),null);
  assert.equal(h.api.saveProofreadingSettings(base),true);
  const second=h.api.readProofreadingSettings();assert.notEqual(second,first);assert.equal(h.api.readProofreadingSettings(),second);
  assert.equal(h.api.saveProofreadingSettings({...base}),true);assert.equal(h.api.readProofreadingSettings(),second);
});

test('existing AI-only preferences migrate without changing their service, credentials or stored record',async t=>{
  for(const rememberKey of [false,true]){
    const stored={...legacyAI,rememberKey,...(rememberKey?{apiKey:'old-secret'}:{})};
    const record=JSON.stringify(stored),h=await harness(t,{local:{[localKey]:record},session:rememberKey?{}:{[sessionKey]:'old-secret'}});
    assert.deepEqual(plain(h.api.readProofreadingSettings()),{...base,apiKey:'old-secret',rememberKey});
    assert.equal(h.window.localStorage.getItem(localKey),record,'loading an old record does not rewrite credentials');
    h.open();assert.equal(h.get('proofreadingProvider').value,'ai');assert.equal(h.get('proofreadingAI').hidden,false);assert.equal(h.get('proofreadingLanguageTool').hidden,true);
  }
  const h=await harness(t);assert.equal(h.api.saveProofreadingSettings(legacyAI),true);
  assert.deepEqual(plain(h.api.readProofreadingSettings()),base,'legacy callers without provider fields retain AI behavior');
});

test('LanguageTool validates only its selected service and text language while retaining inactive AI settings',async t=>{
  const h=await harness(t),next={...base,provider:'languagetool',endpoint:'not-an-active-api-url',model:'',apiKey:'retained-key'};
  assert.equal(h.api.saveProofreadingSettings(next),true);
  assert.deepEqual(plain(h.api.readProofreadingSettings()),next);
  for(const languageToolEndpoint of ['', 'file:///private','https://user:pass@example.com/v2','https://example.com/v2#fragment','http://example.com/v2']){
    assert.ok(h.api.validateProofreadingSettings({...next,languageToolEndpoint}),languageToolEndpoint);
  }
  for(const languageToolLanguage of ['','en_US','en-US\ninvalid','javascript:en','english','en-']){
    assert.ok(h.api.validateProofreadingSettings({...next,languageToolLanguage}),languageToolLanguage);
  }
  for(const languageToolLanguage of ['auto','en-US','en-GB','zh-CN','de-DE','pt-BR','fr','zh-Hant-TW']){
    assert.equal(h.api.validateProofreadingSettings({...next,languageToolLanguage}),undefined,languageToolLanguage);
  }
  assert.equal(h.api.validateProofreadingSettings({...next,enabled:false,languageToolEndpoint:'',languageToolLanguage:''}),undefined);
  assert.ok(h.api.validateProofreadingSettings({...next,provider:'ai'}),'switching to AI validates the retained AI configuration');
  assert.equal(h.api.validateProofreadingSettings({...base,languageToolEndpoint:'inactive-invalid',languageToolLanguage:'inactive-invalid'}),undefined);
});

test('default keys survive same-tab reload but are absent from persistent settings and a fresh tab',async t=>{
  const h=await harness(t);assert.equal(h.api.saveProofreadingSettings({...base,apiKey:'session-secret'}),true);
  const local=records(h.window.localStorage),session=records(h.window.sessionStorage);
  assert.doesNotMatch(JSON.stringify(local),/session-secret|apiKey/);
  assert.equal(session[sessionKey],'session-secret');
  const reloaded=await harness(t,{local,session});assert.equal(reloaded.api.readProofreadingSettings().apiKey,'session-secret');
  const anotherTab=await harness(t,{local});assert.equal(anotherTab.api.readProofreadingSettings().apiKey,'');
  assert.equal(anotherTab.api.readProofreadingSettings().enabled,true,'local services need not use an API key');
});

test('remembering and forgetting a key clears its previous storage location',async t=>{
  const h=await harness(t);
  h.api.saveProofreadingSettings({...base,apiKey:'session-secret'});
  assert.equal(h.api.saveProofreadingSettings({...base,apiKey:'remembered-secret',rememberKey:true}),true);
  assert.equal(h.window.sessionStorage.getItem(sessionKey),null);
  assert.equal(JSON.parse(h.window.localStorage.getItem(localKey)).apiKey,'remembered-secret');
  const reopened=await harness(t,{local:records(h.window.localStorage)});assert.equal(reopened.api.readProofreadingSettings().apiKey,'remembered-secret');
  assert.equal(h.api.saveProofreadingSettings({...base,apiKey:'new-session-secret'}),true);
  assert.equal(Object.hasOwn(JSON.parse(h.window.localStorage.getItem(localKey)),'apiKey'),false);
  assert.equal(h.window.sessionStorage.getItem(sessionKey),'new-session-secret');
  assert.equal(h.api.saveProofreadingSettings({...base,apiKey:''}),true);assert.equal(h.window.sessionStorage.getItem(sessionKey),null);
});

test('invalid configurations make no changes; HTTP local services and full completion endpoints are accepted',async t=>{
  const h=await harness(t);const before=h.api.readProofreadingSettings();
  for(const endpoint of ['', 'file:///private','ftp://localhost','javascript:alert(1)','https://name:password@example.com/v1','https://example.com/v1#fragment','https://example.com/v1#','http://example.com/v1','http://192.168.1.2/v1','http://[::1]:8000/v1']){
    assert.ok(h.api.validateProofreadingSettings({...base,endpoint}),endpoint);
    assert.equal(h.api.saveProofreadingSettings({...base,endpoint}),false);assert.equal(h.api.readProofreadingSettings(),before);
  }
  assert.ok(h.api.validateProofreadingSettings({...base,model:'   '}));
  assert.ok(h.api.validateProofreadingSettings({...base,apiKey:'secret\nvalue'}));
  for(const endpoint of ['http://127.0.0.1:11434','https://api.example.com/v1/chat/completions','https://api.example.com/custom/base']){
    assert.equal(h.api.validateProofreadingSettings({...base,endpoint}),undefined,endpoint);
  }
  assert.equal(h.api.validateProofreadingSettings({...base,enabled:false,endpoint:'',model:''}),undefined);
  assert.equal(h.window.localStorage.getItem(localKey),null);
});

test('failed writes roll back credentials and do not publish a successful configuration',async t=>{
  for(const failWhere of ['local','session']){
    const h=await harness(t);h.api.saveProofreadingSettings({...base,apiKey:'old-key'});
    const initial=h.api.readProofreadingSettings(),localBefore=records(h.window.localStorage),sessionBefore=records(h.window.sessionStorage);
    let notices=0;const unsubscribe=h.api.subscribeProofreadingSettings(()=>notices++);
    const storage=failWhere==='local'?h.window.localStorage:h.window.sessionStorage;
    const nativeSet=storage.setItem.bind(storage),nativeRemove=storage.removeItem.bind(storage);let fail=true;
    Object.defineProperty(h.window,failWhere+'Storage',{configurable:true,value:{
      get length(){return storage.length;},key:storage.key.bind(storage),getItem:storage.getItem.bind(storage),
      setItem:(key,value)=>{if(fail&&(key===localKey||key===sessionKey)){fail=false;throw Error('Write denied');}nativeSet(key,value);},
      removeItem:key=>{if(fail&&key===sessionKey){fail=false;throw Error('Write denied');}nativeRemove(key);},
    }});
    assert.equal(h.api.saveProofreadingSettings({...base,apiKey:'new-key',rememberKey:true}),false);
    assert.equal(h.api.readProofreadingSettings(),initial);assert.equal(notices,0);
    assert.deepEqual(records(h.window.localStorage),localBefore);assert.deepEqual(records(h.window.sessionStorage),sessionBefore);
    unsubscribe();
  }
});

test('subscribers share one storage listener and remote preference changes refresh the stable snapshot',async t=>{
  const h=await harness(t);let attaches=0,detaches=0,one=0,two=0;
  const add=h.window.addEventListener.bind(h.window),remove=h.window.removeEventListener.bind(h.window);
  h.window.addEventListener=(type,...args)=>{if(type==='storage')attaches++;return add(type,...args);};
  h.window.removeEventListener=(type,...args)=>{if(type==='storage')detaches++;return remove(type,...args);};
  const offOne=h.api.subscribeProofreadingSettings(()=>one++),offTwo=h.api.subscribeProofreadingSettings(()=>two++);
  assert.equal(attaches,1);
  const next={...base,rememberKey:true,apiKey:'remote-key'};h.window.localStorage.setItem(localKey,JSON.stringify(next));
  h.window.dispatchEvent(new h.window.StorageEvent('storage',{key:localKey,storageArea:h.window.localStorage}));
  assert.deepEqual(plain(h.api.readProofreadingSettings()),next);assert.equal(one,1);assert.equal(two,1);
  const current=h.api.readProofreadingSettings();h.window.dispatchEvent(new h.window.StorageEvent('storage',{key:localKey}));
  assert.equal(h.api.readProofreadingSettings(),current);assert.equal(one,1);
  h.window.dispatchEvent(new h.window.StorageEvent('storage',{key:'unrelated-document'}));assert.equal(one,1);
  offOne();assert.equal(detaches,0);offTwo();assert.equal(detaches,1);
});

for(const locale of ['en','zh-CN'])test(`preferences edit a local draft, validate on Save and preserve Cancel (${locale})`,async t=>{
  const h=await harness(t,{locale,local:{'editor.colorScheme':'paper','private-document':'UNCHANGED'}});
  const localBefore=records(h.window.localStorage),draft=h.get('draft').outerHTML;
  h.open();h.fill({...base,apiKey:'do-not-save',rememberKey:true});
  assert.equal(h.get('proofreadingApiKey').type,'password');assert.equal(h.get('proofreadingKeyHint').hidden,false);
  assert.equal(h.get('proofreadingKeyHint').textContent,h.api.t('Remembered API keys are stored as plain text on this device.'));
  h.get('uiColorScheme').value='dark';h.get('uiColorScheme').dispatchEvent(new h.window.Event('change'));
  h.submit('cancel');assert.equal(h.get('preferencesDialog').open,false);
  assert.deepEqual(records(h.window.localStorage),localBefore);assert.equal(h.window.sessionStorage.length,0);
  assert.equal(h.document.documentElement.dataset.colorScheme,'paper');assert.equal(h.get('draft').outerHTML,draft);
  h.open();assert.equal(h.get('proofreadingEnabled').checked,false);assert.equal(h.get('proofreadingApiKey').value,'');
  h.fill({...base,endpoint:'',apiKey:''});h.submit('save');
  assert.equal(h.get('preferencesDialog').open,true);assert.equal(h.get('preferencesError').hidden,false);
  assert.equal(h.get('preferencesError').textContent,h.api.t('Enter a valid HTTP or HTTPS API address.'));
  assert.equal(h.api.readProofreadingSettings().enabled,false);
  h.fill(base);h.submit('save');assert.equal(h.get('preferencesDialog').open,false);
  assert.deepEqual(plain(h.api.readProofreadingSettings()),base);assert.equal(h.get('draft').outerHTML,draft);
  for(const node of h.get('proofreadingPreferences').querySelectorAll('[data-i18n]')){
    assert.equal(node.textContent,h.api.t(node.dataset.i18n));
    if(locale==='zh-CN')assert.notEqual(node.textContent,node.dataset.i18n,'Chinese translation exists for '+node.dataset.i18n);
  }
});

for(const locale of ['en','zh-CN'])test(`service switching preserves both drafts and keeps text language separate from UI language (${locale})`,async t=>{
  const h=await harness(t,{locale});let requests=0;h.window.fetch=async()=>{requests++;throw Error('Preferences must not contact proofreading services');};
  h.open();assert.equal(h.get('proofreadingProvider').value,'languagetool');assert.equal(h.get('proofreadingLanguageTool').hidden,false);assert.equal(h.get('proofreadingAI').hidden,true);
  assert.equal(h.get('languageToolLanguage').value,'en-US');assert.equal(h.get('uiLocale').value,locale);
  h.fill({...base,apiKey:'kept-secret',languageToolEndpoint:'http://localhost:8081/v2',languageToolLanguage:'en-GB'});
  assert.equal(h.get('proofreadingAI').hidden,false);assert.equal(h.get('proofreadingLanguageTool').hidden,true);
  h.get('proofreadingProvider').value='languagetool';h.get('proofreadingProvider').dispatchEvent(new h.window.Event('change'));
  assert.equal(h.get('proofreadingAI').hidden,true);assert.equal(h.get('proofreadingLanguageTool').hidden,false);
  assert.equal(h.get('languageToolLanguage').value,'en-GB');assert.equal(h.get('proofreadingApiKey').value,'kept-secret');assert.equal(h.get('proofreadingModel').value,base.model);
  h.submit('save');assert.equal(h.get('preferencesDialog').open,false);
  const saved=plain(h.api.readProofreadingSettings());assert.equal(saved.provider,'languagetool');assert.equal(saved.apiKey,'kept-secret');assert.equal(saved.languageToolLanguage,'en-GB');assert.equal(saved.endpoint,base.endpoint);
  assert.doesNotMatch(h.window.localStorage.getItem(localKey),/kept-secret/);assert.equal(h.window.sessionStorage.getItem(sessionKey),'kept-secret');
  h.open();h.get('proofreadingProvider').value='ai';h.get('proofreadingProvider').dispatchEvent(new h.window.Event('change'));assert.equal(h.get('proofreadingApiKey').value,'kept-secret');
  h.get('languageToolLanguage').value='zh-CN';h.submit('cancel');assert.deepEqual(plain(h.api.readProofreadingSettings()),saved,'cancel discards provider and language changes together');
  assert.equal(h.window.localStorage.getItem('editor.locale'),locale);assert.equal(requests,0);
});

test('preference storage failures roll back appearance and language without publishing AI settings',async t=>{
  const h=await harness(t,{local:{'editor.colorScheme':'paper'}});h.open();h.fill({...base,apiKey:'unsaved-secret',rememberKey:true});
  h.get('uiColorScheme').value='dark';h.get('uiLocale').value='zh-CN';
  const storage=h.window.localStorage,nativeSet=storage.setItem.bind(storage);let failed=false;
  Object.defineProperty(h.window,'localStorage',{configurable:true,value:{getItem:storage.getItem.bind(storage),removeItem:storage.removeItem.bind(storage),
    setItem:(key,value)=>{if(key===localKey&&!failed){failed=true;throw Error('Disk full');}nativeSet(key,value);}}});
  h.submit('save');await h.tick();
  assert.equal(h.get('preferencesDialog').open,true);assert.equal(h.get('preferencesError').hidden,false);
  assert.equal(storage.getItem('editor.locale'),'en');assert.equal(storage.getItem('editor.colorScheme'),'paper');
  assert.equal(storage.getItem(localKey),null);assert.equal(h.api.readProofreadingSettings().enabled,false);
  assert.equal(h.state.reloads,0);assert.equal(h.state.flushes,1);
  h.submit('cancel');assert.equal(h.document.documentElement.dataset.colorScheme,'paper');
});

test('cancelling while language recovery is pending cannot enable proofreading',async t=>{
  const h=await harness(t);let release;h.state.pending=new Promise(resolve=>{release=resolve;});
  h.open();h.fill(base);h.get('uiLocale').value='zh-CN';h.submit('save');
  assert.equal(h.get('proofreadingPreferences').disabled,true);h.submit('cancel');
  release();await h.tick();
  assert.equal(h.get('preferencesDialog').open,false);assert.equal(h.state.reloads,0);
  assert.equal(h.api.readProofreadingSettings().enabled,false);assert.equal(h.window.localStorage.getItem(localKey),null);
});

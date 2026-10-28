const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {build}=require('esbuild');

const html=fs.readFileSync('mathjax4_editor_prototype_document_typeset.html','utf8');
const dialogMarkup=html.match(/<dialog id="preferencesDialog"[\s\S]*?<\/dialog>/)[0];
const compiled=build({
  stdin:{contents:"export {initPreferences} from './src/preferences';export {initLocale} from './src/i18n';",resolveDir:process.cwd()},
  bundle:true,write:false,format:'iife',globalName:'preferencesAboutTest',
  plugins:[{name:'about-platform',setup(builder){
    builder.onResolve({filter:/^@tauri-apps\/api\/core$/},()=>({path:'tauri',namespace:'about-test'}));
    builder.onLoad({filter:/.*/,namespace:'about-test'},()=>({contents:'export const isTauri=()=>false;',loader:'js'}));
  }}],
}).then(result=>result.outputFiles[0].text);

for(const locale of ['en','zh-CN'])test(`third-party notices are opt-in inside About and leave the document intact (${locale})`,async t=>{
  const {Window}=await import('happy-dom');
  const window=new Window({url:'http://localhost/'});
  t.after(()=>window.happyDOM.abort());
  window.document.write('<!doctype html><button id="openPreferences" type="button">Preferences</button><main id="documentContent" contenteditable="true"><p>Unchanged α + x² [1]</p></main>'+dialogMarkup);
  const document=window.document;
  window.localStorage.setItem('editor.locale',locale);
  window.localStorage.setItem('editor.colorScheme','catppuccin-mocha');
  window.localStorage.setItem('private-document-draft','UNCHANGED_DOCUMENT');
  const storageBefore=Array.from({length:window.localStorage.length},(_,index)=>{const key=window.localStorage.key(index);return [key,window.localStorage.getItem(key)];});
  const content=document.getElementById('documentContent'),before=content.outerHTML;
  let requests=0,externalWindows=0;
  window.fetch=async()=>{requests++;throw Error('Notices must not load automatically');};
  window.open=()=>{externalWindows++;return null;};
  window.eval(await compiled+'\nwindow.preferencesAboutTest=preferencesAboutTest;');
  window.preferencesAboutTest.initLocale();
  window.preferencesAboutTest.initPreferences();
  const dialog=document.getElementById('preferencesDialog');
  const about=document.getElementById('applicationAbout'),licenses=document.getElementById('thirdPartyLicenses');
  assert.equal(dialog.open,false);
  assert.equal(about.open,false);
  assert.equal(licenses.open,false);
  assert.equal(licenses.closest('#applicationAbout'),about);
  assert.equal(about.querySelector('summary').textContent,locale==='en'?'About Vulgar Notes':'关于 Vulgar Notes');
  assert.equal(licenses.querySelector('summary').textContent,locale==='en'?'Third-party licenses':'第三方许可');
  assert.equal(document.documentElement.dataset.colorScheme,'catppuccin-mocha');
  document.getElementById('openPreferences').click();
  assert.equal(dialog.open,true);
  assert.equal(about.open,false);
  assert.equal(licenses.open,false);
  about.open=true;licenses.open=true;
  const projectLicense=document.getElementById('applicationLicense');
  assert.equal(projectLicense.closest('#applicationAbout'),about);
  assert.equal(projectLicense.closest('#thirdPartyLicenses'),null,'project license is separate from dependencies');
  assert.match(projectLicense.textContent,/Vulgar Notes[\s\S]*2026 Yu Zhai/);
  assert.equal(projectLicense.querySelector('a[href="LICENSE"]').textContent,locale==='en'?'GNU GPL v3 or later':'GNU GPL 第3版或更新版本');
  assert.doesNotMatch(projectLicense.textContent,/AGPL/,'the application is not silently relicensed as AGPL');
  assert.match(licenses.textContent,/citeproc-js.*2009–2019 Frank Bennett/);
  assert.equal(licenses.querySelector('a[href="licenses/citeproc/AGPLv3.txt"]').textContent,locale==='en'?'GNU AGPL v3 or later':'GNU AGPL 第3版或更新版本');
  assert.ok(licenses.querySelector('a[href="licenses/citeproc/NOTICE.txt"]'));
  assert.ok(licenses.querySelector('a[href="licenses/csl/NOTICE.md"]'));
  assert.equal(about.querySelector('a[href="https://github.com/zhaiyusci/vulgar-notes"]').textContent,locale==='en'?'Source code':'源代码');
  assert.doesNotMatch(about.textContent,/citeproc-lua|Zeping Lee|luautf8|LuaXML|LPPL|CPAL/,'removed components and the unselected license are not advertised');
  dialog.close();
  document.getElementById('openPreferences').click();
  assert.equal(about.open,false,'opening preferences again starts with About collapsed');
  assert.equal(licenses.open,false);
  assert.equal(document.getElementById('documentContent'),content);
  assert.equal(content.outerHTML,before);
  assert.deepEqual(Array.from({length:window.localStorage.length},(_,index)=>{const key=window.localStorage.key(index);return [key,window.localStorage.getItem(key)];}),storageBefore);
  assert.equal(requests,0);
  assert.equal(externalWindows,0);
  assert.doesNotMatch(html.replace(dialogMarkup,''),/appAttribution|citeproc-js|Frank Bennett|citeproc-lua|Zeping Lee/,'credits are confined to the unopened preferences dialog');
});

const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const path=require('node:path');

const compiled=build({
  entryPoints:[path.resolve('src/document-home.ts')],bundle:true,write:false,platform:'node',format:'cjs',target:'es2022',
  plugins:[{name:'home-localization',setup(builder){
    builder.onResolve({filter:/^\.\/i18n$/},()=>({path:'i18n',namespace:'home-test'}));
    builder.onLoad({filter:/.*/,namespace:'home-test'},()=>({contents:"export const locale='en';export const t=value=>value;"}));
  }}],
}).then(result=>{
  const module={exports:{}};
  new Function('module','exports',result.outputFiles[0].text)(module,module.exports);
  return module.exports;
});

test('start page lists individual files without inventing a default document',async t=>{
  const {Window}=await import('happy-dom');
  const window=new Window();
  Object.defineProperty(globalThis,'document',{value:window.document,configurable:true});
  t.after(async()=>{await window.happyDOM.abort();delete globalThis.document;});
  const {mountDocumentHome}=await compiled;
  const container=document.createElement('main');document.body.append(container);
  const calls=[];
  const home=mountDocumentHome(container,{
    onNew:()=>{calls.push('new');},onOpen:()=>{calls.push('open');},onRecent:id=>{calls.push(['recent',id]);},
    onRemoveRecent:id=>{calls.push(['remove',id]);},onRecover:id=>{calls.push(['recover',id]);},onPreferences:()=>{calls.push('preferences');},
  });
  assert.match(container.textContent,/No recent documents/);
  assert.equal(container.querySelectorAll('[data-recent-id],[data-recovery-id]').length,0);
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  home.refresh({recentDocuments:[
    {id:'one',name:'notes.vulgar',path:'C:\\notes\\notes.vulgar',lastOpened:1793050000000},
    {id:'two',name:'<img src=x onerror=alert(1)>.vulgar',lastOpened:'invalid'},
  ],recoveries:[{id:'recovery',name:'Unsaved equations',updatedAt:1793050000000}]});
  assert.equal(container.querySelectorAll('[data-recent-id]').length,2);
  assert.equal(container.querySelectorAll('img').length,0,'file names must be rendered as text');
  assert.equal(container.querySelector('[data-recent-id="one"] .document-home-file-path').textContent,'C:\\notes\\notes.vulgar');
  assert.ok(container.querySelector('[data-recent-id="one"] time').dateTime);
  assert.equal(container.querySelector('[data-recent-id="two"] time'),null);
  assert.equal(container.querySelector('button button'),null,'removing a recent entry must be independent of opening it');
  container.querySelector('[data-recent-id="one"]').click();await tick();
  container.querySelector('.document-home-remove').click();await tick();
  container.querySelector('[data-recovery-id="recovery"]').click();await tick();
  container.querySelector('.document-home-action-primary').click();await tick();
  container.querySelector('.document-home-action:not(.document-home-action-primary)').click();await tick();
  container.querySelector('[aria-label="Preferences"]').click();await tick();
  assert.deepEqual(calls,[['recent','one'],['remove','one'],['recover','recovery'],'new','open','preferences']);
  home.unmount();
  assert.equal(container.children.length,0);
});

test('start-page actions prevent duplicate opens and surface failures without losing the recent list',async t=>{
  const {Window}=await import('happy-dom');
  const window=new Window();
  Object.defineProperty(globalThis,'document',{value:window.document,configurable:true});
  t.after(async()=>{await window.happyDOM.abort();delete globalThis.document;});
  const {mountDocumentHome}=await compiled;
  const container=document.createElement('main');document.body.append(container);
  let calls=0,reject;
  const home=mountDocumentHome(container,{
    onNew:()=>{},onOpen:()=>{},onPreferences:()=>{},onRecent:()=>{calls++;return new Promise((_,failed)=>{reject=failed;});},
  },{recentDocuments:[{id:'one',name:'notes.vulgar'}]});
  const button=container.querySelector('[data-recent-id="one"]');
  button.click();button.click();
  assert.equal(calls,1);
  assert.equal(container.querySelector('[aria-busy]').getAttribute('aria-busy'),'true');
  assert.ok([...container.querySelectorAll('button')].every(item=>item.disabled));
  reject(Error('The selected file is no longer available.'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(container.querySelector('[role="alert"]').textContent,'The selected file is no longer available.');
  assert.equal(button.disabled,false);
  assert.equal(container.querySelectorAll('[data-recent-id]').length,1);
  home.refresh({loading:true});
  assert.ok([...container.querySelectorAll('button')].every(item=>item.disabled));
  home.refresh({recentDocuments:[]});
  assert.equal(container.querySelector('[role="alert"]').hidden,true);
  assert.match(container.textContent,/No recent documents/);
  home.unmount();
  home.refresh({recentDocuments:[{id:'late',name:'late.vulgar'}]});
  assert.equal(container.children.length,0,'late async updates must not remount an abandoned start page');
});

const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');

const compiled=build({entryPoints:['src/document-dialogs.ts'],bundle:true,write:false,format:'iife',globalName:'documentDialogs',plugins:[{name:'dialog-ui-adapters',setup(b){
 const stubs={
  './i18n':'export const t=value=>value;',
  './runtime-diagnostics':'export const recordRuntimeEvent=async event=>window.recordedEvents.push(event);',
 };
 b.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'document-dialog-test'}:undefined);
 b.onLoad({filter:/.*/,namespace:'document-dialog-test'},args=>({contents:stubs[args.path],loader:'js'}));
}}]}).then(r=>r.outputFiles[0].text);

async function harness(t){
 const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
 window.recordedEvents=[];window.document.body.innerHTML='<main>Original document</main>';
 window.eval(await compiled+'\nwindow.documentDialogs=documentDialogs;');
 t.after(()=>window.happyDOM.abort());
 return {window,document:window.document,api:window.documentDialogs};
}

test('save prompt returns explicit choices without changing document content',async t=>{
 const h=await harness(t),original=h.document.querySelector('main');
 for(const choice of ['save','discard','cancel']){
  const pending=h.api.askToSaveDocument('<img src=x>.vulgar'),dialog=h.document.querySelector('dialog');
  assert.equal(dialog.open,true);assert.equal(dialog.querySelector('strong').textContent,'<img src=x>.vulgar');assert.equal(dialog.querySelector('img'),null);
  assert.equal(h.document.activeElement.dataset.choice,'save');
  dialog.querySelector(`[data-choice="${choice}"]`).click();assert.equal(await pending,choice);
  assert.equal(h.document.querySelector('dialog'),null);assert.equal(h.document.querySelector('main'),original);assert.equal(original.textContent,'Original document');
 }
});

test('Escape and programmatic closing cancel the save decision',async t=>{
 const h=await harness(t);
 for(const close of [dialog=>dialog.dispatchEvent(new h.window.Event('cancel',{cancelable:true})),dialog=>dialog.close()]){
  const pending=h.api.askToSaveDocument('notes.vulgar');close(h.document.querySelector('dialog'));
  assert.equal(await pending,'cancel');assert.equal(h.document.querySelector('dialog'),null);
 }
});

test('error UI renders plain text, preserves the document and logs only stage IDs',async t=>{
 const h=await harness(t),before=h.document.querySelector('main').outerHTML;
 h.api.showDocumentError({message:'Unable to open document',error:'<img src=x> private path'});
 const dialog=h.document.querySelector('dialog');assert.equal(dialog.open,true);assert.equal(dialog.querySelector('p').textContent,'<img src=x> private path');assert.equal(dialog.querySelector('img'),null);
 dialog.querySelector('button').click();assert.equal(h.document.querySelector('dialog'),null);assert.equal(h.document.querySelector('main').outerHTML,before);
 assert.deepEqual(Array.from(h.window.recordedEvents),['document-error-dialog-start','document-error-dialog-visible','document-error-dialog-close']);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {build}=require('esbuild');

const compiled=build({entryPoints:['src/standalone-math-editor.ts'],bundle:true,write:false,format:'iife',globalName:'standaloneModule',plugins:[{name:'observe-standalone-mount',setup(build){
  // Exercise the shell's state, file transactions and DOM with the real model
  // and codec. Math rendering/input behaviour has its own component tests.
  build.onResolve({filter:/^\.\/math-editor$/},()=>({path:'math-editor',namespace:'standalone-test'}));
  build.onLoad({filter:/.*/,namespace:'standalone-test'},()=>({loader:'ts',contents:`
    export function createMathEditor(options){
      let model=options.initialModel,host;const elements=options.elements;
      const change=()=>{elements.input.value=model.projection();if(host){elements.layout.value=host.isDisplay(elements.formula)?'display':'inline';host.syncMath();}};
      const layout=()=>host.setDisplay(elements.formula,elements.layout.value==='display');
      elements.layout.addEventListener('change',layout);
      return {initialModel:model,connect(adapter){host=adapter;},notifyLoadFailure(){},render(){return Promise.resolve();},
        hooks:{activate(element,next,edge){model=next;model.pendingFont=undefined;model.setCursor(model.root.id,edge==='start'?0:model.root.items.length);change();},
          leave(){model.pendingFont=undefined;change();},change,pendingMathSnapshot(){},isComposing(){return false;},renderForExport(){return Promise.resolve();}},
        dispose(){elements.layout.removeEventListener('change',layout);}
      };
    }
  `}));
  build.onLoad({filter:/src[\\/]standalone-math-editor\.ts$/},args=>{
    const source=fs.readFileSync(args.path,'utf8');
    const contents=source.replace(/\nmountStandaloneMathEditor\(\);\s*$/, '\nwindow.standaloneTestApp=mountStandaloneMathEditor();');
    assert.notEqual(contents,source,'Expose the real auto-mounted application only in this test bundle');
    return {contents,loader:'ts',resolveDir:path.dirname(args.path)};
  });
}}]}).then(result=>result.outputFiles[0].text);
const reloadKey='vulgar-notes.formula-editor.language-reload';
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function waitFor(predicate){for(let i=0;i<30;i++){if(predicate())return;await tick();}assert.ok(predicate(),'Expected asynchronous UI state did not appear');}

async function harness(t,{reload,locale='en'}={}){
  const {Window}=await import('happy-dom');
  const window=new Window({url:'http://localhost/math-editor.html',settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true}});
  window.document.write(fs.readFileSync('math-editor.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
  window.localStorage.setItem('editor.locale',locale);
  if(reload)window.sessionStorage.setItem(reloadKey,reload);
  window.ready=false;window.MathJax={typesetClear(){},texReset(){},async typesetPromise(){}};
  let frame=0;window.requestAnimationFrame=()=>++frame;window.cancelAnimationFrame=()=>{};
  let reloads=0;window.location.reload=()=>{reloads++;};
  const previousFailure=()=>{};window.mathjaxLoadFailed=previousFailure;
  window.eval(await compiled);
  const app=window.standaloneTestApp;
  t.after(async()=>{try{app.dispose();}finally{await window.happyDOM.abort();}});
  const get=id=>window.document.getElementById(id);
  const edit=text=>{app.model.insert(text);app.math.hooks.change();};
  const file=(text,name='test.vulgar-math')=>new window.File([text],name,{type:'application/json'});
  const formulaFile=(source='x+y')=>{
    const saved=JSON.parse(app.model.snapshot());saved.root.items=Array.from(source);saved.cursor={region:saved.root.id,offset:1,anchor:0};
    return JSON.stringify({format:'vulgar-notes-formula',version:1,display:false,numbered:true,snapshot:saved});
  };
  const writer={written:[],closed:0,aborted:0};
  const handle={name:'saved.vulgar-math',async createWritable(){return {async write(text){writer.written.push(text);},async close(){writer.closed++;},async abort(){writer.aborted++;}};}};
  return {window,app,get,edit,file,formulaFile,writer,handle,previousFailure,get reloads(){return reloads;}};
}

test('standalone editor starts empty and tracks content/layout, not cursor movement or selection',async t=>{
  const h=await harness(t),{app}=h;
  assert.equal(app.model.exportLatex(),'');assert.equal(app.dirty,false);
  h.edit('a+b');assert.equal(app.dirty,true);
  h.window.showSaveFilePicker=async()=>h.handle;
  assert.equal(await app.save(),true);assert.equal(app.dirty,false);
  app.model.setCursor(app.model.root.id,2,0);app.math.hooks.change();
  assert.equal(app.dirty,false);assert.doesNotMatch(h.get('formulaFileName').textContent,/\*/);
  const cleanUnload=new h.window.Event('beforeunload',{cancelable:true});h.window.dispatchEvent(cleanUnload);assert.equal(cleanUnload.defaultPrevented,false);
  h.get('formulaLayout').value='inline';h.get('formulaLayout').dispatchEvent(new h.window.Event('change'));
  assert.equal(app.dirty,true,'The display setting is persistent content');
  const dirtyUnload=new h.window.Event('beforeunload',{cancelable:true});h.window.dispatchEvent(dirtyUnload);assert.equal(dirtyUnload.defaultPrevented,true);
});

test('opening invalid JSON shows the error without replacing live content or prompting to discard it',async t=>{
  const h=await harness(t);h.edit('keep');
  const model=h.app.model,before=model.snapshot();
  h.window.showOpenFilePicker=async()=>[{name:'config.json',getFile:async()=>h.file('{"theme":"dark"}','config.json')}];
  h.get('openFormula').click();
  await waitFor(()=>h.get('formulaStatus').textContent.includes('not a Vulgar Notes formula file'));
  assert.equal(h.app.model,model);assert.equal(model.snapshot(),before);assert.equal(h.app.dirty,true);
  assert.equal(h.window.document.querySelector('dialog[open]'),null);assert.equal(h.get('openFormula').disabled,false);
});

test('cancelled or failed saves retain dirty content and failed writers are aborted',async t=>{
  const h=await harness(t);h.edit('original');const before=h.app.model.snapshot();
  h.window.showSaveFilePicker=async()=>{throw new h.window.DOMException('Cancelled','AbortError');};
  assert.equal(await h.app.save(),false);assert.equal(h.app.dirty,true);
  assert.equal(h.app.model.snapshot(),before);assert.equal(h.get('formulaStatus').textContent,'');
  for(const step of ['write','close']){
    let aborted=0;
    h.window.showSaveFilePicker=async()=>({name:'failed.vulgar-math',async createWritable(){return {
      async write(){if(step==='write')throw Error('Disk write failed');},
      async close(){if(step==='close')throw Error('Disk close failed');},async abort(){aborted++;},
    };}});
    assert.equal(await h.app.save(),false);assert.equal(aborted,1);assert.equal(h.app.dirty,true);
    assert.equal(h.app.model.snapshot(),before);assert.match(h.get('formulaStatus').textContent,/Disk .* failed/);
    assert.doesNotMatch(h.get('formulaFileName').textContent,/failed/);
  }
  h.window.showSaveFilePicker=async()=>h.handle;
  assert.equal(await h.app.save(),true);assert.equal(h.app.dirty,false);assert.equal(h.writer.closed,1);
  assert.deepEqual(JSON.parse(h.writer.written[0]).snapshot,JSON.parse(before));
});

test('edits made while an asynchronous save is writing remain unsaved after it completes',async t=>{
  const h=await harness(t);h.edit('old');
  let finish;const pending=new Promise(resolve=>{finish=resolve;});
  h.window.showSaveFilePicker=async()=>({name:'slow.vulgar-math',async createWritable(){return {
    async write(text){h.writer.written.push(text);await pending;},async close(){},async abort(){},
  };}});
  const saving=h.app.save();await waitFor(()=>h.writer.written.length===1);
  h.edit('new');finish();assert.equal(await saving,true);
  assert.equal(h.app.model.exportLatex(),'oldnew');assert.equal(h.app.dirty,true);
  assert.deepEqual(JSON.parse(h.writer.written[0]).snapshot.root.items,['o','l','d']);
});

test('cancelling replacement or cancelling its save preserves the old model and selection',async t=>{
  const h=await harness(t);h.edit('keep');h.app.model.setCursor(h.app.model.root.id,3,1);h.app.math.hooks.change();
  const old=h.app.model,before=old.snapshot(),incoming=h.file(h.formulaFile('other'));
  const opening=h.app.openFile(incoming);await waitFor(()=>h.window.document.querySelector('dialog[open]:not(#latexImportDialog)'));
  h.window.document.querySelector('dialog[open] [data-choice="cancel"]').click();await opening;
  assert.equal(h.app.model,old);assert.equal(old.snapshot(),before);assert.equal(h.app.dirty,true);
  h.window.showSaveFilePicker=async()=>{throw new h.window.DOMException('Cancelled','AbortError');};
  const again=h.app.openFile(incoming);await waitFor(()=>h.window.document.querySelector('dialog[open]:not(#latexImportDialog)'));
  h.window.document.querySelector('dialog[open] [data-choice="save"]').click();await again;
  assert.equal(h.app.model,old);assert.equal(old.snapshot(),before);assert.equal(h.app.dirty,true);
});

test('opening a valid formula restores its saved cursor and settings without marking it dirty',async t=>{
  const h=await harness(t),source=h.formulaFile('abc'),expected=JSON.parse(source);
  expected.snapshot.pendingFont='font-symbf';
  await h.app.openFile(h.file(JSON.stringify(expected),'opened.vulgar-math'));
  assert.equal(h.app.model.exportLatex(),'abc');
  assert.deepEqual(plain(h.app.model.cursor),expected.snapshot.cursor);
  assert.equal(h.app.model.pendingFont,'font-symbf');
  assert.equal(h.app.dirty,false);assert.equal(h.get('formulaLayout').value,'inline');
  assert.equal(h.get('formulaFileName').textContent,'opened.vulgar-math');
});

test('language reload retains the formula, selection, filename and unsaved baseline once',async t=>{
  const first=await harness(t);first.edit('saved');first.window.showSaveFilePicker=async()=>first.handle;
  await first.app.save();first.edit('+中文');first.app.model.setCursor(first.app.model.root.id,3,1);first.app.math.hooks.change();
  const before=first.app.model.snapshot();first.get('uiLocale').value='zh-CN';first.get('uiLocale').dispatchEvent(new first.window.Event('change'));
  assert.equal(first.reloads,1);const handoff=first.window.sessionStorage.getItem(reloadKey);assert.ok(handoff);
  assert.equal(first.window.localStorage.getItem('editor.locale'),'zh-CN');
  const second=await harness(t,{reload:handoff,locale:'zh-CN'});
  assert.equal(second.app.model.snapshot(),before);assert.equal(second.app.dirty,true);
  assert.match(second.get('formulaFileName').textContent,/saved\.vulgar-math \*/);
  assert.equal(second.get('uiLocale').value,'zh-CN');assert.equal(second.window.sessionStorage.getItem(reloadKey),null);
  const fresh=await harness(t);assert.equal(fresh.app.model.exportLatex(),'');assert.equal(fresh.app.dirty,false);
});

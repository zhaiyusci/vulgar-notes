const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {build}=require('esbuild');

const compiled=build({stdin:{contents:"export {createStandaloneMathInspector} from './src/standalone-math-inspector';export {convertMath} from './src/tex-convert';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'inspectorAPI'}).then(result=>result.outputFiles[0].text);
const viewKey='vulgar-notes.formula-editor.views';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function waitFor(predicate){for(let i=0;i<30;i++){if(predicate())return;await tick();}assert.ok(predicate(),'Expected asynchronous inspector state did not appear');}

async function fixture(t,{source='a+\\frac{b}{c}',views}={}){
  const {Window}=await import('happy-dom');
  const window=new Window({url:'http://localhost/math-editor.html',settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true}});
  window.document.write(fs.readFileSync('math-editor.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
  window.localStorage.setItem('editor.locale','en');if(views)window.localStorage.setItem(viewKey,JSON.stringify(views));
  window.eval(await compiled+'\nwindow.inspectorAPI=inspectorAPI;');
  const api=window.inspectorAPI,model=api.convertMath(source),baseline=JSON.stringify(JSON.parse(model.snapshot()).root);
  const state={applied:[],opened:0,focused:0,changes:0,current:true,copies:[],downloads:[],blobs:[]};
  Object.defineProperty(window.navigator,'clipboard',{value:{async writeText(text){state.copies.push(text);}},configurable:true});
  window.URL.createObjectURL=blob=>{state.blobs.push(blob);return 'blob:test-'+state.blobs.length;};window.URL.revokeObjectURL=()=>{};
  window.HTMLAnchorElement.prototype.click=function(){state.downloads.push({name:this.download,href:this.href});};
  let math,inspector;
  inspector=api.createStandaloneMathInspector({model:()=>model,math:()=>math,name:()=>'my-formula.vulgar-math',focusMath:()=>{state.focused++;}});
  math={
    hooks:{change(){state.changes++;inspector.update(model);}},
    openSource(){
      state.opened++;state.current=true;
      inspector.sourceEditor.open({source:model.exportLatex(),isCurrent:()=>state.current,cancel:()=>{},apply(source){
        state.applied.push(source);if(!state.current)return false;
        model.record();model.restore(api.convertMath(source).snapshot());inspector.update(model);return true;
      }});
    },
  };
  t.after(async()=>{inspector.dispose();await window.happyDOM.abort();});
  const get=id=>window.document.getElementById(id),dialog=()=>get('latexImportDialog');
  const open=()=>{get('importLatex').click();return get('latexImportSource');};
  const draft=text=>{const input=get('latexImportSource');input.value=text;input.dispatchEvent(new window.InputEvent('input',{inputType:'insertFromPaste',data:text}));};
  const chooseFile=file=>{const input=dialog().querySelector('input[type=file]');Object.defineProperty(input,'files',{value:[file],configurable:true});input.dispatchEvent(new window.Event('change'));};
  const confirm=()=>dialog().querySelector('[data-choice="save"]').click();
  const cancel=()=>dialog().querySelector('[data-choice="cancel"]').click();
  return {window,model,inspector,state,get,dialog,open,draft,chooseFile,confirm,cancel,
    dirty:()=>JSON.stringify(JSON.parse(model.snapshot()).root)!==baseline};
}

test('LaTeX and AST are selectable read-only views; viewing them never opens an import editor',async t=>{
  const h=await fixture(t),before=h.model.snapshot();
  assert.equal(h.get('latexSource').localName,'pre');assert.equal(h.get('syntaxTree').querySelector('.math-tree-raw').localName,'pre');
  assert.equal(h.window.document.querySelector('[contenteditable]'),null);
  assert.equal(h.window.document.querySelector('#latexPane textarea,#syntaxTreePane textarea'),null);
  assert.equal(h.dialog().open,false);
  h.get('showLatex').click();assert.equal(h.get('latexPane').hidden,false);assert.equal(h.dialog().open,false);
  assert.equal(h.get('latexSource').textContent,h.model.exportLatex());
  h.get('syntaxTreeTab').click();assert.equal(h.get('syntaxTreePane').hidden,false);assert.equal(h.dialog().open,false);
  assert.equal(h.model.snapshot(),before);assert.equal(h.dirty(),false);assert.deepEqual(h.state.applied,[]);
});

test('import starts empty; typing, pasting and file selection do not apply until explicit confirmation',async t=>{
  const h=await fixture(t),before=h.model.snapshot(),input=h.open();
  assert.equal(h.dialog().open,true);assert.equal(input.value,'');
  assert.equal(h.dialog().querySelector('[data-choice="save"]').disabled,true);h.confirm();assert.deepEqual(h.state.applied,[]);
  input.value='\\sqrt{x}';input.dispatchEvent(new h.window.InputEvent('input',{inputType:'insertFromPaste',data:'\\sqrt{x}'}));
  assert.equal(h.model.snapshot(),before);assert.equal(h.dirty(),false);assert.deepEqual(h.state.applied,[]);
  h.chooseFile(new h.window.File(['\\frac{x}{y}'],'formula.tex',{type:'text/plain'}));
  await waitFor(()=>input.value==='\\frac{x}{y}');
  assert.equal(h.model.snapshot(),before);assert.equal(h.get('latexSource').textContent,h.model.exportLatex());assert.deepEqual(h.state.applied,[]);
  h.confirm();assert.equal(h.dialog().open,false);assert.deepEqual(h.state.applied,['\\frac{x}{y}']);
  assert.equal(h.model.exportLatex(),'\\frac{x}{y}');assert.equal(h.dirty(),true);assert.equal(h.model.undoStack.length,1);
  h.confirm();assert.equal(h.state.applied.length,1,'A repeated confirmation cannot apply the old session twice');
});

test('cancel and native Escape cancellation discard only the import draft',async t=>{
  const h=await fixture(t),before=h.model.snapshot();
  h.open().value='\\hat{draft}';h.cancel();
  assert.equal(h.dialog().open,false);assert.equal(h.model.snapshot(),before);assert.equal(h.dirty(),false);
  assert.equal(h.open().value,'','Every new import starts blank');h.get('latexImportSource').value='another draft';
  // Browsers dispatch cancel when Escape closes a dialog. HappyDOM has no
  // keyboard default actions, so run that native default if not prevented.
  const event=new h.window.Event('cancel',{cancelable:true});h.dialog().dispatchEvent(event);if(!event.defaultPrevented)h.dialog().close();
  assert.equal(h.dialog().open,false);assert.equal(h.get('latexImportSource').value,'');
  assert.equal(h.model.snapshot(),before);assert.equal(h.dirty(),false);assert.deepEqual(h.state.applied,[]);
});

test('confirmation preserves unsupported LaTeX as editable source and rejects stale sessions',async t=>{
  const h=await fixture(t),before=h.model.snapshot();h.open();h.draft('\\sqrt{x}');h.state.current=false;h.confirm();
  assert.equal(h.dialog().open,true);assert.equal(h.model.snapshot(),before);assert.deepEqual(h.state.applied,[]);
  assert.match(h.dialog().querySelector('.latex-import-error').textContent,/formula changed/i);h.cancel();
  const source='\\notARealMacro{中文}';h.open();h.draft(source);h.confirm();
  assert.deepEqual(h.state.applied,[source]);assert.equal(h.model.exportLatex(),source);
  const unknown=[...h.model.nodes.values()].find(node=>node.type==='source-tex');assert.ok(unknown);
  assert.equal(unknown.regions[0].items.join(''),source);assert.equal(h.get('latexSource').textContent,source);
});

test('copy and download always use the live formula rather than a pending import draft',async t=>{
  const h=await fixture(t),before=h.model.snapshot(),source=h.model.exportLatex();
  h.open().value='\\unknown{not applied}';
  h.get('copyLatex').click();h.get('downloadLatex').click();
  await waitFor(()=>h.state.copies.length===1);
  assert.deepEqual(h.state.copies,[source]);assert.equal(h.state.downloads[0].name,'my-formula.tex');
  assert.equal(await h.state.blobs[0].text(),source);assert.deepEqual(h.state.applied,[]);assert.equal(h.model.snapshot(),before);
  h.cancel();h.model.setCursor(h.model.root.id,h.model.root.items.length);h.model.insert('+z');h.inspector.update();
  const current=h.model.exportLatex();h.get('copyLatex').click();h.get('downloadLatex').click();
  await waitFor(()=>h.state.copies.length===2);assert.equal(h.state.copies[1],current);assert.equal(await h.state.blobs[1].text(),current);
});

test('view visibility persists without changing the formula, selection or dirty state',async t=>{
  const h=await fixture(t);h.model.setCursor(h.model.root.id,2,0);h.inspector.update();const before=h.model.snapshot();
  const workspace=h.window.document.querySelector('.formula-workspace');
  h.get('toggleMathPanel').click();assert.equal(h.get('mathPanel').hidden,true);assert.ok(workspace.classList.contains('math-panel-hidden'));
  assert.equal(h.get('toggleMathPanel').getAttribute('aria-pressed'),'false');
  h.get('closeInspector').click();assert.equal(h.get('formulaInspector').hidden,true);assert.ok(workspace.classList.contains('inspector-hidden'));
  assert.equal(h.model.snapshot(),before);assert.equal(h.dirty(),false);assert.deepEqual(h.state.applied,[]);
  const saved=JSON.parse(h.window.localStorage.getItem(viewKey));assert.deepEqual(saved,{mathPanel:false,tab:'none'});
  const reopened=await fixture(t,{views:saved});assert.equal(reopened.get('mathPanel').hidden,true);assert.equal(reopened.get('formulaInspector').hidden,true);
  reopened.get('showLatex').click();assert.equal(reopened.get('latexPane').hidden,false);
  assert.equal(JSON.parse(reopened.window.localStorage.getItem(viewKey)).tab,'latex');
  reopened.get('showSyntaxTree').click();assert.equal(reopened.get('syntaxTreePane').hidden,false);
  assert.equal(reopened.get('syntaxTreeTab').getAttribute('aria-selected'),'true');assert.equal(reopened.get('latexTab').tabIndex,-1);
  assert.equal(reopened.dirty(),false);
});

test('tree cursor synchronization does not replace its DOM or raw JSON',async t=>{
  const h=await fixture(t),tree=h.get('syntaxTree').querySelector('.math-tree-content');
  const nodes=[...tree.querySelectorAll('*')],raw=h.get('syntaxTree').querySelector('.math-tree-raw'),text=raw.firstChild;
  const fraction=[...h.model.nodes.values()].find(node=>node.type==='frac'),region=fraction.regions[0];
  h.model.setCursor(region.id,1,0);h.inspector.update();
  assert.deepEqual([...tree.querySelectorAll('*')],nodes);assert.equal(raw.firstChild,text);
  assert.equal(tree.querySelector('.math-tree-active-region').dataset.regionId,region.id);
  assert.match(h.get('syntaxTree').querySelector('.math-tree-cursor').textContent,/offset 1, anchor 0/);
  assert.equal(h.dirty(),false);assert.deepEqual(h.state.applied,[]);
});

test('late file reads cannot overwrite a cancelled or subsequently opened import',async t=>{
  const h=await fixture(t),before=h.model.snapshot();let finish;
  h.open();h.chooseFile({size:10,text:()=>new Promise(resolve=>{finish=resolve;})});
  h.cancel();h.open().value='new draft';finish('obsolete file contents');await tick();
  assert.equal(h.get('latexImportSource').value,'new draft');assert.equal(h.model.snapshot(),before);assert.deepEqual(h.state.applied,[]);
  h.cancel();
});

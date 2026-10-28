const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const Module=require('node:module');
const path=require('node:path');
const fs=require('node:fs');

test('the real formula source dialog converts an already active formula through actual DOM events',async t=>{
  const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
  window.document.write('<!doctype html><html><body><div id="preview"><div id="textFlow"><span id="formula"></span></div><textarea id="mathInput" hidden></textarea></div><div id="mathPanel"><div id="insertToolbar"></div><div class="document-actions"><select id="formulaLayout"></select></div></div><div id="error"></div><div id="pendingFontHint"></div><div id="structureCount"></div></body></html>');
  for(const key of ['innerWidth','innerHeight','window','document','navigator','sessionStorage','localStorage','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLButtonElement','HTMLDialogElement','Document','DocumentFragment','MutationObserver','ResizeObserver','DOMParser','Range','Event','CustomEvent','KeyboardEvent','ClipboardEvent','DOMRect','HTMLDivElement','HTMLSpanElement','NodeFilter','ShadowRoot'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
  globalThis.getComputedStyle=window.getComputedStyle.bind(window);globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);
  // MathJax is independent of this regression: inspect the actual model and
  // persisted native node, while all input/dialog/host event handlers are real.
  window.ready=false;
  const result=await build({stdin:{contents:`export {mountMathEditor} from './src/editor-ui';export {PlateMathHost} from './src/plate-host';export {EditorModel} from './src/editor-model';export {convertMath} from './src/tex-convert';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'source-dialog-test-kit',setup(builder){
    builder.onLoad({filter:/components[\\/]editor[\\/]editor-kit\.tsx$/},()=>({contents:`import {ParagraphPlugin} from 'platejs/react';import {TrailingBlockPlugin} from 'platejs';import {MathKit} from './plugins/math-kit';import {MarkdownKit} from './plugins/markdown-kit';import {ReferenceKit} from './plugins/reference-kit';import {FootnoteKit} from './plugins/footnote-kit';export const EditorKit=[ParagraphPlugin,...MathKit,...ReferenceKit,TrailingBlockPlugin,...MarkdownKit,...FootnoteKit];`,loader:'tsx',resolveDir:path.resolve('src/components/editor')}));
    if(process.env.FORMULA_SOURCE_REPRO_OLD_GATE==='1')builder.onLoad({filter:/src[\\/]plate-host\.tsx$/},args=>{
      const source=fs.readFileSync(args.path,'utf8'),oldGate=source.replace('const unchanged=source===node.texExpression;','const unchanged=source===node.texExpression; if(unchanged)return;');assert.notEqual(oldGate,source);return {contents:oldGate,loader:'tsx',resolveDir:path.dirname(args.path)};
    });
  }}]});
  const compiled=new Module(path.resolve('.formula-source-dialog-test.cjs'),module);compiled.paths=module.paths;
  const originalTimeout=globalThis.setTimeout;
  globalThis.setTimeout=(callback,delay,...args)=>{const timer=originalTimeout(callback,delay,...args);if(delay===10000)timer.unref();return timer;};
  try{compiled._compile(result.outputFiles[0].text,path.resolve('.formula-source-dialog-test.cjs'));}finally{globalThis.setTimeout=originalTimeout;}
  const api=compiled.exports,tick=()=>new Promise(resolve=>setTimeout(resolve,15));
  let host;
  api.mountMathEditor((mount,model,hooks)=>host=new api.PlateMathHost(mount,model,hooks));
  const input=document.getElementById('mathInput'),button=document.getElementById('formulaSourceButton'),dialog=document.getElementById('formulaSourceDialog'),source=document.getElementById('formulaSourceInput'),apply=dialog.querySelector('[data-choice="save"]');
  const pointer=(element,type='pointerdown')=>element.dispatchEvent(new window.PointerEvent(type,{button:0,pointerId:1,bubbles:true,cancelable:true}));
  const click=element=>{if(pointer(element))element.focus();element.dispatchEvent(new window.MouseEvent('click',{button:0,bubbles:true,cancelable:true}));};
  const nodeOf=()=>host.editor.children[0].children.find(node=>node.type==='inline_equation');
  const activate=async node=>{host.openDocument(JSON.stringify({version:1,value:[{type:'p',id:'body',children:[{text:''},node,{text:''}]}]}));await tick();const entry=host.entries()[0];host.enter(entry.element,'end');await tick();return entry;};
  const rawModel=tex=>{const model=new api.EditorModel();model.root.items=[];model.index();model.setCursor(model.root.id,0);model.insertSourceTex(tex);return model;};
  const legacy=(id,tex)=>({type:'inline_equation',id,snapshot:rawModel(tex).snapshot(),texExpression:tex,numbered:true,children:[{text:''}]});
  const submit=async replacement=>{
    click(button);await tick();assert.equal(dialog.open,true);assert.equal(document.activeElement,source);
    source.value=replacement;source.dispatchEvent(new window.InputEvent('input',{inputType:'insertText',data:replacement,bubbles:true}));
    click(apply);await tick();await tick();
  };
  const enterRawRegion=async(entry,region)=>{
    const target=document.createElement('span');target.className='math-region region-'+region.id;entry.element.replaceChildren(target);entry.element.setPointerCapture=()=>{};
    pointer(target);await tick();assert.equal(document.activeElement,input);
  };
  const replaceInput=async replacement=>{
    input.setSelectionRange(0,input.value.length);input.dispatchEvent(new window.InputEvent('beforeinput',{inputType:'insertText',data:replacement,bubbles:true}));input.value=replacement;
    input.dispatchEvent(new window.InputEvent('input',{inputType:'insertText',data:replacement,bubbles:true}));await tick();
  };
  await t.test('the reported old source snapshot converts bold sigma to a native sigma subscript',async()=>{
    const original=String.raw`\boldsymbol{\sigma}_\alpha`,entry=await activate(legacy('reported-sigma',original));
    assert.equal(document.activeElement,input);await submit(String.raw`\sigma_{\alpha}`);
    assert.equal(dialog.open,false);assert.equal(nodeOf().texExpression,String.raw`\sigma_{\alpha}`);
    const current=host.entries()[0].model;assert.equal(current,entry.model);assert.equal(current.root.items[0].type,'subscript');assert.equal([...current.nodes.values()].filter(node=>node.type==='source-tex').length,0);
    assert.equal(input.value,current.projection(),'hidden math input is synchronized before editing resumes');assert.equal(document.activeElement,input);
  });
  await t.test('a saved legacy bold-sigma record remains converted after dialog close and blur',async()=>{
    // A minimal legacy record reproduces the source/snapshot mismatch without
    // requiring a user's private document in a fresh checkout.
    const saved=legacy('saved-legacy-sigma',String.raw`\boldsymbol{\sigma}_\alpha`);
    await activate(saved);await submit(String.raw`\sigma_{\alpha}`);
    assert.equal(nodeOf().texExpression,String.raw`\sigma_{\alpha}`);assert.equal(host.entries()[0].model.root.items[0].type,'subscript');
    input.dispatchEvent(new window.FocusEvent('blur',{relatedTarget:button}));await tick();
    assert.equal(nodeOf().texExpression,String.raw`\sigma_{\alpha}`);assert.equal(host.entries()[0].model.root.items[0].type,'subscript');
  });
  await t.test('after editing a raw fragment inline, Apply converts even when the dialog source matches current exported TeX',async()=>{
    const old=String.raw`\boldsymbol{\sigma}_\alpha`,replacement=String.raw`\sigma_{\alpha}`,entry=await activate(legacy('inline-then-dialog',old));
    // Model an already active legacy/source editing session: startup conversion
    // intentionally does not run again for each change to this live formula.
    entry.model.restore(rawModel(old).snapshot());host.syncMath();await tick();
    const region=entry.model.root.items[0].regions[0],target=document.createElement('span');target.className='math-region region-'+region.id;entry.element.replaceChildren(target);
    entry.element.setPointerCapture=()=>{};
    pointer(target);await tick();assert.equal(document.activeElement,input);assert.equal(input.value,old);
    input.setSelectionRange(0,input.value.length);
    input.dispatchEvent(new window.InputEvent('beforeinput',{inputType:'insertText',data:replacement,bubbles:true}));input.value=replacement;
    input.dispatchEvent(new window.InputEvent('input',{inputType:'insertText',data:replacement,bubbles:true}));await tick();
    assert.equal(nodeOf().texExpression,replacement);assert.equal(entry.model.root.items[0].type,'source-tex','inline source typing leaves the raw component intact until explicit conversion');
    await submit(replacement);
    assert.equal(nodeOf().texExpression,replacement);assert.equal(entry.model.root.items[0].type,'subscript','explicit Apply must convert a same-source raw component');assert.equal([...entry.model.nodes.values()].filter(node=>node.type==='source-tex').length,0);
    assert.equal(input.value,entry.model.projection());assert.equal(document.activeElement,input);
  });
  await t.test('unchanged unsupported source creates no spurious conversion, undo entry or dirty state',async()=>{
    const unknown=String.raw`\futurecmd{x}`,entry=await activate(legacy('unchanged-opaque',unknown)),before=host.serializeDocument(),undos=host.editor.history.undos.length,snapshot=entry.model.snapshot();
    await submit(unknown);assert.equal(host.serializeDocument(),before);assert.equal(host.editor.history.undos.length,undos);assert.equal(entry.model.snapshot(),snapshot);assert.equal(host.hasUnsavedChanges(),false);
  });
  await t.test('a queued browser-style close event cannot replay the stale hidden math textarea after Apply',async()=>{
    const original=String.raw`\boldsymbol{\sigma}_\alpha`,replacement=String.raw`\sigma_{\alpha}`;await activate(legacy('queued-dialog-close',original));
    const nativeClose=dialog.close;
    // HappyDOM delivers close synchronously. Browsers queue it; exercise that
    // ordering explicitly without replacing any application event handler.
    dialog.close=function(value){const wasOpen=this.open;this.open=false;this.returnValue=value??'';if(wasOpen)setTimeout(()=>this.dispatchEvent(new window.Event('close')),0);};
    try{
      click(button);await tick();assert.equal(document.activeElement,source);assert.equal(input.hidden,true);
      input.value=original;source.value=replacement;source.dispatchEvent(new window.InputEvent('input',{inputType:'insertText',data:replacement,bubbles:true}));
      click(apply);assert.equal(dialog.open,false);
      input.dispatchEvent(new window.InputEvent('input',{inputType:'insertText',data:original,bubbles:true}));input.dispatchEvent(new window.FocusEvent('blur',{relatedTarget:apply}));
      await tick();await tick();assert.equal(nodeOf().texExpression,replacement);assert.equal(host.entries()[0].model.root.items[0].type,'subscript');assert.equal(input.value,host.entries()[0].model.projection());assert.equal(document.activeElement,input);
    }finally{dialog.close=nativeClose;}
  });
  for(const [name,tex,plain,original] of [
    ['two hyphens',String.raw`\textnormal{--}`,'--',String.raw`\text{--}`],
    ['plain',String.raw`\textnormal{eq}`,'eq'],
    ['CJK and spaces',String.raw`\textnormal{中文  text 空格}`,'中文  text 空格'],
    ['escaped percent and underscore',String.raw`\textnormal{rate \% and \_}`,'rate % and _'],
  ])await t.test('same-source Apply converts inline-edited textnormal: '+name,async()=>{
    const old=original??String.raw`\futurecmd{x}`,entry=await activate(legacy('textnormal-inline-'+name,old));assert.equal(entry.model.root.items[0].type,'source-tex');
    await enterRawRegion(entry,entry.model.root.items[0].regions[0]);assert.equal(input.value,old);await replaceInput(tex);assert.equal(nodeOf().texExpression,tex);assert.equal(entry.model.root.items[0].type,'source-tex');
    await submit(tex);assert.equal(nodeOf().texExpression,tex);const text=entry.model.root.items[0];assert.equal(text.type,'text-normal');assert.equal(text.regions[0].items.join(''),plain);assert.equal([...entry.model.nodes.values()].filter(node=>node.type==='source-tex').length,0);
    await enterRawRegion(entry,text.regions[0]);assert.equal(entry.model.rawInput,true);assert.equal(input.value,plain);
    input.setSelectionRange(input.value.length,input.value.length);input.dispatchEvent(new window.InputEvent('beforeinput',{inputType:'insertText',data:' 文',bubbles:true}));input.value+=' 文';input.dispatchEvent(new window.InputEvent('input',{inputType:'insertText',data:' 文',bubbles:true}));await tick();
    assert.equal(text.regions[0].items.join(''),plain+' 文');assert.equal(entry.model.rawInput,true);assert.equal(nodeOf().texExpression,entry.model.exportLatex());assert.equal(JSON.parse(nodeOf().snapshot).root.items[0].type,'text-normal');
  });
  await t.test('editing the complete dialog source to textnormal applies and persists its exact source',async()=>{
    const entry=await activate(legacy('textnormal-dialog',String.raw`\futurecmd{x}`)),tex=String.raw`\textnormal{eq 中文 \% \_}`;await submit(tex);
    assert.equal(nodeOf().texExpression,tex);assert.equal(entry.model.root.items[0].type,'text-normal');assert.equal(entry.model.root.items[0].regions[0].items.join(''),'eq 中文 % _');
    host.persist();await tick();assert.equal(nodeOf().texExpression,tex);assert.equal(JSON.parse(host.serializeDocument()).value[0].children.find(node=>node.type==='inline_equation').texExpression,tex);
  });
  await t.test('the exact reported text double-hyphen source converts to editable textnormal in the dialog',async()=>{
    const entry=await activate(legacy('textnormal-hyphens-dialog',String.raw`\text{--}`)),tex=String.raw`\textnormal{--}`;assert.equal(entry.model.root.items[0].type,'source-tex');await submit(tex);
    assert.equal(nodeOf().texExpression,tex);const text=entry.model.root.items[0];assert.equal(text.type,'text-normal');assert.equal(text.regions[0].items.join(''),'--');
    await enterRawRegion(entry,text.regions[0]);assert.equal(entry.model.rawInput,true);assert.equal(input.value,'--');await replaceInput('--tail');assert.equal(text.regions[0].items.join(''),'--tail');assert.equal(nodeOf().texExpression,String.raw`\textnormal{--tail}`);
  });
  await t.test('new upstream symbol buttons insert native atoms through the actual board click handler',async()=>{
    const entry=await activate({type:'inline_equation',id:'upstream-symbol-button',texExpression:'x',numbered:false,children:[{text:''}]});
    entry.model.setCursor(entry.model.root.id,entry.model.root.items.length);
    const symbol=document.querySelector('[data-insert="mathjax-symbol-amalg"]');assert.ok(symbol,'New upstream symbol has a compact button');click(symbol);await tick();
    assert.equal(entry.model.root.items.at(-1).type,'mathjax-symbol-amalg');assert.equal(entry.model.root.items.at(-1).atom,true);
    assert.equal(document.activeElement,input);assert.equal(nodeOf().texExpression,entry.model.exportLatex());
  });
  await t.test('the Tr button inserts in the active flow and keeps math input focused',async()=>{
    const entry=await activate({type:'inline_equation',id:'native-Tr-button',texExpression:'a+',numbered:false,children:[{text:''}]});
    const symbol=document.querySelector('[data-insert="function-Tr"]');assert.ok(symbol);click(symbol);await tick();
    const fn=entry.model.root.items.at(-1);assert.equal(fn.type,'function-Tr');assert.deepEqual(fn.regions,[]);
    assert.equal(entry.model.cursor.region,entry.model.root.id);assert.equal(document.activeElement,input);
    assert.equal(nodeOf().texExpression,'a+\\Tr ');
  });
  host.destroy();await window.happyDOM.abort();
});

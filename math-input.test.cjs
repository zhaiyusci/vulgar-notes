const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');

test('switching formulas during composition does not lock the next formula',async()=>{
 const {Window}=await import('happy-dom');
 const window=new Window({url:'http://localhost/'});
 window.document.write('<!doctype html><body><div id="preview"><div id="textFlow"><span id="formula"></span></div><textarea id="mathInput" hidden></textarea></div><div id="mathPanel"><div id="insertToolbar"></div></div><div id="error"></div><div id="pendingFontHint"></div><div id="structureCount"></div><select id="formulaLayout"></select></body>');
 window.setTimeout=()=>0;window.requestAnimationFrame=()=>0;
 const result=await build({entryPoints:['src/editor-ui.ts'],bundle:true,write:false,format:'iife',globalName:'mathUI'});
 window.eval(result.outputFiles[0].text+'\nwindow.mathUI=mathUI;');
 const input=window.document.getElementById('mathInput');
 let hooks,first,second;
 window.mathUI.mountMathEditor((mount,initial,h)=>{
  hooks=h;first={element:window.document.getElementById('formula'),model:initial};
  second={element:window.document.createElement('span'),model:new initial.constructor()};mount.append(second.element);
  for(const entry of [first,second]){entry.model.root.items=[];entry.model.index();entry.model.setCursor(entry.model.root.id,0);}
  return {entries:()=>[first,second],persist(){},exportLatex:()=>'',exportMarkdown:()=>'',isDisplay:()=>false,isNumbered:()=>false,readOnly:false};
 });
 hooks.activate(first.element,first.model,'end');
 input.dispatchEvent(new window.CompositionEvent('compositionstart'));
 input.value='a';input.dispatchEvent(new window.InputEvent('input',{isComposing:true}));
 hooks.leave();hooks.activate(second.element,second.model,'start');
 assert.equal(input.value,'','new formula must not retain the old composition');
 input.dispatchEvent(new window.InputEvent('beforeinput',{inputType:'insertText',data:'x'}));
 input.value='x';input.dispatchEvent(new window.InputEvent('input',{inputType:'insertText',data:'x'}));
 assert.equal(second.model.exportLatex(),'x','input must work before any late compositionend');
 assert.equal(first.model.exportLatex(),'a','the old composition belongs to the old formula');
 assert.equal(window.document.activeElement,input);
 await window.happyDOM.abort();
});

test('formula input and former preview controls never export the document',async()=>{
 const {Window}=await import('happy-dom');
 const window=new Window({url:'http://localhost/'});
 window.document.write('<!doctype html><body><div id="preview"><div id="textFlow"><span id="formula"></span></div><textarea id="mathInput" hidden></textarea></div><div id="mathPanel"><div id="insertToolbar"></div></div><div id="error"></div><div id="pendingFontHint"></div><div id="structureCount"></div><select id="formulaLayout"></select><details id="documentExports"><summary>Export</summary><textarea id="latex"></textarea><textarea id="documentLatex"></textarea><textarea id="documentMarkdown"></textarea></details></body>');
 let timerId=0;const timers=new Map();
 window.setTimeout=(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;};
 window.clearTimeout=id=>timers.delete(id);window.requestAnimationFrame=()=>0;
 const result=await build({entryPoints:['src/editor-ui.ts'],bundle:true,write:false,format:'iife',globalName:'mathUI'});
 window.eval(result.outputFiles[0].text+'\nwindow.mathUI=mathUI;');
 const input=window.document.getElementById('mathInput'),preview=window.document.getElementById('documentExports');
 let hooks,entry;const exports={latex:0,markdown:0};let syncs=0,persists=0;
 window.mathUI.mountMathEditor((mount,initial,h)=>{
  hooks=h;initial.root.items=[];initial.index();initial.setCursor(initial.root.id,0);
  entry={element:window.document.getElementById('formula'),model:initial};
  return {entries:()=>[entry],syncMath(){syncs++;},persist(){persists++;},exportLatex(){exports.latex++;return 'document latex: '+initial.exportLatex();},exportMarkdown(){exports.markdown++;return 'document markdown: '+initial.exportLatex();},isDisplay:()=>false,isNumbered:()=>false,readOnly:false};
 });
 hooks.activate(entry.element,entry.model,'end');
 const key=key=>input.dispatchEvent(new window.KeyboardEvent('keydown',{key}));
 const type=text=>{
  input.dispatchEvent(new window.InputEvent('beforeinput',{inputType:'insertText',data:text}));
  input.value+=text;input.dispatchEvent(new window.InputEvent('input',{inputType:'insertText',data:text}));
 };
 type('x');key('ArrowLeft');key('End');
 assert.ok(syncs>0,'formula updates still synchronize the host math state');
 assert.equal(persists,0,'formula input and cursor movement must not force full-document recovery serialization');
 assert.deepEqual(exports,{latex:0,markdown:0},'typing and cursor movement must not export the document');
 preview.open=true;
 assert.deepEqual(exports,{latex:0,markdown:0},'legacy preview controls cannot trigger document export');
 type('y');type('z');
 for(const [id,timer]of timers)if(timer.delay!==10000){timers.delete(id);timer.callback();}
 assert.deepEqual(exports,{latex:0,markdown:0},'document exports must not be deferred to a background preview task');
 preview.open=false;type('q');
 for(const [id,timer]of timers)if(timer.delay!==10000){timers.delete(id);timer.callback();}
 preview.open=true;
 assert.deepEqual(exports,{latex:0,markdown:0},'reopening legacy controls must never export the document');
 assert.equal(entry.model.exportLatex(),'xyzq','formula editing remains functional without export previews');
 await window.happyDOM.abort();
});

test('math rendering requests only changed formulas in a multi-formula document',async()=>{
 const {Window}=await import('happy-dom');
 const window=new Window({url:'http://localhost/'});
 window.document.write('<!doctype html><body><div id="preview"><div id="textFlow"><span id="formula"></span></div><textarea id="mathInput" hidden></textarea></div><div id="mathPanel"><div id="insertToolbar"></div></div><div id="error"></div><div id="pendingFontHint"></div><div id="structureCount"></div><select id="formulaLayout"></select></body>');
 const frames=[],requests=[];let exports=0,hooks,entries;
 window.setTimeout=()=>0;window.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};
 window.ready=true;
 window.MathJax={
  typesetClear(){},texReset(){},
  async typesetPromise(targets){
   for(const target of targets){
    if(target.id!=='renderStage')continue;
    requests.push(target.textContent);
    // Preserve each rendering request's result as a distinct DOM object. The
    // test covers our MathJax scheduling/cache, not MathJax's glyph layout.
    const result=window.document.createElement('mjx-container');result.textContent=target.textContent;target.replaceChildren(result);
   }
  }
 };
 const result=await build({entryPoints:['src/editor-ui.ts'],bundle:true,write:false,format:'iife',globalName:'mathUI'});
 window.eval(result.outputFiles[0].text+'\nwindow.mathUI=mathUI;');
 window.mathUI.mountMathEditor((mount,initial,h)=>{
  hooks=h;entries=Array.from({length:20},(_,index)=>{
   const model=index?new initial.constructor():initial,element=index?window.document.createElement('span'):window.document.getElementById('formula');
   element.classList.add('inline-formula');if(index)mount.append(element);
   model.root.items=['x',String(index)];model.index();model.setCursor(model.root.id,model.root.items.length);
   return {element,model};
  });
  return {entries:()=>entries,syncMath(){},persist(){},exportLatex(){exports++;return '';},exportMarkdown(){exports++;return '';},isDisplay:()=>false,isNumbered:()=>false,readOnly:false};
 });
 const draw=async()=>{
  assert.equal(frames.length,1,'updates within a frame should share one render');frames.shift()();
  for(let turn=0;turn<150&&window.document.getElementById('renderStage');turn++)await Promise.resolve();
  assert.equal(window.document.getElementById('renderStage'),null,'the asynchronous render must complete');
  assert.equal(window.document.getElementById('error').textContent,'');
 };
 await draw();
 assert.equal(requests.length,20,'initial layout renders each formula once');
 const untouched=entries.map(entry=>entry.element.firstChild);
 hooks.activate(entries[0].element,entries[0].model,'end');await draw();
 assert.equal(requests.length,21,'entering a formula redraws only its caret');
 const input=window.document.getElementById('mathInput');
 input.dispatchEvent(new window.InputEvent('beforeinput',{inputType:'insertText',data:'y'}));
 input.value+='y';input.dispatchEvent(new window.InputEvent('input',{inputType:'insertText',data:'y'}));await draw();
 assert.equal(requests.length,22,'typing redraws only the active formula');
 input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowLeft'}));await draw();
 assert.equal(requests.length,23,'caret movement redraws only the active formula');
 for(let index=1;index<entries.length;index++)assert.equal(entries[index].element.firstChild,untouched[index],'unaffected formulas retain their rendered DOM');
 hooks.activate(entries[1].element,entries[1].model,'end');await draw();
 assert.equal(requests.length,25,'switching formulas redraws only the old and new active formulas');
 for(let index=2;index<entries.length;index++)assert.equal(entries[index].element.firstChild,untouched[index]);
 assert.equal(exports,0,'rendering does not generate document export formats');
 await window.happyDOM.abort();
});

test('typed scripts stay inside the current input flow until the user leaves it',async()=>{
 const {Window}=await import('happy-dom');
 const window=new Window({url:'http://localhost/'});
 window.document.write('<!doctype html><body><div id="preview"><div id="textFlow"><span id="formula"></span></div><textarea id="mathInput" hidden></textarea></div><div id="mathPanel"><div id="insertToolbar"></div></div><div id="error"></div><div id="pendingFontHint"></div><div id="structureCount"></div><select id="formulaLayout"></select></body>');
 window.setTimeout=()=>0;window.requestAnimationFrame=()=>0;
 const result=await build({entryPoints:['src/editor-ui.ts'],bundle:true,write:false,format:'iife',globalName:'mathUI'});
 window.eval(result.outputFiles[0].text+'\nwindow.mathUI=mathUI;');
 const input=window.document.getElementById('mathInput');
 let hooks,entry;
 window.mathUI.mountMathEditor((mount,initial,h)=>{
  hooks=h;entry={element:window.document.getElementById('formula'),model:initial};
  return {entries:()=>[entry],syncMath(){},persist(){},exportLatex:()=>'',exportMarkdown:()=>'',isDisplay:()=>false,isNumbered:()=>false,readOnly:false};
 });
 const reset=()=>{
  entry.model.root.items=[];entry.model.index();entry.model.setCursor(entry.model.root.id,0);
  hooks.activate(entry.element,entry.model,'end');
 };
 const type=text=>{
  input.dispatchEvent(new window.InputEvent('beforeinput',{inputType:'insertText',data:text}));
  input.setRangeText(text,input.selectionStart,input.selectionEnd,'end');
  input.dispatchEvent(new window.InputEvent('input',{inputType:'insertText',data:text}));
 };
 reset();
 for(const ch of 'e^N_bead')type(ch);
 assert.equal(entry.model.exportLatex(),'{e}^{{N}_{bead}}');
 const power=entry.model.root.items[0],subscript=power.regions[1].items[0];
 assert.equal(power.type,'power');assert.equal(subscript.type,'subscript');
 assert.equal(entry.model.cursor.region,subscript.regions[1].id,'the caret stays in N’s subscript');
 assert.equal(input.value,'bead','native input projects the nested subscript rather than a parent region');
 type('s');assert.equal(entry.model.exportLatex(),'{e}^{{N}_{beads}}');
 reset();
 for(const ch of 'e_N^bead')type(ch);
 assert.equal(entry.model.exportLatex(),'{e}_{{N}^{bead}}','upper and lower scripts obey the same flow rule');
 reset();type('e^N_bead');
 assert.equal(entry.model.exportLatex(),'{e}^{{N}_{bead}}','a batched native insertion has the same scope as individual keystrokes');
 reset();type('e^N');
 input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight'}));
 assert.equal(entry.model.cursor.region,entry.model.root.id,'ArrowRight explicitly leaves the upper argument');
 type('_bead');
 assert.equal(entry.model.exportLatex(),'{e}_{bead}^{N}','the same base can still receive both scripts after an explicit exit');
 await window.happyDOM.abort();
});

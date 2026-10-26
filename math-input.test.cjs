const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');

test('switching formulas during composition does not lock the next formula',async()=>{
 const {Window}=await import('happy-dom');
 const window=new Window({url:'http://localhost/'});
 window.document.write('<!doctype html><body><div id="preview"><div id="textFlow"><span id="formula"></span></div><textarea id="mathInput" hidden></textarea></div><div id="mathPanel"><div id="insertToolbar"></div></div><div id="error"></div><div id="pendingFontHint"></div><div id="structureCount"></div><select id="formulaLayout"></select><textarea id="latex"></textarea><textarea id="documentLatex"></textarea><textarea id="documentMarkdown"></textarea></body>');
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

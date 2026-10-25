const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const fs=require('node:fs');
const {EditorModel}=require('./editor-model');
test('Plate document / independent MathJax mount integration',async t=>{
 const {Window}=await import('happy-dom');const window=new Window({url:'http://localhost/'});
 window.document.write('<!doctype html><html><body></body></html>');
 for(const key of ['window','document','navigator','sessionStorage','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Document','DocumentFragment','MutationObserver','ResizeObserver','DOMParser','Range','Event','KeyboardEvent','ClipboardEvent','DOMRect','HTMLDivElement','HTMLSpanElement','NodeFilter','ShadowRoot'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
 globalThis.getComputedStyle=window.getComputedStyle.bind(window);globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);
 await build({entryPoints:['src/plate-host.tsx'],bundle:true,platform:'node',format:'cjs',outfile:'.plate-test.cjs',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'test-kit',setup(b){b.onLoad({filter:/components[\\/]editor[\\/]editor-kit\.tsx$/},()=>({contents:`import {ParagraphPlugin} from 'platejs/react';import {MathKit} from './plugins/math-kit';import {MarkdownKit} from './plugins/markdown-kit';export const EditorKit=[ParagraphPlugin,...MathKit,...MarkdownKit];`,loader:'tsx',resolveDir:require('node:path').resolve('src/components/editor')}))}}]});
 const {PlateMathHost}=require('./.plate-test.cjs');fs.unlinkSync('.plate-test.cjs');
 const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
 function setup(){sessionStorage.clear();const mount=document.createElement('div');document.body.append(mount);const activations=[];const flow=new PlateMathHost(mount,new EditorModel(),{activate:(...args)=>activations.push(args),leave(){},change(){}});return {flow,editor:flow.editor,activations};}
 await t.test('math edits persist and restore as editable trees',async()=>{
  const {flow,editor,activations}=setup();const entry=flow.insertFormula();entry.model.replaceInput(0,0,'z^2');flow.persist();await tick();
  assert.equal(flow.entries().length,2);assert.ok(activations.length);assert.match(flow.exportMarkdown(),/\{z\}\^\{2\}/);
  const saved=JSON.parse(sessionStorage.getItem('math-plate-document-v1'));assert.equal(saved.value[0].children.filter(n=>n.type==='inline_equation').length,2);
  assert.equal(editor.children[0].children.find(n=>n.id===entry.element.dataset.mathId).texExpression,'{z}^{2}');flow.destroy();
 });
 await t.test('document undo and redo restore the math model without reapplying stale edits',async()=>{
  const {flow,editor}=setup();const entry=flow.entries()[0],before=entry.model.exportLatex();entry.model.setCursor(entry.model.root.id,entry.model.root.items.length);entry.model.replaceInput(entry.model.cursor.offset,entry.model.cursor.offset,'+z');flow.persist();await tick();
  editor.tf.undo();await tick();assert.equal(flow.entries()[0].model.exportLatex(),before);
  editor.tf.redo();await tick();assert.equal(flow.entries()[0].model.exportLatex(),before+'+z');flow.destroy();
 });
 await t.test('React keeps MathJax DOM and Slate void children independent',async()=>{
  const {flow,editor}=setup();const element=flow.entries()[0].element;const rendered=document.createElement('mjx-container');rendered.textContent='rendered math';element.replaceChildren(rendered);
  editor.tf.select(editor.api.end([]));editor.tf.insertText('正文');await tick();
  assert.equal(element.firstChild,rendered);assert.ok(element.closest('[data-slate-node="element"]').querySelector('[data-slate-node="text"]'));flow.destroy();
 });
 await t.test('copying a formula creates an independent identity and math model',async()=>{
  const {flow,editor}=setup();const node=editor.children[0].children.find(n=>n.type==='inline_equation');editor.tf.select(editor.api.end([]));editor.tf.insertNodes(JSON.parse(JSON.stringify(node)));await tick();
  const entries=flow.entries();assert.equal(entries.length,2);assert.notEqual(entries[0].element.dataset.mathId,entries[1].element.dataset.mathId);assert.notEqual(entries[0].model,entries[1].model);assert.equal(entries[0].model.exportLatex(),entries[1].model.exportLatex());flow.destroy();
 });
 await t.test('inline/display conversion preserves surrounding prose and numbering can be undone',async()=>{
  const {flow,editor}=setup();const before=flow.entries()[0].model.exportLatex();flow.setDisplay(flow.entries()[0].element,true);await tick();
  assert.ok(flow.entries()[0].element.dataset.display==='true');assert.equal(flow.entries()[0].model.exportLatex(),before);assert.match(flow.exportMarkdown(),/在这里输入正文/);assert.match(flow.exportMarkdown(),/可以继续输入/);
  flow.setNumbered(flow.entries()[0].element,false);await tick();assert.equal(flow.entries()[0].element.dataset.numbered,'false');editor.tf.undo();await tick();assert.equal(flow.entries()[0].element.dataset.numbered,'true');
  flow.setDisplay(flow.entries()[0].element,false);await tick();assert.equal(flow.entries()[0].model.exportLatex(),before);flow.destroy();
 });
 await t.test('inserting while editing math stays beside that formula without focusing prose',async()=>{
  const {flow,editor,activations}=setup();const original=flow.entries()[0];
  let proseFocus=0;editor.tf.focus=()=>{proseFocus++;};
  flow.enter(original.element,'end');const added=flow.insertFormula();
  added.model.replaceInput(0,0,'k');flow.persist();await tick();
  const children=editor.children[0].children;
  const oldIndex=children.findIndex(n=>n.id===original.element.dataset.mathId);
  const newIndex=children.findIndex(n=>n.id===added.element.dataset.mathId);
  assert.ok(newIndex>oldIndex);assert.equal(proseFocus,0);
  assert.equal(activations.at(-1)[0],added.element);
  assert.equal(added.model.exportLatex(),'k');flow.destroy();
 });
 await t.test('Markdown preserves equation numbering and reimports structural math',async()=>{
  const {flow,editor}=setup();const node=flow.insertFormula(true);node.model.replaceInput(0,0,'q^2');flow.persist();await tick();
  const markdown=flow.exportMarkdown();assert.match(markdown,/numbered/,markdown);
  const nodes=editor.api.markdown.deserialize(markdown);const equation=nodes.find(n=>n.type==='equation');assert.ok(equation,JSON.stringify({markdown,nodes}));assert.equal(equation.numbered,true);assert.equal(equation.texExpression,'{q}^{2}');flow.destroy();
 });
 await t.test('display math inserts and exits within one paragraph; layout toggles preserve prose',async()=>{
  const {flow,editor}=setup();
  const before=editor.children.length,first=flow.entries()[0];
  flow.setDisplay(first.element,true);await tick();
  assert.equal(editor.children.length,before);
  assert.equal(editor.children[0].children.find(n=>n.id===first.element.dataset.mathId).display,true);
  flow.exit(flow.entries()[0].element,1,false);
  assert.equal(editor.selection.anchor.path[0],0);
  const added=flow.insertFormula(true);await tick();
  assert.equal(editor.children.length,before);
  assert.equal(editor.children[0].children.find(n=>n.id===added.element.dataset.mathId).display,true);
  flow.setDisplay(added.element,false);await tick();
  assert.equal(editor.children.length,before);
  assert.match(flow.exportLatex(),/在这里输入正文/);assert.match(flow.exportLatex(),/可以继续输入/);
  const saved=JSON.parse(sessionStorage.getItem('math-plate-document-v1'));
  assert.equal(saved.value[0].children.find(n=>n.id===first.element.dataset.mathId).display,true);
  flow.destroy();
 }); await window.happyDOM.abort();
});

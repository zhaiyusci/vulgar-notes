const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const Module=require('node:module');
const path=require('node:path');
const {EditorModel}=require('./editor-model');

test('dedicated endnote toolbar insertion',async t=>{
 const {Window}=await import('happy-dom');const window=new Window({url:'http://localhost/'});
 window.document.write('<!doctype html><html><body></body></html>');
 // happy-dom has no layout; let Slate skip its optional Range-based scrolling.
 Object.defineProperty(window.Range.prototype,'getBoundingClientRect',{value:undefined,configurable:true});
 for(const key of ['innerWidth','innerHeight','window','document','navigator','sessionStorage','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Document','DocumentFragment','MutationObserver','ResizeObserver','DOMParser','Range','Event','CustomEvent','KeyboardEvent','ClipboardEvent','DOMRect','HTMLDivElement','HTMLSpanElement','NodeFilter','ShadowRoot'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
 globalThis.getComputedStyle=window.getComputedStyle.bind(window);globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);
 const output=await build({stdin:{contents:`export {PlateMathHost} from './src/plate-host';export {insertEndnote} from './src/components/editor/insert-endnote';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'test-kit',setup(b){b.onLoad({filter:/components[\\/]editor[\\/]editor-kit\.tsx$/},()=>({contents:`import {ParagraphPlugin,createPlatePlugin} from 'platejs/react';import {TrailingBlockPlugin} from 'platejs';import {MathKit} from './plugins/math-kit';import {MarkdownKit} from './plugins/markdown-kit';import {ReferenceKit} from './plugins/reference-kit';import {FootnoteKit} from './plugins/footnote-kit';import {InsertEndnoteToolbarButton} from '../ui/insert-endnote-toolbar-button';import {Toolbar} from '../ui/toolbar';export const EditorKit=[ParagraphPlugin,...MathKit,...ReferenceKit,TrailingBlockPlugin,...MarkdownKit,...FootnoteKit,createPlatePlugin({key:'endnote-test-toolbar',render:{beforeEditable:()=> <Toolbar><InsertEndnoteToolbarButton /></Toolbar>}})];`,loader:'tsx',resolveDir:path.resolve('src/components/editor')}));}}]});
 const compiled=new Module(path.resolve('.endnote-toolbar-test.cjs'),module);compiled.paths=module.paths;compiled._compile(output.outputFiles[0].text,path.resolve('.endnote-toolbar-test.cjs'));
 const {PlateMathHost,insertEndnote}=compiled.exports;
 const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
 const flows=[];t.after(async()=>{for(const flow of flows)flow.destroy();await window.happyDOM.abort();});
 function setup(){sessionStorage.clear();const mount=document.createElement('div');document.body.append(mount);const flow=new PlateMathHost(mount,new EditorModel(),{activate(){},leave(){},change(){}});flows.push(flow);return {flow,editor:flow.editor};}
 function click(flow){const button=flow.mount.querySelector('button[aria-label]');assert.ok(button,'dedicated endnote button is rendered');assert.ok(button.title);button.dispatchEvent(new window.PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0}));button.dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true,button:0}));}
 const definitions=editor=>editor.children.filter(node=>node.type==='footnoteDefinition');
 const references=editor=>editor.children.flatMap(node=>node.type==='p'?node.children:[]).filter(node=>node.type==='footnoteReference');

 await t.test('button inserts at the body cursor, focuses editable note text and undoes both objects together',async()=>{
  const {flow,editor}=setup();flow.openDocument(JSON.stringify({version:1,value:[{type:'p',children:[{text:'Before after'}]}]}));
  editor.tf.focus({at:{path:[0,0],offset:7}});await tick();const before=JSON.parse(JSON.stringify(editor.children));
  click(flow);await tick();assert.equal(references(editor).length,1);assert.equal(definitions(editor).length,1);
  assert.equal(editor.children[0].children[0].text,'Before ');assert.equal(editor.children[0].children[2].text,'after');
  const point=editor.selection.anchor;assert.equal(editor.children[point.path[0]].type,'footnoteDefinition');assert.equal(editor.api.isFocused(),true);
  assert.equal(editor.history.undos.length,1,'reference and definition form one history batch');
  editor.tf.undo();await tick();assert.deepEqual(editor.children,before);assert.equal(references(editor).length,0);assert.equal(definitions(editor).length,0);
 });
 await t.test('selected rich prose moves into the note and remains directly editable',async()=>{
  const {flow,editor}=setup();flow.openDocument(JSON.stringify({version:1,value:[{type:'p',children:[{text:'Intro '},{text:'selected words',bold:true},{text:' end'}]}]}));
  editor.tf.select({anchor:{path:[0,1],offset:0},focus:{path:[0,1],offset:14}});click(flow);await tick();
  const note=definitions(editor)[0];assert.equal(note.children[0].children[0].text,'selected words');assert.equal(note.children[0].children[0].bold,true);
  assert.equal(editor.children[0].children.some(node=>node.text==='selected words'),false);
  editor.tf.insertText('New ');await tick();assert.match(definitions(editor)[0].children[0].children[0].text,/New selected words/);assert.equal(definitions(editor)[0].children[0].children[0].bold,true);
 });
 await t.test('active formula insertion first exits to a valid body point and preserves the formula',async()=>{
  const {flow,editor}=setup();const entry=flow.insertFormula(false,'x^2');const formulaId=entry.element.dataset.mathId;
  assert.equal(flow.activeFormulaId,formulaId);assert.equal(editor.selection,null);click(flow);await tick();
  assert.equal(flow.activeFormulaId,undefined);assert.equal(references(editor).length,1);assert.equal(definitions(editor).length,1);
  const paragraph=editor.children.find(node=>node.type==='p'&&node.children.some(child=>child.id===formulaId));
  const formulaIndex=paragraph.children.findIndex(child=>child.id===formulaId),referenceIndex=paragraph.children.findIndex(child=>child.type==='footnoteReference');assert.ok(referenceIndex>formulaIndex);
  assert.equal(flow.models.get(formulaId).exportLatex(),'{x}^{2}');assert.equal(editor.children[editor.selection.anchor.path[0]].type,'footnoteDefinition');
 });
 await t.test('button insertion with no selection uses a document endpoint instead of silently doing nothing',async()=>{
  const {flow,editor}=setup();flow.openDocument(JSON.stringify({version:1,value:[{type:'p',children:[{text:'Document text'}]}]}));editor.tf.deselect();
  click(flow);await tick();assert.equal(references(editor).length,1);assert.equal(definitions(editor).length,1);assert.equal(editor.children[0].children[0].text,'Document text');assert.equal(editor.children[editor.selection.anchor.path[0]].type,'footnoteDefinition');
 });
 await t.test('shared inserter without a document host still creates one focused undoable note',async()=>{
  const {flow,editor}=setup();flow.openDocument(JSON.stringify({version:1,value:[{type:'p',children:[{text:'Menu route'}]}]}));editor.tf.deselect();
  insertEndnote(editor);await tick();assert.equal(references(editor).length,1);assert.equal(definitions(editor).length,1);assert.equal(editor.children[editor.selection.anchor.path[0]].type,'footnoteDefinition');
  editor.tf.undo();await tick();assert.equal(references(editor).length,0);assert.equal(definitions(editor).length,0);
 });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const {EditorModel,catalog,symbols} = require('./editor-model.js');
const empty=()=>{const m=new EditorModel();m.root.items=[];m.index();m.setCursor(m.root.id,0);return m;};
test('letter palette filters each alphabet and keeps Unicode legacy slots',()=>{
 assert.equal(symbols.filter(d=>d.category==='拉丁字母'&&d.type===d.variantOf).length,52);
 for(const key of ['symbol-letter-h--symit','symbol-letter-B--symscr','symbol-letter-R--symbb','symbol-alpha--editorbboldx'])assert.ok(symbols.some(d=>d.type===key),key);
 for(const key of ['symbol-letter-h--mathds','symbol-letter-b--mathds','symbol-alpha--mathbbm'])assert.ok(!symbols.some(d=>d.type===key),key);
 assert.ok(symbols.find(d=>d.type==='symbol-alpha--symsf').hidden);
 assert.ok(catalog.filter(d=>d.font).every(d=>d.hidden));
});
test('one-letter variant changes preserve neighboring sequence and undo',()=>{
 const m=empty();m.insert('a+h');m.switchLetter(m.root.id,2,'symbol-letter-h--editorbboldx');assert.equal(m.exportLatex(),'a+\\mathbb{h}');
 const id=m.root.items[2].id;m.switchVariant(id,'symbol-letter-h--symbb');assert.equal(m.exportLatex(),'a+\\mathbb{h}');
 m.undo();assert.equal(m.exportLatex(),'a+\\mathbb{h}');m.undo();assert.equal(m.exportLatex(),'a+h');
});
test('textnormal and textrm alias enter literal descriptive text',()=>{
 for(const command of ['textnormal','textrm']){
 const m=empty();m.replaceInput(0,0,'\\'+command+' ');m.replaceInput(...m.range,'x_1 ^ 2 = 50%');
 assert.equal(m.exportLatex(),'\\textnormal{x\\_1 \\textasciicircum{} 2 = 50\\%}');
 assert.ok(m.rawInput);assert.ok(m.current.items.every(i=>typeof i==='string'));const n=empty();n.restore(m.snapshot());assert.equal(n.exportLatex(),m.exportLatex());
 }
});

test('blackboard aliases are per-letter, native export is preferred and DS is hidden',()=>{
 const get=t=>symbols.find(d=>d.type===t);
 for(const letter of ['A','h','1']){
  const d=get('symbol-letter-'+letter+'--editorbboldx');assert.equal(d.exportTex,'\\mathbb{'+letter+'}');assert.deepEqual(d.equivalentTex,['\\mathbb{'+letter+'}']);
 }
 assert.equal(get('symbol-alpha--editorbboldx').exportTex,'\\bbalpha ');
 assert.ok(get('symbol-alpha--editorbboldxbold').exportTex.includes('\\usefont{U}{bboldx}{b}'));
 assert.ok(get('symbol-alpha--editorbboldxlight').exportTex.includes('\\usefont{U}{bboldx}{l}'));
 assert.ok(!symbols.some(d=>!d.hidden&&/--(mathds|editordssans)$/.test(d.type)));
 assert.ok(get('symbol-letter-A--symbfup').hidden);
 assert.ok(get('symbol-letter-A--symbf').equivalentTex.includes('\\mathbfup{A}'));
 for(const name of ['mathbb','symbb']){const m=empty();m.replaceInput(0,0,'\\'+name+' α');assert.equal(m.exportLatex(),'\\bbalpha ');assert.equal(m.fontWarnings().length,0);}
 const m=empty();m.replaceInput(0,0,'\\bbalpha ');assert.equal(m.exportLatex(),'\\bbalpha ');
});

test('retired blackboard drafts migrate to BBoldX without legacy palette entries',()=>{
 for(const style of ['mathbbm','mathbbmss','mathbbmtt','editorbbmbold','editorbbmssbold','mathds','editordssans']){
  assert.ok(!symbols.some(d=>d.type.endsWith('--'+style)));
  const m=empty();m.insert('a+h');m.switchLetter(m.root.id,2,'symbol-letter-h--editorbboldx');
  const saved=m.snapshot().replace('--editorbboldx','--'+style);
  const restored=empty();restored.restore(saved);assert.equal(restored.exportLatex(),'a+\\mathbb{h}');
 }
 assert.ok(!symbols.some(d=>!d.hidden&&/--editorbboldx(?:bold|light)$/.test(d.type)));
});

test('native blackboard symbols match menu previews and delimit adjacent Latin letters',()=>{
 for(const name of ['alpha','Gamma','omega','imath','jmath']){
  const d=symbols.find(d=>d.type==='symbol-'+name+'--editorbboldx');
  assert.ok(/^\\bb[A-Za-z]+ $/.test(d.exportTex));assert.equal(d.tex,d.exportTex);assert.deepEqual(d.equivalentTex,[d.exportTex]);
 }
 const m=empty();m.replaceInput(0,0,'\\bbalpha ');m.insert('x');assert.equal(m.exportLatex(),'\\bbalpha x');
});

test('font command input styles one atom and keeps later input in the surrounding sequence',()=>{
 for(const source of ['\\mathfrak abc','\\symfrak abc'])for(const chunks of [[source],Array.from(source)]){
  const m=empty();for(const chunk of chunks)m.replaceInput(...m.range,chunk);
  assert.equal(m.exportLatex(),'\\mathfrak{a}bc');assert.equal(m.current,m.root);
  assert.ok(m.root.items[0].atom);assert.equal(m.root.items[0].regions.length,0);
 }
 const m=empty();m.replaceInput(0,0,'\\mathfrak');m.commitCommand();assert.equal(m.current,m.root);assert.equal(m.root.items.length,0);
 const waiting=m.snapshot();m.replaceInput(...m.range,'abc');assert.equal(m.exportLatex(),'\\mathfrak{a}bc');
 m.undo();assert.equal(m.snapshot(),waiting);m.redo();assert.equal(m.exportLatex(),'\\mathfrak{a}bc');
});
test('single-letter font input accepts Greek commands and warns without opening a font region',()=>{
 for(const chunks of [['\\mathfrak \\alpha x'],Array.from('\\mathfrak \\alpha x')]){
  const m=empty();for(const chunk of chunks)m.replaceInput(...m.range,chunk);
  assert.equal(m.exportLatex(),'\\mathfrak{\\alpha}x');assert.equal(m.current,m.root);
  assert.equal(m.fontWarnings().length,1);assert.equal(m.root.items[0].regions.length,0);
 }
 const m=empty();m.replaceInput(0,0,'\\mathbb αβ');assert.equal(m.exportLatex(),'\\bbalpha β');
});
test('pending letter style cancels on navigation, deletion and structure insertion',()=>{
 for(const cancel of [m=>m.move(-1),m=>m.remove(-1),m=>m.tab(1),m=>m.insertStructure('frac')]){
  const m=empty();m.replaceInput(0,0,'\\mathfrak ');cancel(m);assert.equal(m.pendingFont,undefined);
  m.replaceInput(...m.range,'a');assert.ok(!m.exportLatex().includes('mathfrak'));
 }
});

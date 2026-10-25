const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const vm=require('node:vm');
const {EditorModel}=require('./editor-model.js');
const source=buildSync({entryPoints:['src/plate-document.ts','src/tex-import.ts'],bundle:true,format:'cjs',write:false,outdir:'test-output',platform:'node'}).outputFiles;
function load(name,storage){const module={exports:{}};vm.runInNewContext(source.find(f=>f.path.endsWith(name+'.js')).text,{module,exports:module.exports,console,crypto:globalThis.crypto,sessionStorage:storage});return module.exports;}
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)}};
const model=()=>{const m=new EditorModel();m.root.items=['x'];m.index();m.setCursor(m.root.id,1);return m};

test('Tiptap draft migration retains marks, nested math, layout, numbering and the original draft',()=>{
 const s=storage(),api=load('plate-document',s),m=model();
 const old=JSON.stringify({version:2,doc:{type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'标题'}]},{type:'paragraph',content:[{type:'text',text:'重点',marks:[{type:'bold'}]},{type:'inlineMath',attrs:{id:'a',snapshot:m.snapshot()}}]},{type:'displayMath',attrs:{id:'b',snapshot:m.snapshot(),numbered:false}}]}});
 s.setItem('math-tiptap-document-v1',old);const value=api.restoreDocument(m);
 assert.equal(value[0].type,'h2');assert.equal(value[1].children[0].bold,true);
 assert.equal(value[1].children[1].snapshot,m.snapshot());assert.equal(value[2].numbered,false);
 assert.equal(s.getItem('math-tiptap-document-v1'),old);
 assert.match(api.plateLatex(value),/\\begin\{equation\*\}/);
});
test('legacy flow migration preserves math and nested rich text',()=>{
 const s=storage(),api=load('plate-document',s),m=model();
 const old=JSON.stringify({version:1,parts:[{kind:'rich',tag:'p',children:[{kind:'rich',tag:'strong',children:[{kind:'text',text:'文字'}]},{kind:'math',id:'old',snapshot:m.snapshot()}]}]});s.setItem('math-text-flow-state',old);
 const value=api.restoreDocument(m);assert.equal(value[0].children[0].bold,true);assert.equal(value[0].children[1].texExpression,'x');assert.equal(s.getItem('math-text-flow-state'),old);
});
test('Plate snapshot roundtrip retains arbitrary rich nodes and formula semantics',()=>{
 const s=storage(),api=load('plate-document',s),m=model();const value=[{type:'table',children:[{type:'tr',children:[{type:'td',children:[{type:'p',children:[api.formulaNode(m)]}]}]}]}];
 s.setItem(api.documentStorageKey,JSON.stringify({version:1,value}));assert.equal(JSON.stringify(api.restoreDocument(m)),JSON.stringify(value));
});
test('invalid drafts are preserved for recovery',()=>{
 const s=storage(),api=load('plate-document',s);s.setItem(api.documentStorageKey,'bad');assert.ok(api.restoreDocument(model()).length);assert.equal(s.getItem(api.documentStorageKey+'-recovery'),'bad');
});
test('imported TeX supports nested fractions, indexed roots, functions and scripts',()=>{
 const {importMath}=load('tex-import');const m=importMath('\\frac{\\sqrt[3]{x+1}}{a+\\frac{b}{c}}+\\sin x^2');assert.ok(m);assert.match(m.exportLatex(),/\\sqrt\[3\]\{x\+1\}/);assert.match(m.exportLatex(),/\\sin/);assert.match(m.exportLatex(),/\{x\}\^\{2\}/);
 const roundtrip=new EditorModel();roundtrip.restore(m.snapshot());assert.equal(roundtrip.exportLatex(),m.exportLatex());
});
test('unsupported or malformed TeX never becomes a silently altered editable tree',()=>{
 const {importMath}=load('tex-import');for(const tex of ['\\unknown{x}','\\frac{x}','x^{','\\begin{matrix}a&b\\end{matrix}'])assert.equal(importMath(tex),null);
 assert.equal(importMath('').exportLatex(),'');
});

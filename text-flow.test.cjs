const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const vm=require('node:vm');
const {EditorModel}=require('./editor-model.js');
const source=buildSync({entryPoints:['src/plate-document.ts','src/tex-import.ts','src/latex-document.ts'],bundle:true,format:'cjs',write:false,outdir:'test-output',platform:'node'}).outputFiles;
function load(name,storage,desktopStorage){const module={exports:{}};vm.runInNewContext(source.find(f=>f.path.endsWith(name+'.js')).text,{module,exports:module.exports,console,crypto:globalThis.crypto,sessionStorage:storage,...(desktopStorage?{window:{__TAURI_INTERNALS__:{}},localStorage:desktopStorage}:{})});return module.exports;}
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)}};
const model=()=>{const m=new EditorModel();m.root.items=['x'];m.index();m.setCursor(m.root.id,1);return m};

test('standalone TeX includes native fonts, packages, document boundaries and equation numbering',()=>{
 const api=load('latex-document',storage()),m=model();
 const formula=numbered=>({type:'inline_equation',display:true,numbered,snapshot:m.snapshot(),children:[{text:''}]});
 const value=[{type:'p',children:[{text:'中文 100% & x_y'},formula(true),formula(false)]}];
 const before=JSON.stringify(value),tex=api.latexDocument(value);
 assert.match(tex,/\\documentclass\[.*fontset=fandol.*\]\{ctexart\}/);
 for(const pkg of ['mathtools','extarrows','cancel','unicode-math','physics','mhchem','bboldx'])assert.ok(tex.includes('{'+pkg+'}'));
 assert.match(tex,/\\setmathfont\{NewCMMath-Regular.otf\}/);
 assert.match(tex,/\\begin\{document\}[\s\S]*中文 100\\% \\& x\\_y/);
 assert.match(tex,/\\begin\{equation\}/);assert.match(tex,/\\begin\{equation\*\}/);
 assert.ok(tex.endsWith('\\end{document}\n'));assert.equal(JSON.stringify(value),before);
});

test('physical-unit export expands balanced pu arguments without changing other math or prose',()=>{
 const api=load('latex-document',storage());
 const tex=api.portableMath(String.raw`\frac{\pu{1.2e3 kg m/s^2}}{\ce{H2O}}+\pu{123 kJ*mol-1}`);
 assert.doesNotMatch(tex,/\\pu\{/);assert.match(tex,/10/);assert.match(tex,/\\ce\{H2O\}/);
 assert.doesNotThrow(()=>api.portableMath(String.raw`\pu{m^{2}}`));
 assert.equal(api.portableMath(String.raw`a\divisionsymbol b`),'a÷ b');
 assert.throws(()=>api.portableMath(String.raw`\pu{m`));
 const literal=String.raw`\\pu{not a command}`;assert.equal(api.portableMath(literal),literal);
 assert.match(api.latexDocument([{type:'p',children:[{text:String.raw`\pu{sample}`}]}]),/textbackslash/);
});

test('desktop draft survives a new session and browser drafts remain isolated',()=>{
 const persistent=storage(),session=storage();
 persistent.setItem('math-plate-document-v1',JSON.stringify({version:1,value:[{type:'p',children:[{text:'Desktop draft'}]}]}));
 const first=load('plate-document',session,persistent).restoreDocument(model());
 const reopened=load('plate-document',storage(),persistent).restoreDocument(model());
 assert.equal(first[0].children[0].text,'Desktop draft');
 assert.equal(reopened[0].children[0].text,'Desktop draft');
 assert.notEqual(load('plate-document',session).restoreDocument(model())[0].children[0].text,'Desktop draft');
});

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

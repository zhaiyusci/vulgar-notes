const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const vm=require('node:vm');
const {EditorModel}=require('./editor-model.js');
const source=buildSync({entryPoints:['src/plate-document.ts','src/tex-import.ts','src/latex-document.ts','src/references.ts'],bundle:true,format:'cjs',write:false,outdir:'test-output',platform:'node'}).outputFiles;
function load(name,storage,desktopStorage,sessionId){const module={exports:{}};const window=desktopStorage||sessionId?{...(desktopStorage?{__TAURI_INTERNALS__:{}}:{}),location:{href:'https://example.test/vulgar-notes/'+(sessionId?'?document='+sessionId:'')}}:undefined;vm.runInNewContext(source.find(f=>f.path.endsWith(name+'.js')).text,{module,exports:module.exports,console,URL,crypto:globalThis.crypto,sessionStorage:storage,localStorage:desktopStorage??storage,...(window?{window}:{})});return module.exports;}
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)}};
const model=()=>{const m=new EditorModel();m.root.items=['x'];m.index();m.setCursor(m.root.id,1);return m};

test('cross-references follow equation order and ignore unnumbered and inline equations',()=>{
 const api=load('references',storage());
 const equation=(key,extra={})=>({type:'inline_equation',display:true,texLabel:key,children:[{text:''}],...extra});
 const a=equation('eq:a'),b=equation('eq:b');
 const p=children=>({type:'p',children});
 const ref={command:'eqref',keys:['eq:a']};
 assert.equal(api.resolveReference([p([a,b])],ref).text,'(1)');
 assert.equal(api.resolveReference([p([b,equation('eq:skip',{numbered:false}),equation('eq:inline',{display:false}),a])],ref).text,'(2)');
 assert.equal(api.resolveReference([p([b])],ref).invalid,true);
 assert.equal(api.resolveReference([p([a,{...a}])],ref).text,'(??)');
 assert.equal(api.referenceTargets([{type:'h1',children:[{text:'A'}]},{type:'h2',children:[{text:'B'}]},{type:'h1',children:[{text:'C'}]}]).map(x=>x.number).join(','),'1,1.1,2');
});

test('bibliography numbers, multiple citations and missing keys resolve independently',()=>{
 const api=load('references',storage());
 const a={type:'bibliography_entry',citeKey:'a',children:[{text:'A'}]},b={...a,citeKey:'b'};
 const ref={command:'cite',keys:['b','a']};
 assert.equal(api.resolveReference([a,b],ref).text,'[2, 1]');
 assert.equal(api.resolveReference([b,a],ref).text,'[1, 2]');
 assert.equal(api.resolveReference([a],ref).text,'[??, 1]');
 assert.throws(()=>api.referenceTex({command:'eqref',keys:['a','b']}));
 assert.throws(()=>api.referenceTex({command:'cite',keys:['a}\\input{x}']}));
});

test('BibTeX citations follow body appearance before unreferenced legacy rows and expose uncited picker entries',()=>{
 const api=load('references',storage());
 const libraries=[{id:'lib',name:'Papers.bib',source:'@article{earlier,title={Earlier}}\n@book{2026:最后,title={Last}}\n@book{unused,title={Uncited}}'}];
 const cite=keys=>({type:'tex_reference',command:'cite',keys,children:[{text:''}]});
 const value=[{type:'p',children:[cite(['2026:最后','earlier']),cite(['2026:最后','missing'])]},{type:'bibliography_entry',citeKey:'manual',children:[{text:'Manual entry'}]}];
 const targets=api.referenceTargets(value,libraries);
 assert.equal(targets.find(target=>target.key==='manual').number,'3');
 assert.equal(targets.find(target=>target.key==='2026:最后').number,'1');
 assert.equal(targets.find(target=>target.key==='earlier').number,'2');
 assert.equal(targets.find(target=>target.key==='unused').number,'');
 assert.equal(targets.find(target=>target.key==='2026:最后').libraryId,'lib');
 assert.equal(api.resolveReference(value,cite(['2026:最后','earlier']),libraries).text,'[1, 2]');
 assert.equal(api.resolveReference(value,cite(['2026:最后','missing']),libraries).text,'[1, ??]');
 assert.equal(api.resolveReference(value,cite(['2026:最后','missing']),libraries).invalid,true);
 assert.equal(api.referenceTex(cite(['2026:最后'])),'\\cite{2026:最后}');
 assert.throws(()=>api.referenceTex({command:'ref',keys:['2026:最后']}),'broader citation keys must not broaden TeX labels');
 value[0].children=[cite(['earlier','2026:最后'])];
 assert.equal(api.resolveReference(value,cite(['2026:最后']),libraries).text,'[2]');
});

test('native documents validate attached BibTeX before accepting text and preserve corrupt drafts',()=>{
 const s=storage(),api=load('plate-document',s);
 const value=[{type:'p',children:[{text:'Saved text'}]}];
 const library={id:'papers',name:'Papers.bib',source:'@article{2026:论文,title={Title}}'};
 const envelope={version:1,value,bibliographyLibraries:[library]};
 const parsed=api.parseDocumentEnvelope(JSON.stringify(envelope));
 assert.equal(parsed.bibliographyLibraries[0].source,library.source);
 assert.equal(JSON.stringify(parsed.value),JSON.stringify(value));
 assert.equal(api.parseDocumentEnvelope(JSON.stringify({version:1,value})).bibliographyLibraries.length,0);
 assert.throws(()=>api.parseDocumentFile(JSON.stringify({...envelope,bibliographyLibraries:'invalid'})));
 assert.throws(()=>api.parseDocumentFile(JSON.stringify({...envelope,bibliographyLibraries:[{...library,source:'@article{broken,title='}]})));
 assert.equal(api.parseDocumentFile(JSON.stringify({...envelope,value:[{type:'bibliography_entry',citeKey:'2026:论文',children:[{text:'Manual'}]}]}))[0].citeKey,'2026:论文');
 const corrupt=JSON.stringify({...envelope,bibliographyLibraries:[{...library,source:'@article{broken,title='}]});
 s.setItem(api.documentStorageKey,corrupt);api.restoreDocumentEnvelope(model());
 assert.equal(s.getItem(api.documentStorageKey+'-recovery'),corrupt);
});

test('labels and citations survive JSON and export as native LaTeX commands',()=>{
 const api=load('plate-document',storage()),latex=load('latex-document',storage());
 const ref=(command,keys)=>({type:'tex_reference',command,keys,children:[{text:''}]});
 const value=[{type:'h1',texLabel:'sec:intro',children:[{text:'Introduction'}]},
 {type:'p',children:[{text:'See '},ref('ref',['sec:intro']),ref('eqref',['eq:x']),ref('cite',['paper'])]},
 {type:'p',children:[{...api.formulaNode(model(),true),texLabel:'eq:x'}]},
 {type:'bibliography_entry',citeKey:'paper',children:[{text:'Author & Title, 2026.'}]}];
 const restored=api.parseDocumentFile(JSON.stringify({version:1,value}));
 assert.equal(JSON.stringify(restored),JSON.stringify(value));
 const tex=latex.latexDocument(restored);
 for(const command of ['\\label{sec:intro}','\\label{eq:x}','\\ref{sec:intro}','\\eqref{eq:x}','\\cite{paper}','\\bibitem{paper}'])assert.ok(tex.includes(command),command);
 assert.match(tex,/\\begin\{thebibliography\}\{1\}/);assert.match(tex,/Author \\& Title/);
 assert.match(tex,/\\usepackage\[hidelinks\]\{hyperref\}/);
 value[0].texLabel='unsafe}';assert.throws(()=>api.parseDocumentFile(JSON.stringify({version:1,value})));
});

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

test('new browser documents ignore copied opener drafts and all legacy migrations',()=>{
 const s=storage(),primaryKey='math-plate-document-v1';
 const main=JSON.stringify({version:1,value:[{type:'p',children:[{text:'Keep the original document'}]}]});
 const legacyKeys=[primaryKey,'math-tiptap-document-v1','math-text-flow-state'];
 const originals=[main,'old Tiptap draft bytes','old flow draft bytes'];
 legacyKeys.forEach((key,index)=>s.setItem(key,originals[index]));
 const reads=[],tracked={...s,getItem:key=>{reads.push(key);return s.getItem(key);}};
 const first=load('plate-document',tracked,undefined,'11111111-1111-4111-8111-111111111111');
 const second=load('plate-document',tracked,undefined,'22222222-2222-4222-8222-222222222222');
 assert.notEqual(first.documentStorageKey,primaryKey);assert.notEqual(first.documentStorageKey,second.documentStorageKey);
 for(const api of [first,second])assert.equal(JSON.stringify(api.restoreDocumentEnvelope(model())),JSON.stringify({version:1,value:[{type:'p',children:[{text:''}]}],bibliographyLibraries:[]}));
 assert.equal(reads.some(key=>legacyKeys.includes(key)),false,'new documents must not even read another document or its migrations');
 const edited=JSON.stringify({version:1,value:[{type:'p',children:[{text:'New tab contents'},first.formulaNode(model())]}],bibliographyLibraries:[]});
 s.setItem(first.documentStorageKey,edited);
 assert.equal(JSON.stringify(load('plate-document',s,undefined,'11111111-1111-4111-8111-111111111111').restoreDocumentEnvelope(model())),edited);
 assert.equal(second.restoreDocument(model())[0].children[0].text,'');
 legacyKeys.forEach((key,index)=>{assert.equal(s.getItem(key),originals[index]);assert.equal(s.getItem(key+'-recovery'),null);});
 assert.equal(load('plate-document',s).restoreDocument(model())[0].children[0].text,'Keep the original document');
});

test('each desktop document restores its own formulas, notes and captured bibliography without changing the primary draft',()=>{
 const persistent=storage(),primaryKey='math-plate-document-v1';
 const original=JSON.stringify({version:1,value:[{type:'p',children:[{text:'Unsaved main window'}]}]});persistent.setItem(primaryKey,original);
 const id='33333333-3333-4333-8333-333333333333',api=load('plate-document',storage(),persistent,id);
 assert.equal(api.restoreDocument(model())[0].children[0].text,'');
 const value=[{type:'p',children:[{text:'Independent '},api.formulaNode(model(),true),{type:'footnoteReference',identifier:'note',children:[{text:''}]},{type:'tex_reference',command:'cite',keys:['paper'],children:[{text:''}]}]},
  {type:'footnoteDefinition',identifier:'note',children:[{type:'p',children:[{text:'A saved note',bold:true}]}]}];
 const bibliographyLibraries=[{id:'papers',name:'Papers.bib',source:'@article{paper,title={Captured cited entry}}'}];
 const saved=JSON.stringify({version:1,value,bibliographyLibraries});persistent.setItem(api.documentStorageKey,saved);
 const reopened=load('plate-document',storage(),persistent,id).restoreDocumentEnvelope(model());
 assert.equal(JSON.stringify(reopened),saved);
 assert.equal(persistent.getItem(primaryKey),original);
 assert.equal(load('plate-document',storage(),persistent).restoreDocument(model())[0].children[0].text,'Unsaved main window');
 const another=load('plate-document',storage(),persistent,'44444444-4444-4444-8444-444444444444');
 assert.equal(another.restoreDocument(model())[0].children[0].text,'');
 assert.equal(persistent.getItem(api.documentStorageKey),saved);
});

test('a corrupt scoped draft is recovered only in its own namespace and falls back to a blank document',()=>{
 const persistent=storage(),primaryKey='math-plate-document-v1';
 const originals={[primaryKey]:'primary bytes','math-tiptap-document-v1':'Tiptap bytes','math-text-flow-state':'flow bytes'};
 for(const [key,value]of Object.entries(originals))persistent.setItem(key,value);
 const api=load('plate-document',storage(),persistent,'55555555-5555-4555-8555-555555555555');
 persistent.setItem(api.documentStorageKey,'corrupt new document');
 const restored=api.restoreDocumentEnvelope(model());
 assert.equal(JSON.stringify(restored),JSON.stringify({version:1,value:[{type:'p',children:[{text:''}]}],bibliographyLibraries:[]}));
 assert.equal(persistent.getItem(api.documentStorageKey),'corrupt new document');
 assert.equal(persistent.getItem(api.documentStorageKey+'-recovery'),'corrupt new document');
 for(const [key,value]of Object.entries(originals)){assert.equal(persistent.getItem(key),value);assert.equal(persistent.getItem(key+'-recovery'),null);}
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

test('inline labels preserve position and follow TeX section counters without numbering paragraphs',()=>{
 const refs=load('references',storage()),doc=load('plate-document',storage());
 const label={type:'tex_label',id:'anchor',texLabel:'loc:proof',children:[{text:''}]};
 const value=[{type:'h1',children:[{text:'Intro'}]},{type:'p',children:[{text:'Before '},label,{text:' after'}]}];
 assert.equal(refs.resolveReference(value,{command:'ref',keys:['loc:proof']}).text,'1');
 assert.equal(refs.resolveReference(value,{command:'eqref',keys:['loc:proof']}).invalid,true);
 assert.match(doc.plateLatex(value),/Before \\label\{loc:proof\} after/);
 assert.equal(JSON.stringify(doc.parseDocumentFile(JSON.stringify({version:1,value}))),JSON.stringify(value));
 assert.equal(refs.resolveReference([value[1]],{command:'ref',keys:['loc:proof']}).invalid,true);
 value.unshift({type:'h1',children:[{text:'Earlier'}]});
 assert.equal(refs.resolveReference(value,{command:'ref',keys:['loc:proof']}).text,'2');
});

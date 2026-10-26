const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');

const source=buildSync({entryPoints:['src/latex-document.ts'],bundle:true,format:'cjs',write:false,platform:'node'}).outputFiles[0].text;
const moduleObject={exports:{}};
new Function('require','module','exports',source)(require,moduleObject,moduleObject.exports);
const {latexDocument}=moduleObject.exports;
const library=(id,source,name=id+'.bib')=>({id,name,source});
const cite=(...keys)=>({type:'tex_reference',command:'cite',keys,children:[{text:''}]});
const paragraph=(...children)=>({type:'p',children});
const manual=(key,children)=>({type:'bibliography_entry',citeKey:key,children});

test('without imported libraries, manual bibliography keeps the legacy LaTeX path',()=>{
  const tex=latexDocument([paragraph(cite('manual')),manual('manual',[{text:'Author & Title.'}])]);
  assert.match(tex,/\\begin\{thebibliography\}\{1\}/);
  assert.match(tex,/\\bibitem\{manual\} Author \\& Title\./);
  assert.doesNotMatch(tex,/biblatex|filecontents|Biber/);
  assert.match(tex,/% Run twice to resolve cross-references and citations\./);
});

test('BibTeX export retains cited raw entries and string macros with generated resource filenames',()=>{
  const entry=String.raw`@article{paper,
  author = {Garc{\'i}a, Ana and 张, 三},
  title = {An {Original} Title},
  journal = venue,
  year = {2026},
  x-custom = {Keep unknown fields},
}`;
  const bib='% Original library context.\r\n'+String.raw`@string{venue = "A Journal"}`+'\n'+entry+'\n@book{uncited,title={UNUSED-LIBRARY-MARKER}}';
  const other='@book{book, title={Book}, author={Doe, Jane}, year={2025}}\n';
  const libraries=[library('one',bib,'../../unsafe}\\input{evil}.bib'),library('two',other)];
  const value=[paragraph({text:'See '},cite('paper','book'))];
  const before=JSON.stringify({value,libraries}),tex=latexDocument(value,libraries);
  assert.ok(tex.includes(entry));assert.ok(tex.includes(other));
  assert.match(tex,/@string\s*\{venue\s*=/i);assert.ok(tex.includes('A Journal'));
  assert.match(tex,/\\begin\{filecontents\*\}\[overwrite\]\{\\jobname-vulgar-bibliography-1\.bib\}/);
  assert.match(tex,/\\begin\{filecontents\*\}\[overwrite\]\{\\jobname-vulgar-bibliography-2\.bib\}/);
  assert.match(tex,/\\usepackage\[backend=biber,style=numeric,sorting=none,defernumbers=true\]\{biblatex\}/);
  assert.match(tex,/\\addbibresource\{\\jobname-vulgar-bibliography-1\.bib\}/);
  assert.match(tex,/\\cite\{paper,book\}/);assert.match(tex,/\\printbibliography/);
  assert.doesNotMatch(tex,/thebibliography|unsafe|evil|UNUSED-LIBRARY-MARKER/);
  assert.match(tex,/% Compile: LuaLaTeX, Biber, LuaLaTeX, LuaLaTeX/);
  assert.equal(JSON.stringify({value,libraries}),before);
});

test('manual bibliography coexists with libraries as rich TeX notes, ordered before cited library entries',()=>{
  const value=[paragraph(cite('imported')),
    manual('manualA',[{text:'Author & 50% '},{text:'bold',bold:true},{type:'inline_equation',texExpression:'x^2',children:[{text:''}]}]),
    manual('manualB',[{text:'Uncited manual entry'}])];
  const tex=latexDocument(value,[library('one','@book{imported,title={Imported}}\n@book{unused,title={Unused}}')]);
  assert.match(tex,/@misc\{manualA,[\s\S]*note = \{Author \\& 50\\% \\textbf\{bold\}\\\(x\^2\\\)\}/);
  assert.match(tex,/@misc\{manualB,[\s\S]*Uncited manual entry/);
  assert.ok(tex.indexOf('\\nocite{manualA,manualB}')>tex.indexOf('\\begin{document}'));
  assert.ok(tex.indexOf('\\nocite{manualA,manualB}')<tex.indexOf('\\cite{imported}'));
  assert.doesNotMatch(tex,/thebibliography|\\nocite\{\*\}|\\nocite\{unused\}/);
  assert.match(tex,/vulgar-bibliography-2\.bib/);
});

test('missing citation targets remain native unresolved citations instead of crashing the export',()=>{
  const tex=latexDocument([paragraph(cite('missing'))],[library('one','@article{existing,title={Existing}}')]);
  assert.match(tex,/\\cite\{missing\}/);
  assert.doesNotMatch(tex,/biblatex|Biber|filecontents/);
});

test('uncited dependencies supply data without entering the printed bibliography or consuming numbers',()=>{
  const parent='@proceedings{parent,title={Shared proceedings},year={2026}}';
  const childA='@inproceedings{childA,title={A},crossref={parent}}';
  const childB='@inproceedings{childB,title={B},crossref={parent}}';
  const libraries=[library('one',[parent,childA,childB,'@book{unused,title={UNUSED-LIBRARY-MARKER}}'].join('\n'))];
  const tex=latexDocument([paragraph(cite('childB','childA'))],libraries);
  for(const raw of [parent,childA,childB])assert.ok(tex.includes(raw));
  assert.match(tex,/defernumbers=true/);
  assert.match(tex,/\\addtocategory\{vulgarCited\}\{childB,childA\}/);
  assert.match(tex,/\\printbibliography\[category=vulgarCited\]/);
  assert.doesNotMatch(tex,/UNUSED-LIBRARY-MARKER|\\nocite\{parent\}/);
});

test('libraries with no citations do not leak their entries into standalone TeX',()=>{
  const value=[paragraph({text:'No citations.'}),manual('manual',[{text:'Keep the manual bibliography.'}])];
  const tex=latexDocument(value,[library('one','@book{unused,title={UNUSED-LIBRARY-MARKER}}')]);
  assert.doesNotMatch(tex,/UNUSED-LIBRARY-MARKER|filecontents|addbibresource|biblatex|Biber/);
  assert.equal(tex,latexDocument(value));
});

test('conflicting citation keys fail clearly without silently dropping references',()=>{
  const libs=[library('one','@article{same,title={Library}}')];
  assert.throws(()=>latexDocument([manual('same',[{text:'Manual'}])],libs),/Duplicate citation key/);
  assert.throws(()=>latexDocument([manual('a',[{text:'A'}]),manual('a',[{text:'B'}])],libs),/Duplicate citation key/);
});

test('filecontents terminators inside imported sources fail clearly rather than truncating the library',()=>{
  for(const command of ['\\end{filecontents*}','\\end{filecontents}']){
    const source='@article{paper,title={Example},note={'+command+'}}\n';
    assert.throws(()=>latexDocument([paragraph(cite('paper'))],[library('one',source)]),/filecontents terminator/);
  }
});

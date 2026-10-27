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
const noteRef=identifier=>({type:'footnoteReference',identifier,children:[{text:''}]});
const note=(identifier,...children)=>({type:'footnoteDefinition',identifier,children});

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

test('Unicode apostrophes in citation keys and September abbreviations survive standalone TeX export',()=>{
  const key='O’Example2025';
  const raw='@article{'+key+',author={Example, Alex},title={Synthetic example},journal={Example Journal},year={2025},month=sept}';
  const libraries=[library('unicode-key',raw)],value=[paragraph({text:'See '},cite(key))];
  const before=JSON.stringify({value,libraries}),tex=latexDocument(value,libraries);
  assert.ok(tex.includes(raw));
  assert.ok(tex.includes('\\cite{'+key+'}'));
  assert.ok(tex.includes('\\addtocategory{vulgarCited}{'+key+'}'));
  assert.match(tex,/@string\s*\{SEPT=\{09\}\}/);
  assert.doesNotMatch(tex,/@article\{O,/);
  assert.equal(JSON.stringify({value,libraries}),before);
});

test('manual bibliography coexists with libraries in first-reference order, with uncited manual entries retained',()=>{
  const value=[paragraph(cite('imported')),
    manual('manualA',[{text:'Author & 50% '},{text:'bold',bold:true},{type:'inline_equation',texExpression:'x^2',children:[{text:''}]}]),
    manual('manualB',[{text:'Uncited manual entry'}])];
  const tex=latexDocument(value,[library('one','@book{imported,title={Imported}}\n@book{unused,title={Unused}}')]);
  assert.match(tex,/@misc\{manualA,[\s\S]*note = \{Author \\& 50\\% \\textbf\{bold\}\\\(x\^2\\\)\}/);
  assert.match(tex,/@misc\{manualB,[\s\S]*Uncited manual entry/);
  assert.ok(tex.indexOf('\\nocite{imported,manualA,manualB}')>tex.indexOf('\\begin{document}'));
  assert.ok(tex.indexOf('\\nocite{imported,manualA,manualB}')<tex.indexOf('\\cite{imported}'));
  assert.doesNotMatch(tex,/thebibliography|\\nocite\{\*\}|\\nocite\{unused\}/);
  assert.equal((tex.match(/\\printbibliography\b/g)||[]).length,1,'manual and imported entries share one TeX bibliography');
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
  assert.match(tex,/\\printbibliography\[category=vulgarCited,title=\{Notes and references\}\]/);
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

test('endnotes and manual references become one native bibliography without BibTeX',()=>{
  const value=[paragraph({text:'A note '},noteRef('n1'),{text:' and source '},cite('manual'),{text:' then repeat '},noteRef('n1')),
    note('n1',paragraph({text:'Rich note ',bold:true},{type:'inline_equation',texExpression:'x^2',children:[{text:''}]})),
    manual('manual',[{text:'Manual source.'}]),note('orphan',paragraph({text:'Retained orphan note.'}))];
  const before=JSON.stringify(value),tex=latexDocument(value),keys=[...tex.matchAll(/\\bibitem\{([^}]+)\}/g)].map(match=>match[1]);
  assert.equal(keys.length,3);assert.ok(keys[0].startsWith('vulgar-note-'));assert.equal(keys[1],'manual');
  assert.equal((tex.match(new RegExp('\\\\cite\\{'+keys[0]+'\\}','g'))||[]).length,2);
  assert.match(tex,/\\textbf\{Rich note \}\\\(x\^2\\\)/);
  assert.match(tex,/\\renewcommand\{\\refname\}\{Notes and references\}/);
  assert.equal((tex.match(/\\begin\{thebibliography\}/g)||[]).length,1);
  assert.doesNotMatch(tex,/biblatex|\\footnote|\\printendnotes/);
  assert.equal(JSON.stringify(value),before);
});

test('interleaved endnotes, nested citations and library references use one shared BibLaTeX sequence',()=>{
  const value=[paragraph(noteRef('n1'),{text:' then '},cite('second'),{text:' and repeat '},noteRef('n1')),
    note('n1',paragraph({text:'A note with ',bold:true},{type:'inline_equation',texExpression:'E=mc^2',children:[{text:''}]},{text:' and '},cite('first'))),
    manual('manual',[{text:'Uncited source.'}])];
  const libraries=[library('refs','@book{first,title={First}}\n@book{second,title={Second}}\n@book{unused,title={UNUSED_ENTRY_MARKER}}')];
  const tex=latexDocument(value,libraries),key=tex.match(/@misc\{(vulgar-note-[^,]+),/)[1];
  assert.ok(tex.includes('\\nocite{'+key+',first,second,manual}'));
  assert.equal((tex.match(/\\printbibliography\b/g)||[]).length,1);
  assert.match(tex,/\\textbf\{A note with \}\\\(E=mc\^2\\\)/);
  assert.doesNotMatch(tex,/\\begin\{thebibliography\}|\\footnote|\\printendnotes|UNUSED_ENTRY_MARKER/);
});

test('generated endnote keys are stable and avoid actual bibliography key collisions',()=>{
  const colliding='vulgar-note-6e-31',libraries=[library('refs','@book{'+colliding+',title={Existing library key}}')];
  const definition=note('n1',paragraph({text:'Note content.'}));
  const first=latexDocument([paragraph(cite(colliding),noteRef('n1')),definition],libraries);
  const reordered=latexDocument([paragraph(noteRef('n1'),cite(colliding)),definition],libraries);
  const key=first.match(/@misc\{(vulgar-note-[^,]+),/)[1];
  assert.equal(key,colliding+'-1');assert.ok(reordered.includes('@misc{'+key+','));
  assert.ok(first.includes('@book{'+colliding+','));assert.ok(first.includes('\\cite{'+colliding+'}'));
});

test('selected CSL reference formats export their exact entry bodies without a second formatter',()=>{
  const libraries=[library('refs','@article{paper,author={Doe, Jane and Smith, Alex},title={A Test of Methods},journal={Example Journal},year={2025},volume={12},number={3},pages={10--18},doi={10.1000/example}}')];
  const value=[paragraph(cite('paper'))],before=JSON.stringify({value,libraries});
  const expected={
    ieee:String.raw`J. Doe and A. Smith, “A Test of Methods,” \textit{Example Journal}, vol. 12, no. 3, pp. 10–18, 2025, doi: 10.1000/example.`,
    vancouver:'Doe J, Smith A. A Test of Methods. Example Journal. 2025;12(3):10–8. doi:10.1000/example',
    acs:String.raw`Doe, J.; Smith, A. A Test of Methods. \textit{Example Journal} \textbf{2025}, \textit{12} (3), 10–18. https://doi.org/10.1000/example`,
    aip:String.raw`J. Doe, and A. Smith, “A Test of Methods,” Example Journal \textbf{12}(3), 10–18 (2025).`,
    apa:String.raw`Doe, J., \& Smith, A. (2025). A Test of Methods. \textit{Example Journal}, \textit{12}(3), 10–18. https://doi.org/10.1000/example`,
    chicago:String.raw`Doe, Jane, and Alex Smith. “A Test of Methods.” \textit{Example Journal} 12, no. 3 (2025): 10–18. https://doi.org/10.1000/example.`,
    'gbt7714-2025':'Doe J，Smith A. A Test of Methods[J/OL]. Example Journal，2025，12（3）：10-18. DOI:10.1000/example.',
  };
  for(const [style,body] of Object.entries(expected)){
    const tex=latexDocument(value,libraries,style);
    assert.ok(tex.includes('\\bibitem{paper} '+body+'\n'),style+' keeps its CSL body and text marks');
    assert.match(tex,/\\begin\{thebibliography\}\{1\}/);
    assert.match(tex,/\\cite\{paper\}/);
    assert.doesNotMatch(tex,/biblatex|filecontents|Biber|\\printbibliography/);
    assert.match(tex,/% Run twice to resolve cross-references and citations\./);
  }
  assert.equal(latexDocument(value,libraries,'simple'),latexDocument(value,libraries),'the default BibLaTeX path stays unchanged');
  assert.equal(JSON.stringify({value,libraries}),before);
});

test('CSL TeX bodies escape special characters instead of interpreting metadata as TeX',()=>{
  const source=String.raw`@article{safe,title={A \& B: 50\% of \{data\} \#1 \_file\_ \textbackslash{}end\{document\}},author={Doe, Jane},journal={Journal},year={2025}}`;
  const tex=latexDocument([paragraph(cite('safe'))],[library('refs',source)],'apa');
  assert.ok(tex.includes(String.raw`A \& B: 50\% of \{data\} \#1 \_file\_ \textbackslash{}end\{document\}`));
  assert.equal((tex.match(/\\end\{document\}/g)||[]).length,1);
  assert.doesNotMatch(tex,/<i>|<\/i>|<span|@article/);
});

test('selected formats preserve shared note and citation order, nested citations, and rich note math',()=>{
  const value=[paragraph(noteRef('n1'),{text:' then '},cite('second'),{text:' and repeat '},noteRef('n1'),{text:' unresolved '},cite('missing')),
    note('n1',paragraph({text:'A rich note ',bold:true},{type:'inline_equation',texExpression:'E=mc^2',children:[{text:''}]},{text:' cites '},cite('first'))),
    manual('manual',[{text:'Manual & source.',italic:true}]),note('orphan',paragraph({text:'Retained note.'}))];
  const libraries=[library('refs','@book{first,title={First},author={Zulu, Zed},year={2024}}\n@book{second,title={Second},author={Alpha, Amy},year={2025}}\n@book{unused,title={UNUSED_ENTRY_MARKER}}')];
  const before=JSON.stringify({value,libraries}),tex=latexDocument(value,libraries,'apa');
  const keys=[...tex.matchAll(/\\bibitem\{([^}]+)\}/g)].map(match=>match[1]);
  assert.equal(keys.length,5);assert.ok(keys[0].startsWith('vulgar-note-'));
  assert.deepEqual(keys.slice(1,4),['first','second','manual'],'APA alphabetical ordering must not change shared document numbering');
  assert.ok(keys[4].startsWith('vulgar-note-'));
  assert.equal((tex.match(new RegExp('\\\\cite\\{'+keys[0]+'\\}','g'))||[]).length,2);
  assert.match(tex,/\\textbf\{A rich note \}\\\(E=mc\^2\\\) cites \\cite\{first\}/);
  assert.match(tex,/\\emph\{Manual \\& source\.\}/);
  assert.match(tex,/\\cite\{missing\}/);
  assert.equal((tex.match(/\\begin\{thebibliography\}/g)||[]).length,1);
  assert.doesNotMatch(tex,/biblatex|Biber|\\footnote|\\printendnotes|UNUSED_ENTRY_MARKER/);
  assert.equal(JSON.stringify({value,libraries}),before);
});

test('selected formats omit unused dependencies and keep author names when CSL entries are reordered',()=>{
  const libraries=[library('refs','@proceedings{parent,title={Shared proceedings},year={2026}}\n@inproceedings{later,title={Z result},author={Doe, Jane},crossref={parent}}\n@inproceedings{earlier,title={A result},author={Doe, Jane},crossref={parent}}')];
  const tex=latexDocument([paragraph(cite('later','earlier'))],libraries,'chicago');
  const lines=[...tex.matchAll(/\\bibitem\{([^}]+)\} ([^\n]*)/g)];
  assert.deepEqual(lines.map(line=>line[1]),['later','earlier']);
  assert.ok(lines.every(line=>line[2].startsWith('Doe, Jane.')),'each entry retains a complete author instead of a sorting-dependent em dash');
  assert.doesNotMatch(tex,/\\bibitem\{parent\}|@proceedings|filecontents|biblatex/);
});

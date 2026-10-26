const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const {spawnSync}=require('node:child_process');

const bundled=buildSync({entryPoints:['src/bibtex.ts'],bundle:true,write:false,platform:'browser',format:'cjs',target:'es2022'}).outputFiles[0].text;
const compiled={exports:{}};
new Function('module','exports',bundled)(compiled,compiled.exports);
const {parseBibLibrary,parseBibLibraries,validateBibLibraries,validCitationKey,citedBibLibraries,bibLibraryWarnings}=compiled.exports;
const library=(source,id='main',name='references.bib')=>({id,name,source});

test('BibTeX names, TeX accents, braced titles, strings and concatenation become plain searchable text',()=>{
 const input=library(String.raw`@string{journal={Journal of Things}}
@comment{not an entry}
@preamble{"A preamble"}
@article{Godel:1931/a+b,
 title={On {NASA} and \textbf{G\"odel}},
 author={G\"odel, Kurt and {AT\&T Research} and Ludwig van Beethoven},
 year={1931},journal=journal # " Supplement", doi={10.1/example},url={https://example.test/paper}
}`);
 const [entry]=parseBibLibrary(input);
 assert.equal(entry.key,'Godel:1931/a+b');assert.equal(entry.type,'article');
 assert.equal(entry.title,'On NASA and Gödel');
 assert.equal(entry.author,'Kurt Gödel; AT&T Research; Ludwig van Beethoven');
 assert.equal(entry.year,'1931');assert.match(entry.description,/Journal of Things Supplement/);
 assert.equal(entry.libraryId,'main');assert.equal(entry.libraryName,'references.bib');
 assert.equal(entry.doi,'10.1/example');assert.equal(entry.url,'https://example.test/paper');
 assert.doesNotMatch(entry.description,/<\/?(?:b|span|i)\b/);
 assert.equal(input.source.includes(String.raw`G\"odel`),true,'the original raw source stays unchanged');
});

test('crossref inheritance supplies parent year and book title while child content takes precedence',()=>{
 const entries=parseBibLibrary(library(String.raw`@proceedings{parent,title={Collected Work},year=2020,editor={Doe, Jane}}
@inproceedings{child,title={A Chapter},crossref={parent},author={Roe, Richard}}`));
 const child=entries.find(entry=>entry.key==='child');
 assert.equal(child.title,'A Chapter');assert.equal(child.author,'Richard Roe');assert.equal(child.year,'2020');
 assert.match(child.description,/Collected Work/);
});

test('Unicode and conventional citation keys are accepted without accepting TeX syntax',()=>{
 for(const key of ['knuth1984','2024-α','张三:2025/a+b','Évariste.1','a_b','e\u0301tude',"D'Example2024",'D’Example2024'])assert.equal(validCitationKey(key),true,key);
 for(const key of ['',null,7,' key','bad,key','bad{key}','bad\\key','_bad','<script>'])assert.equal(validCitationKey(key),false,String(key));
 assert.equal(parseBibLibrary(library('@book{张三:2025,title={中文},year={2025}}'))[0].key,'张三:2025');
});

test('invalid syntax is rejected atomically rather than silently dropping damaged entries',()=>{
 for(const source of [
  '@article{valid,title={Valid}}\n@article{broken,title={Unclosed}',
  '@article{broken,title="Unclosed}',
  '@article{bad\\key,title={No}}',
 ])assert.throws(()=>parseBibLibrary(library(source)),/BibTeX|citation key/i,source);
});

test('September exporter aliases and apostrophe keys preserve complete original entries and prose',()=>{
 const input=library(String.raw`@proceedings{D’Example2024,
 title={The author’s “complete” work},author={D’Example, Jane},year=2024,month=Sept
}
@inproceedings{O'Example2025,title={Another author’s work with ʼ and ʻ already present},crossref={D’Example2024},month=sept,customfield={Don’t rewrite me}}`,'apostrophes');
 const original=input.source,entries=parseBibLibrary(input);
 assert.deepEqual(entries.map(entry=>entry.key),['D’Example2024',"O'Example2025"]);
 assert.equal(entries[0].title,'The author’s “complete” work');assert.equal(entries[0].author,'Jane D’Example');
 assert.equal(entries[1].year,'2024');assert.match(entries[1].description,/The author’s “complete” work/);
 assert.match(entries[1].title,/author’s work with ʼ and ʻ already present/);
 assert.deepEqual(bibLibraryWarnings(input),[]);
 const [snapshot]=citedBibLibraries([input],["O'Example2025"]);
 assert.match(snapshot.source,/@string\{SEPT=\{09\}\}/);
 assert.match(snapshot.source,/crossref=\{D’Example2024\}/);
 assert.match(snapshot.source,/customfield=\{Don’t rewrite me\}/);
 for(const rawEntry of original.split(/(?=^@)/m).filter(Boolean))assert.ok(snapshot.source.includes(rawEntry.trim()),'raw entry inputs and their punctuation must remain exact');
 assert.deepEqual(parseBibLibrary(snapshot).map(entry=>entry.key),entries.map(entry=>entry.key));
 assert.equal(input.source,original);
});

test('unresolved abbreviations are nonblocking cached warnings without invented definitions',()=>{
 const input=library('@article{unresolved,title={Valid title},journal=customJournal,year=2024}','unresolved');
 const [entry]=parseBibLibrary(input);
 assert.equal(entry.key,'unresolved');assert.match(entry.description,/customJournal/);
 const warnings=bibLibraryWarnings(input);
 assert.match(warnings[0],/unresolved @string reference "customJournal"/);
 assert.equal(bibLibraryWarnings({...input}),warnings);
 const [snapshot]=citedBibLibraries([input],['unresolved']);
 assert.match(snapshot.source,/journal=customJournal/);
 assert.doesNotMatch(snapshot.source,/@string\{CUSTOMJOURNAL/i);
 assert.equal(parseBibLibrary(snapshot)[0].key,'unresolved');
});

test('unterminated constructs return promptly in an isolated process',()=>{
 const source=`const m={exports:{}};new Function('module','exports',${JSON.stringify(bundled)})(m,m.exports);`
  +`for(const input of ['@article{x,title={bad}','@article{x,title={bad','@article{x,title="bad','@string{x={bad}']){`
  +`let rejected=false;try{m.exports.parseBibLibrary({id:'bad',name:'bad.bib',source:input});}catch{rejected=true;}if(!rejected)process.exit(2);}`;
 const child=spawnSync(process.execPath,[],{input:source,encoding:'utf8',timeout:5000,maxBuffer:1024*1024});
 assert.ifError(child.error);assert.equal(child.status,0,child.stderr||child.stdout);
});

test('duplicate keys and library identities are rejected within and across libraries',()=>{
 assert.throws(()=>parseBibLibrary(library('@book{same,title={One}}\n@book{same,title={Two}}')),/Duplicate citation key/);
 assert.throws(()=>parseBibLibraries([library('@book{same,title={One}}','one'),library('@book{same,title={Two}}','two')]),/Duplicate citation key/);
 assert.throws(()=>validateBibLibraries([library('@book{one,title={One}}'),library('@book{two,title={Two}}')]),/Duplicate BibTeX library id/);
});

test('persisted library validation preserves exact source and rejects malformed envelopes',()=>{
 const raw='\ufeff% Original comments\r\n@book{one, title={One}}\r\n';
 assert.deepEqual(validateBibLibraries(undefined),[]);
 assert.deepEqual(validateBibLibraries([library(raw)]),[library(raw)]);
 for(const value of [null,{},'bad',[null],[{id:'x',name:'x'}],[library('', '','empty.bib')],[{id:'x',name:'x',source:4}]])assert.throws(()=>validateBibLibraries(value),/Invalid BibTeX/);
});

test('unknown TeX commands remain literal display text and markup is never returned as formatting',()=>{
 const [entry]=parseBibLibrary(library(String.raw`@misc{safe,title={\emph{Title} \mystery{word} \href{javascript:alert(1)}{link}},author={{\textbf{Research Team}}}}`));
 assert.match(entry.title,/Title/);assert.match(entry.title,/mystery/);assert.match(entry.title,/link/);
 assert.doesNotMatch(entry.title,/<(?:a|i|b|span)\b/);assert.equal(entry.author,'Research Team');
});

test('unchanged sources and stable library lists reuse cached parsed entries',()=>{
 const input=library('@book{cached,title={Cached}}','cache');
 const parsed=parseBibLibrary(input);
 assert.equal(parseBibLibrary({...input}),parsed);
 const libraries=[input],all=parseBibLibraries(libraries);
 assert.equal(parseBibLibraries(libraries),all);
 assert.equal(parseBibLibraries([{...input}]),all,'equivalent restored snapshots reuse the aggregate cache');
 const changed={...input,source:'@book{cached,title={Updated}}'};
 assert.equal(parseBibLibrary(changed)[0].title,'Updated');
 assert.equal(parseBibLibrary(input),parsed,'a second source variant must not evict the attached source');
 libraries[0]=changed;
 assert.notEqual(parseBibLibraries(libraries),all,'mutating an array cannot return stale data');
});

test('crossref display inheritance sees parents attached in another library and survives a cited snapshot',()=>{
 const libraries=[
  library('@proceedings{shared,title={Conference},year=2025,editor={Doe, Jane}}','shared','shared.bib'),
  library('@inproceedings{chapter,title={Chapter},crossref={shared}}','chapter','chapter.bib'),
 ];
 const entries=parseBibLibraries(libraries),chapter=entries.find(entry=>entry.key==='chapter');
 assert.equal(chapter.year,'2025');assert.match(chapter.description,/Conference/);
 const snapshot=citedBibLibraries(libraries,['chapter']);
 assert.equal(parseBibLibraries(snapshot).find(entry=>entry.key==='chapter').description,chapter.description);
 assert.equal(parseBibLibraries(libraries),entries);
});

test('cited snapshots retain raw cited fields, required string macros and crossref parents only',()=>{
 const input=library(String.raw`% Source header
@string{venue={Journal of Things}}
@string{unused={UNCITED_STRING_HUGE_MARKER}}
@preamble{"\newcommand{\myword}{Example}"}
@proceedings{parent,title={Parent Collection},year=2024}
@inproceedings{selected,title={A \textbf{Raw} Title},booktitle=venue,crossref={parent},customfield={Keep Me}}
@article{unused,title={UNCITED_ENTRY_HUGE_MARKER}}`,'source','source.bib');
 const original=input.source,libraries=[input];
 const snapshot=citedBibLibraries(libraries,['selected','missing']);
 assert.equal(snapshot.length,1);assert.equal(snapshot[0].id,'source');assert.equal(snapshot[0].name,'source.bib');
 assert.match(snapshot[0].source,/@string\{VENUE=/);assert.match(snapshot[0].source,/@preamble\{/);
 assert.match(snapshot[0].source,/@proceedings\{parent/);assert.match(snapshot[0].source,/@inproceedings\{selected/);
 assert.match(snapshot[0].source,/customfield=\{Keep Me\}/);assert.match(snapshot[0].source,/\\textbf\{Raw\}/);
 assert.doesNotMatch(snapshot[0].source,/UNCITED_(?:ENTRY|STRING)_HUGE_MARKER/);
 assert.equal(input.source,original);assert.equal(libraries[0],input);
 assert.equal(parseBibLibraries(snapshot).find(entry=>entry.key==='selected').year,'2024');
 assert.equal(citedBibLibraries(libraries,['missing','selected','selected']),snapshot,'key set order must not defeat extraction caching');
});

test('snapshot dependencies can cross libraries, include xdata recursively and stop cycles',()=>{
 const libraries=[
  library('@book{unused,title={UNCITED_LIBRARY_MARKER}}','unused','unused.bib'),
  library('@xdata{shared,publisher={Publisher},xdata={cycle}}\n@xdata{cycle,xdata={shared}}','parents','parents.bib'),
  library('@book{selected,title={Book},xdata={shared}}','selected','selected.bib'),
 ];
 const selected=citedBibLibraries(libraries,['selected']);
 assert.deepEqual(selected.map(item=>item.id),['parents','selected']);
 assert.match(selected[0].source,/@xdata\{shared/);assert.match(selected[0].source,/@xdata\{cycle/);
 assert.doesNotMatch(JSON.stringify(selected),/UNCITED_LIBRARY_MARKER/);
 assert.deepEqual(citedBibLibraries(libraries,['missing']),[]);
});

test('braced macro names are not dependencies and nested @string values retain their TeX',()=>{
 const input=library(String.raw`@string{unused={LARGE_UNUSED_MACRO}}
@string{base={G\"odel}}
@string{venue=base # " Journal"}
@article{selected,title={unused},journal=venue}`,'strings');
 const [snapshot]=citedBibLibraries([input],['selected']);
 assert.doesNotMatch(snapshot.source,/LARGE_UNUSED_MACRO/);
 assert.match(snapshot.source,/\\"odel/);
 assert.equal(parseBibLibrary(snapshot)[0].description,'unused. Gödel Journal');
});

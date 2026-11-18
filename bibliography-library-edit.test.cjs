const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const compiled={exports:{}};
const source=buildSync({stdin:{contents:"export {createLibraryEditSession} from './src/bibliography-library-edit';export {BibliographyStore,MemoryBackend,toBibtex} from './src/generated/bib-library';export {bibLibrarySourceEntries,parseBibLibrary} from './src/bibtex';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,target:'es2022'}).outputFiles[0].text;
// The real generated module defines its element class on import. These tests
// exercise its in-memory store/serializer without registering or mounting UI.
new Function('require','module','exports','HTMLElement',source)(require,compiled,compiled.exports,class {});
const {createLibraryEditSession,BibliographyStore,MemoryBackend,toBibtex,bibLibrarySourceEntries,parseBibLibrary}=compiled.exports;

const ORIGINAL=String.raw`% Keep this introductory comment, including @article{not-a-record}.
@comment{A separate preserved comment}
@string{journalName = {The Computer Journal}}
@preamble{"\providecommand{\word}{Example}"}

@article{alpha,
  author = {G{\"o}del, Kurt and de la Cruz, Mar{\'i}a},
  title = {An {Original} Title},
  journal = journalName,
  year = 2026,
  keywords = {classic, computing},
  customfield = {Keep {nested braces} and \alpha},
  file = {C:/private/untouched.pdf}
}

% This record must remain byte-identical when another record changes.
@book{beta,
 title={Second title},
 author={Writer, Other},
 year={2020},
 annotation={Untouched custom annotation}
}
% trailing comment
`;

async function fixture(text=ORIGINAL){
 const library={id:'library',name:'Papers.bib',source:text},session=createLibraryEditSession(library,toBibtex);
 const store=new BibliographyStore({backend:new MemoryBackend()});await store.ready();
 const imported=await store.importItems(session.initialItems);
 assert.deepEqual(imported.errors,[]);assert.equal(imported.added.length,session.initialItems.length);
 const save=()=>session.serialize(store.items());
 const records=saved=>bibLibrarySourceEntries({...library,source:saved});
 return {library,session,store,save,records};
}

test('saving an untouched real library preserves every source byte and imports keyword tags',async()=>{
 const f=await fixture();
 assert.deepEqual(f.store.get('alpha').tags,['classic','computing']);
 assert.equal(f.save(),ORIGINAL);
 assert.equal(f.save(),ORIGINAL,'repeated saves must not accumulate formatting changes');
});

test('editing one title preserves comments, declarations, unknown fields, raw TeX names and other records',async()=>{
 const f=await fixture(),before=f.records(ORIGINAL),item=f.store.get('alpha');
 await f.store.update('alpha',{csl:{...item.csl,title:'A revised title'}});
 const saved=f.save(),after=f.records(saved),edited=after.find(entry=>entry.key==='alpha');
 assert.equal(edited.fields.title,'A revised title');
 assert.equal(after.find(entry=>entry.key==='beta').input,before.find(entry=>entry.key==='beta').input);
 for(const field of ['author','journal','year','keywords','customfield','file'])assert.equal(edited.fields[field],before.find(entry=>entry.key==='alpha').fields[field],field+' source value retained');
 assert.ok(saved.includes(String.raw`author = {G{\"o}del, Kurt and de la Cruz, Mar{\'i}a}`));
  assert.ok(saved.includes('journal = journalName,'),'an unchanged macro reference remains a macro reference');
 assert.ok(saved.includes('@string{journalName = {The Computer Journal}}'));
 assert.ok(saved.includes(String.raw`@preamble{"\providecommand{\word}{Example}"}`));
 assert.ok(saved.includes('@comment{A separate preserved comment}'));
 assert.ok(saved.startsWith(ORIGINAL.slice(0,ORIGINAL.indexOf('@article{alpha'))));
 assert.ok(saved.endsWith('% trailing comment\n'));
});

test('editing or deleting imported tags updates only keywords and never resurrects its old value',async()=>{
 const f=await fixture();
 await f.store.update('alpha',{tags:['revised','science']});
 let saved=f.save(),entry=f.records(saved).find(item=>item.key==='alpha');
 assert.equal(entry.fields.keywords,'revised, science');
 assert.ok(saved.includes('customfield = {Keep {nested braces} and \\alpha}'));
 await f.store.update('alpha',{tags:[]});
 saved=f.save();entry=f.records(saved).find(item=>item.key==='alpha');
 assert.equal(entry.fields.keywords,undefined);
 const reopened=await fixture(saved);assert.deepEqual(reopened.store.get('alpha').tags,[]);
 assert.equal(reopened.save(),saved);
});

test('renaming a key preserves original fields and updates crossref and xdata within the source library',async()=>{
 const text=String.raw`@string{press={A Press}}
@proceedings{parent,title={Parent title},publisher=press,customfield={Keep \alpha}}
@xdata{shared,publisher={Shared press},customfield={Shared custom}}
@xdata{second,location={Place}}
@inproceedings{child,title={Child title},crossref={parent},xdata={shared, second},customfield={Child custom}}
`;
 const f=await fixture(text),before=f.records(text);
 await f.store.renameKey('parent',"文献/2026+O'Neil");
 await f.store.renameKey('shared','shared-renamed');
 const saved=f.save(),records=f.records(saved),parent=records.find(entry=>entry.key==="文献/2026+O'Neil"),child=records.find(entry=>entry.key==='child');
 assert.ok(parent);assert.equal(records.some(entry=>entry.key==='parent'),false);
 assert.deepEqual(parent.fields,before.find(entry=>entry.key==='parent').fields);
 assert.equal(parent.type,'proceedings');assert.equal(child.fields.crossref,"文献/2026+O'Neil");assert.equal(child.fields.xdata,'shared-renamed, second');
 assert.equal(child.fields.customfield,'Child custom');assert.equal(records.find(entry=>entry.key==='shared-renamed').type,'xdata');
 assert.equal(records.find(entry=>entry.key==='second').input,before.find(entry=>entry.key==='second').input);
 assert.ok(saved.startsWith('@string{press={A Press}}'));
});

test('adding and removing records preserves declarations and all unchanged original source',async()=>{
 const f=await fixture(),before=f.records(ORIGINAL);
 await f.store.remove('beta');
 await f.store.addItem({id:'new-entry',type:'article-journal',title:'A new paper',author:[{family:'Researcher',given:'A'}],issued:{'date-parts':[[2026]]}},{tags:['new']});
 const saved=f.save(),records=f.records(saved);
 assert.deepEqual(records.map(entry=>entry.key),['alpha','new-entry']);
 // The parser groups trailing comments with the preceding entry; removing
 // beta therefore makes its surviving trailing comment part of alpha.input.
 const beta=before.find(entry=>entry.key==='beta').input,betaRecord=beta.slice(0,beta.indexOf('\n% trailing comment'));
 assert.ok(saved.startsWith(ORIGINAL.replace(betaRecord,'')),'only the deleted record is removed from the original source');
 assert.equal(records[1].fields.title,'A new paper');assert.equal(records[1].fields.keywords,'new');
 assert.ok(saved.includes('@comment{A separate preserved comment}'));assert.ok(saved.includes('% trailing comment'));
 await f.store.clear();const empty=f.save();assert.deepEqual(f.records(empty),[]);assert.ok(empty.includes('@string{journalName = {The Computer Journal}}'));assert.ok(empty.includes('% trailing comment'));
});

test('valid Unicode, slash, plus and apostrophe keys survive real store import and field edits',async()=>{
 const keys=['中文2026','paper/2026','a+b',"O'Example2025",'O’Example2026'];
 const text=keys.map((key,index)=>`@book{${key},title={Title ${index}},customfield={Original ${index}}}`).join('\n')+'\n';
 const f=await fixture(text);
 assert.deepEqual(f.store.items().map(item=>item.id),keys);assert.equal(f.save(),text);
 for(const key of keys)await f.store.update(key,{csl:{...f.store.get(key).csl,title:'Updated '+key}});
 const saved=f.save(),records=f.records(saved);
 assert.deepEqual(records.map(entry=>entry.key),keys);
 for(const [index,record] of records.entries())assert.equal(record.fields.customfield,'Original '+index);
 assert.deepEqual(parseBibLibrary({...f.library,source:saved}).map(entry=>entry.key),keys);
});

test('parenthesized records, quoted values and concatenated macros preserve their source layout',async()=>{
 const text=String.raw`% @book{ignored,title={This is a comment, not a record}}
@string{prefix = "Journal "}
@article(paren-key,
  title = "Quoted {Title}",
  author = {G{\"o}del, Kurt},
  journal = prefix # "Supplement",
  note = "An @article{example} and a comma, inside a quoted value",
  customfield = {A {nested} custom field}
)
% @article{also-ignored,title={Another comment}}
@book{next,title={Unchanged record}}
`;
 const f=await fixture(text),before=f.records(text);
 assert.deepEqual(f.store.items().map(item=>item.id),['paren-key','next']);assert.equal(f.save(),text);
 await f.store.update('paren-key',{csl:{...f.store.get('paren-key').csl,title:'Revised quoted title'}});
 const saved=f.save(),records=f.records(saved);
 assert.equal(records[0].fields.title,'Revised quoted title');
 assert.ok(saved.includes('@article(paren-key,'));assert.ok(saved.includes('journal = prefix # "Supplement",'));
 assert.ok(saved.includes('note = "An @article{example} and a comma, inside a quoted value",'));
 assert.ok(saved.startsWith('% @book{ignored,title={This is a comment, not a record}}'));
 assert.ok(saved.includes('% @article{also-ignored,title={Another comment}}'));
 assert.equal(records[1].input,before[1].input);
});

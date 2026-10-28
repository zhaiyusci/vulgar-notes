const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const bundled=buildSync({entryPoints:['src/document-metadata.ts'],bundle:true,write:false,platform:'node',format:'cjs',target:'es2022'}).outputFiles[0].text;
const compiled={exports:{}};new Function('module','exports',bundled)(compiled,compiled.exports);
const {emptyDocumentMetadata,parseDocumentMetadata,cloneDocumentMetadata,documentMetadataSnapshot,isDocumentMetadataEmpty,metadataLatex,metadataMarkdown,createMetadataBlock,legacyMetadataBlock,migrateDocumentMetadata,createMetadataEntry,validMetadataEntry,metadataIndex,metadataNoteSymbol,normalizeDocumentTitles,metadataOrderedIds,reorderMetadataEntries,normalizeMetadataAuthors,normalizeMetadataLayout}=compiled.exports;
const entry=(role,id,text,attributes={})=>({...createMetadataEntry(role),id,...attributes,children:[{type:'p',children:[{text}]}]});
const entryText=value=>value.children.flatMap(paragraph=>paragraph.children).map(leaf=>leaf.text).join('');

const sample=()=>({title:'A mathematical document',authors:[{name:'Yu Zhai',affiliation:'Research institute',email:'me@example.test'},{name:'王小明',affiliation:'示例大学',email:'wang@example.test'}]});

test('metadata is optional in old documents and empty values produce no title page',()=>{
  assert.deepEqual(parseDocumentMetadata(undefined),{title:'',authors:[]});
  const first=emptyDocumentMetadata(),second=emptyDocumentMetadata();first.authors.push({name:'A',affiliation:'',email:''});
  assert.equal(second.authors.length,0,'documents do not share mutable author arrays');
  assert.equal(isDocumentMetadataEmpty({title:' \n',authors:[{name:'',affiliation:' ',email:''}]}),true);
  assert.deepEqual(metadataLatex(second),{setup:'',body:''});assert.equal(metadataMarkdown(second),'');
});

test('multi-author metadata survives save and parse without being shared with the source',()=>{
  const original=sample(),saved=JSON.stringify(original),parsed=parseDocumentMetadata(JSON.parse(saved)),copy=cloneDocumentMetadata(parsed);
  assert.deepEqual(parsed,original);assert.equal(parsed.authors[1].name,'王小明');
  copy.authors[0].name='Changed';copy.title='Another document';
  assert.equal(parsed.authors[0].name,'Yu Zhai');assert.equal(parsed.title,'A mathematical document');
  const snapshot=documentMetadataSnapshot(original);
  assert.equal(Object.isFrozen(snapshot),true);assert.equal(Object.isFrozen(snapshot.authors),true);assert.equal(Object.isFrozen(snapshot.authors[0]),true);
  original.authors[0].email='other@example.test';assert.equal(snapshot.authors[0].email,'me@example.test');
});

test('invalid saved metadata is rejected rather than coerced or silently dropped',()=>{
  const invalid=[null,false,[],{},'title',{title:'x',authors:null},{title:1,authors:[]},{title:'x',authors:[null]},
    {title:'x',authors:[{name:'A',affiliation:'B'}]},{title:'x',authors:[{name:'A',affiliation:'B',email:2}]},
    {title:'x',authors:[],unexpected:true},{title:'x',authors:[{name:'A',affiliation:'',email:'',unexpected:1}]},
    {title:'unsafe\u0000title',authors:[]},{title:'x',authors:new Array(1)},Object.create({title:'x',authors:[]})];
  for(const value of invalid)assert.throws(()=>parseDocumentMetadata(value),/Invalid document metadata/);
  assert.throws(()=>metadataLatex({title:'x',authors:'bad'}),/Invalid document metadata/);
});

test('LaTeX title and authors use native declarations while escaping every field as text',()=>{
  const metadata={title:String.raw`A & B_% $ # {x} \input{secret} ~ ^`,authors:[
    {name:'A & B',affiliation:'R&D_1',email:'a_b@example.test'},
    {name:'王小明',affiliation:'示例大学\nLaboratory',email:'wang@example.test'},
  ]};
  const result=metadataLatex(metadata);
  assert.equal(result.setup,String.raw`\title{A \& B\_\% \$ \# \{x\} \textbackslash{}input\{secret\} \textasciitilde{} \textasciicircum{}}`+'\n'+
    String.raw`\author{A \& B\\`+'\n'+String.raw`R\&D\_1\\`+'\n'+String.raw`a\_b@example.test\and`+'\n'+String.raw`王小明\\`+'\n'+String.raw`示例大学 Laboratory\\`+'\n'+String.raw`wang@example.test}`+'\n'+String.raw`\date{}`+'\n');
  assert.equal(result.body,'\\maketitle\n');
  assert.equal(metadataLatex({title:'Only a title',authors:[]}).setup,'\\title{Only a title}\n\\author{}\n\\date{}\n');
});

test('Markdown frontmatter keeps title and structured authors without interpreting YAML or markup',()=>{
  const metadata={title:'Title: "quoted"\n---\n<script>x</script>',authors:[{name:'[A](link)',affiliation:'x: y\n---',email:'a+b@example.test'}]};
  const original=JSON.stringify(metadata),result=metadataMarkdown(metadata),lines=result.split('\n');
  assert.equal(lines[0],'---');assert.equal(lines[3],'---');
  assert.equal(JSON.parse(lines[1].slice('title: '.length)),metadata.title);
  assert.deepEqual(JSON.parse(lines[2].slice('authors: '.length)),metadata.authors);
  assert.equal(lines.length,6,'a title cannot insert a frontmatter terminator or an extra body block');
  assert.equal(JSON.stringify(metadata),original,'export leaves metadata unchanged');
});

test('new metadata blocks start with independent title and author entries',()=>{
  const first=createMetadataBlock(),second=createMetadataBlock();
  assert.equal(first.type,'document_metadata');assert.match(first.id,/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
  assert.notEqual(first.id,second.id);assert.deepEqual(first.children.map(node=>node.role),['title','author']);
  assert.deepEqual(first.children[0].children,[{type:'p',children:[{text:''}]}]);
  first.children[0].children[0].children[0].text='Document title';
  assert.equal(second.children[0].children[0].children[0].text,'','separate documents do not share editable children');
  assert.equal('title' in first,false);assert.equal('authors' in first,false);
});

test('free multi-paragraph metadata retains rich text, contribution notes and arbitrary document content',()=>{
  const block=createMetadataBlock();
  block.children=[
    {type:'p',children:[{text:'A free-form title',bold:true}]},
    {type:'p',children:[{text:'Alice '},{text:'and Bob',italic:true}]},
    {type:'p',children:[{text:'Both authors contributed equally.',superscript:true}]},
    {type:'p',children:[{text:'Correspondence: '},{type:'a',url:'mailto:alice@example.test',children:[{text:'alice@example.test'}]}]},
    {type:'p',children:[{text:'Funding and other descriptive details can follow.'}]},
  ];
  const value=[block,{type:'p',children:[{text:'Body remains separate.'}]}],before=JSON.stringify(value);
  const saved=JSON.parse(before),migrated=migrateDocumentMetadata(saved);
  assert.deepEqual(migrated,value);assert.equal(JSON.stringify(value),before);
  assert.notEqual(migrated,saved);assert.equal(migrated[0],saved[0],'migration preserves the existing rich block rather than projecting it into fixed fields');
  assert.deepEqual(Object.keys(migrated[0]).sort(),['children','id','type']);
});

test('legacy title and all author details migrate in order as literal paragraphs without losing data',()=>{
  const metadata={title:'A & B \\title{literal}',authors:[{name:'Alice',affiliation:'Institute A\nLaboratory',email:'alice+tag@example.test'},{name:'王小明',affiliation:'示例大学',email:'wang@example.test'}]};
  const before=JSON.stringify(metadata),block=legacyMetadataBlock(metadata);
  assert.equal(block.type,'document_metadata');
  assert.deepEqual(block.children.map(entryText),[
    metadata.title,'Alice','Institute A\nLaboratory','alice+tag@example.test','王小明','示例大学','wang@example.test',
  ]);
  assert.deepEqual(block.children.map(node=>node.role),['title','author','affiliation','note','author','affiliation','note']);
  assert.equal(block.children[0].children[0].children[0].bold,true);assert.equal(block.children[1].children[0].children[0].bold,true);
  assert.equal(block.children[2].children[0].children[0].bold,undefined,'institution text remains unmarked ordinary text');
  assert.deepEqual(block.children[1].affiliationIds,[block.children[2].id]);assert.deepEqual(block.children[1].noteIds,[block.children[3].id]);
  assert.deepEqual(block.children[4].affiliationIds,[block.children[5].id]);assert.deepEqual(block.children[4].noteIds,[block.children[6].id]);
  assert.equal(JSON.stringify(metadata),before);
  block.children[1].children[0].children[0].text='Edited author';assert.equal(metadata.authors[0].name,'Alice');
});

test('legacy migration prepends details without overwriting existing metadata blocks or body content',()=>{
  const metadata=sample(),existing=createMetadataBlock();existing.children=[{type:'p',children:[{text:'These authors contributed equally.',italic:true}]}];
  const body={type:'p',children:[{text:'Body text',bold:true}]},value=[existing,body];
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
  freeze(value);freeze(metadata);
  const migrated=migrateDocumentMetadata(value,metadata);
  assert.equal(migrated.length,3);assert.equal(migrated[0].type,'document_metadata');assert.equal(entryText(migrated[0].children[0]),metadata.title);
  assert.equal(migrated[1],existing);assert.equal(migrated[2],body);assert.equal(value.length,2);
  assert.equal(entryText(migrated[0].children[0]),metadata.title);assert.equal(migrated[1].children[0].children[0].text,'These authors contributed equally.');
});

test('migrating the same old file is deterministic and never reuses an existing node identity',()=>{
  const metadata=sample(),value=[{type:'p',children:[{text:'Existing body'}]}];
  assert.deepEqual(legacyMetadataBlock(metadata),legacyMetadataBlock(JSON.parse(JSON.stringify(metadata))));
  assert.deepEqual(migrateDocumentMetadata(value,metadata),migrateDocumentMetadata(JSON.parse(JSON.stringify(value)),JSON.parse(JSON.stringify(metadata))),'recomputing a saved baseline produces exactly the same tree');
  const existing=legacyMetadataBlock(metadata),second={...existing,id:existing.id+'-2'},withExisting=[existing,second,...value];
  const migrated=migrateDocumentMetadata(withExisting,metadata);
  assert.equal(migrated[0].id,existing.id+'-3');assert.equal(new Set(migrated.slice(0,3).map(node=>node.id)).size,3);
  assert.deepEqual(migrated,migrateDocumentMetadata(withExisting,metadata),'collision resolution is deterministic too');
  const existingTitle=migrated[1].children.find(node=>node.id===existing.children[0].id),secondTitle=migrated[2].children.find(node=>node.id===second.children[0].id);
  assert.equal(existingTitle.role,'text');assert.equal(secondTitle.role,'text');assert.equal(existingTitle.children,existing.children[0].children);assert.equal(secondTitle.children,second.children[0].children);
  assert.equal(migrated[1].children.find(node=>node.id===existing.children[1].id),existing.children[1]);assert.equal(migrated[2].children.find(node=>node.id===second.children[1].id),second.children[1]);
  const migratedAuthor=migrated[0].children.find(node=>node.role==='author'&&entryText(node)===metadata.authors[0].name),migratedAffiliation=migrated[0].children.find(node=>node.role==='affiliation'&&entryText(node)===metadata.authors[0].affiliation),migratedEmail=migrated[0].children.find(node=>node.role==='note'&&entryText(node)===metadata.authors[0].email);
  assert.notEqual(migratedAuthor.id,existing.children[1].id);
  assert.deepEqual(migratedAuthor.affiliationIds,[migratedAffiliation.id]);assert.deepEqual(migratedAuthor.noteIds,[migratedEmail.id]);
  assert.notEqual(legacyMetadataBlock({...metadata,title:'A different title'}).id,existing.id);
});

test('empty old metadata creates no extra block and malformed old data is still rejected',()=>{
  const value=[{type:'p',children:[{text:'Existing body'}]}];
  assert.equal(legacyMetadataBlock(emptyDocumentMetadata()),undefined);
  assert.deepEqual(migrateDocumentMetadata(value),value);assert.deepEqual(migrateDocumentMetadata(value,emptyDocumentMetadata()),value);
  assert.equal(migrateDocumentMetadata(value,{title:' \n',authors:[{name:'',affiliation:' ',email:''}]}).length,1);
  assert.throws(()=>legacyMetadataBlock({title:'x',authors:null}),/Invalid document metadata/);
  assert.throws(()=>migrateDocumentMetadata(value,{title:'x',authors:[{name:'A'}]}),/Invalid document metadata/);
});

test('semantic entry validation permits unresolved editing references but rejects malformed structure',()=>{
  const author=entry('author','alice','Alice',{affiliationIds:['missing-affiliation'],noteIds:['missing-note']});
  assert.equal(validMetadataEntry(author),true);
  for(const patch of [{role:'unknown'},{id:''},{children:[]},{children:[{text:'not a paragraph'}]},{affiliationIds:['a','a']},{noteIds:['']},{affiliationIds:'a'}])assert.equal(validMetadataEntry({...author,...patch}),false);
  assert.equal(validMetadataEntry({...author,role:'text'}),true,'switching roles preserves dormant association data');
  assert.throws(()=>createMetadataEntry('unknown'),/Invalid metadata entry role/);
});

test('global indexing keeps shared affiliations and notes stable by title then author reference order',()=>{
  const author=entry('author','alice','Alice',{affiliationIds:['lab1','lab2'],noteIds:['equal','contact']}),title=entry('title','title','Title',{noteIds:['funding']});
  const first={type:'document_metadata',id:'block1',children:[author,title,entry('affiliation','lab1','Institute A'),entry('affiliation','lab2','Institute B'),entry('note','contact','Email'),entry('note','equal','Equal contribution'),entry('note','funding','Funding')]};
  const second={type:'document_metadata',id:'block2',children:[entry('title','title2','Another title',{noteIds:['second-note']}),entry('author','bob','Bob',{noteIds:['second-note','equal','missing']}),entry('note','second-note','Second note'),entry('note','empty','   '),entry('affiliation','lab3','Institute C')]};
  const index=metadataIndex([first,second]);
  assert.deepEqual([...index.affiliationNumbers],[['lab1',1],['lab2',2],['lab3',3]]);
  assert.deepEqual([...index.noteNumbers],[['funding',1],['second-note',2],['equal',3],['contact',4]],'titles render before all author notes; cross-block and unknown IDs do not acquire a marker');
  assert.deepEqual([...metadataIndex(first).noteNumbers],[['funding',1],['equal',2],['contact',3]]);
  assert.deepEqual([1,2,3,4,5,6,7,8,9].map(n=>metadataNoteSymbol(n,9)),['*','†','‡','§','¶','‖','**','††','‡‡']);
  assert.deepEqual([1,2,10].map(n=>metadataNoteSymbol(n,10)),['[1]','[2]','[10]']);assert.equal(metadataNoteSymbol(0),'??');
});

test('duplicate identifiers never resolve to the wrong affiliation or note',()=>{
  const block={type:'document_metadata',id:'block',children:[entry('author','a','A',{noteIds:['duplicate']}),entry('note','duplicate','First note'),entry('note','duplicate','Second note')]};
  assert.equal(metadataIndex(block).noteNumbers.size,0);
});

test('title normalization keeps one title across metadata blocks without moving or changing rich content',()=>{
  const first=entry('title','first','First title',{noteIds:['first-note']}),later=entry('title','later','Later title',{noteIds:['later-note'],affiliationIds:['dormant-lab'],custom:'preserved'});
  later.children=[{type:'p',children:[{text:'Later title',bold:true},{text:' with details',italic:true}]},{type:'p',align:'right',children:[{text:'Another line'}]}];
  const initial=[{type:'document_metadata',id:'one',children:[first,entry('note','first-note','First note')]},{type:'p',children:[{text:'Body'}]},
    {type:'column_group',children:[{type:'column',children:[{type:'document_metadata',id:'two',children:[later,entry('title','third','Third title'),entry('note','later-note','Later note')]}]}]}];
  const before=JSON.stringify(initial),freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};freeze(initial);
  const normalized=normalizeDocumentTitles(initial),second=normalized[2].children[0].children[0];
  assert.equal(normalized[0],initial[0]);assert.equal(normalized[1],initial[1]);assert.equal(second.children[0].role,'text');assert.equal(second.children[1].role,'text');
  assert.equal(second.children[0].id,later.id);assert.equal(second.children[0].children,later.children);assert.equal(second.children[0].noteIds,later.noteIds);assert.equal(second.children[0].affiliationIds,later.affiliationIds);assert.equal(second.children[0].custom,'preserved');
  assert.equal(second.children[2],initial[2].children[0].children[0].children[2]);assert.equal(JSON.stringify(initial),before,'frozen source is untouched');
  assert.equal(normalizeDocumentTitles(normalized),normalized,'normalization is idempotent and creates no new IDs');
});

test('the first semantic title remains unique even when it is empty',()=>{
  const empty=entry('title','empty',''),filled=entry('title','filled','Filled title',{noteIds:['note']});
  const value=[{type:'h1',children:[{text:'Ordinary body heading'}]},{type:'document_metadata',id:'m',children:[empty,filled,entry('note','note','Contribution note')]}];
  const normalized=normalizeDocumentTitles(value);
  assert.equal(normalized[0],value[0]);assert.equal(normalized[1].children[0],empty);assert.equal(normalized[1].children[1].role,'text');
  assert.equal(entryText(normalized[1].children[1]),'Filled title');assert.deepEqual(normalized[1].children[1].noteIds,['note']);
  assert.equal(normalizeDocumentTitles([{type:'p',children:[{text:'No metadata'}]}]).length,1);
});

test('migration enforces title uniqueness even without legacy metadata and preserves already unique trees',()=>{
  const unique=[{type:'document_metadata',id:'unique',children:[entry('title','title','Only title'),entry('author','author','Alice')]}];
  assert.equal(normalizeDocumentTitles(unique),unique);
  const repeated=[...unique,{type:'document_metadata',id:'later',children:[entry('title','another','Another title')]}],before=JSON.stringify(repeated);
  const migrated=migrateDocumentMetadata(repeated);
  assert.equal(migrated[0],unique[0]);assert.equal(migrated[1].children[0].role,'text');assert.equal(entryText(migrated[1].children[0]),'Another title');
  assert.equal(JSON.stringify(repeated),before);assert.deepEqual(migrateDocumentMetadata(migrated),migrated);
});

test('legacy title migration preserves an existing semantic title as text with its marks and note relation',()=>{
  const existingTitle=entry('title','existing-title','Existing title',{noteIds:['existing-note']});existingTitle.children[0].children[0].bold=true;
  const value=[{type:'document_metadata',id:'existing',children:[existingTitle,entry('note','existing-note','Existing title note')]},{type:'p',children:[{text:'Body'}]}];
  const metadata={title:'Legacy title',authors:[]},before=JSON.stringify(value),migrated=migrateDocumentMetadata(value,metadata);
  assert.equal(migrated[0].children[0].role,'title');assert.equal(entryText(migrated[0].children[0]),'Legacy title');
  const preservedTitle=migrated[1].children.find(node=>node.id==='existing-title');
  assert.equal(preservedTitle.role,'text');assert.equal(preservedTitle.children,existingTitle.children);assert.deepEqual(preservedTitle.noteIds,['existing-note']);
  assert.equal(migrated[1].children.find(node=>node.id==='existing-note'),value[0].children[1]);assert.equal(JSON.stringify(value),before);
  assert.deepEqual(migrateDocumentMetadata(value,metadata),migrated,'legacy migration and title normalization share a deterministic baseline');
});

test('moving authors changes first-use note numbers while shared affiliations and stored IDs stay intact',()=>{
  const title=entry('title','title','Paper',{noteIds:['funding']}),alice=entry('author','alice','Alice',{affiliationIds:['lab2','lab1'],noteIds:['alice-note','shared']}),bob=entry('author','bob','Bob',{affiliationIds:['lab1'],noteIds:['shared','bob-note']});
  const first=entry('affiliation','lab1','Institute A'),second=entry('affiliation','lab2','Institute B'),shared=entry('note','shared','Equal contribution'),free={type:'p',children:[{text:'Free descriptive paragraph',italic:true}]};
  const initial={type:'document_metadata',id:'m',children:[title,alice,bob,first,second,shared,entry('note','alice-note','Alice note'),entry('note','bob-note','Bob note'),entry('note','funding','Funding'),free]};
  const before=JSON.stringify(initial),refsBefore=JSON.stringify([alice.affiliationIds,alice.noteIds,bob.affiliationIds,bob.noteIds]);
  const original=metadataIndex(initial),reordered=reorderMetadataEntries(initial,'bob','alice'),after=metadataIndex(reordered);
  assert.deepEqual(original.authors.map(author=>author.id),['alice','bob']);assert.deepEqual(after.authors.map(author=>author.id),['bob','alice']);
  assert.deepEqual([...original.noteNumbers],[['funding',1],['alice-note',2],['shared',3],['bob-note',4]]);
  assert.deepEqual([...after.noteNumbers],[['funding',1],['shared',2],['bob-note',3],['alice-note',4]]);
  assert.deepEqual([...after.affiliationNumbers],[...original.affiliationNumbers]);
  assert.equal(reordered.children.at(-1),free);assert.equal(reordered.children[5],shared,'note placement is independent of its current marker');
  assert.equal(JSON.stringify([alice.affiliationIds,alice.noteIds,bob.affiliationIds,bob.noteIds]),refsBefore);assert.equal(JSON.stringify(initial),before);
});

test('moving affiliations renumbers their shared IDs without rewriting authors association order or note positions',()=>{
  const alice=entry('author','alice','Alice',{affiliationIds:['lab2','lab1'],noteIds:['shared']}),bob=entry('author','bob','Bob',{affiliationIds:['lab1'],noteIds:['shared']}),lab1=entry('affiliation','lab1','Institute A'),lab2=entry('affiliation','lab2','Institute B'),note=entry('note','shared','Equal contribution');
  const free={type:'p',children:[{text:'Descriptive content'}]},initial={type:'document_metadata',id:'m',children:[alice,bob,lab1,lab2,note,free]},before=JSON.stringify(initial);
  const original=metadataIndex(initial),reordered=reorderMetadataEntries(initial,'lab2','lab1'),after=metadataIndex(reordered);
  assert.deepEqual([...original.affiliationNumbers],[['lab1',1],['lab2',2]]);assert.deepEqual([...after.affiliationNumbers],[['lab2',1],['lab1',2]]);
  assert.deepEqual([...after.noteNumbers],[...original.noteNumbers]);assert.deepEqual(alice.affiliationIds,['lab2','lab1']);assert.deepEqual(bob.affiliationIds,['lab1']);
  assert.equal(after.affiliationNumbers.get(bob.affiliationIds[0]),2,'Bob is still attached to Institute A after its number changes');
  assert.deepEqual(metadataOrderedIds(alice.affiliationIds,original.affiliationNumbers),['lab1','lab2']);assert.deepEqual(metadataOrderedIds(alice.affiliationIds,after.affiliationNumbers),['lab2','lab1']);
  const unresolved=['lab1','missing-b','lab2','missing-a'];assert.deepEqual(metadataOrderedIds(unresolved,after.affiliationNumbers),['lab2','lab1','missing-b','missing-a']);assert.deepEqual(unresolved,['lab1','missing-b','lab2','missing-a'],'unresolved references remain visible and stable instead of being dropped or rewritten');
  assert.equal(reordered.children[5],free);assert.equal(reordered.children[4],note);assert.equal(JSON.stringify(initial),before);
});

test('role-specific reordering moves whole nodes immutably and keeps canonical groups and entry objects intact',()=>{
  const alice=entry('author','alice','Alice',{affiliationIds:['lab'],noteIds:['note']}),bob=entry('author','bob','Bob',{affiliationIds:['lab'],noteIds:['note']}),lab=entry('affiliation','lab','Institute'),note=entry('note','note','Shared note'),free={type:'p',children:[{text:'Free content',bold:true}]};
  const value={type:'document_metadata',id:'m',children:[alice,bob,lab,note,free]},before=JSON.stringify(value),freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};freeze(value);
  const reordered=reorderMetadataEntries(value,'alice',null);
  assert.deepEqual(reordered.children,[bob,alice,lab,note,free]);assert.equal(reordered.children[0],bob);assert.equal(reordered.children[1],alice);
  assert.equal(reordered.children[2],lab);assert.equal(reordered.children[3],note);assert.equal(reordered.children[4],free);
  assert.equal(reorderMetadataEntries(reordered,'alice',null),reordered,'moving an already last author is a no-op');
  assert.deepEqual(reorderMetadataEntries(reordered,'alice','bob'),value,'reversing the order recovers all original data');
  assert.equal(reorderMetadataEntries(value,'alice','lab'),value,'a different-role target cannot move an author into the affiliation order');
  assert.equal(reorderMetadataEntries(value,'missing','alice'),value);assert.equal(reorderMetadataEntries(value,'note',null),value);assert.equal(JSON.stringify(value),before);
});

test('normalizing metadata layout preserves within-role order, references and saved-baseline determinism',()=>{
  const title=entry('title','title','Paper'),alice=entry('author','alice','Alice',{affiliationIds:['lab'],noteIds:['note']}),bob=entry('author','bob','Bob',{affiliationIds:['lab'],noteIds:['note']}),lab=entry('affiliation','lab','Institute'),note=entry('note','note','Shared contribution'),free={type:'p',children:[{text:'Additional descriptive prose',italic:true}]};
  const value=[{type:'document_metadata',id:'m',children:[title,alice,lab,free,bob,note]},{type:'p',children:[{text:'Body'}]}],before=JSON.stringify(value),freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};freeze(value);
  const normalized=normalizeMetadataLayout(value);
  assert.deepEqual(normalized[0].children,[title,alice,bob,lab,note,free]);
  assert.equal(normalized[0].children[1],alice);assert.equal(normalized[0].children[2],bob);assert.equal(normalized[0].children[3],lab);assert.equal(normalized[0].children[4],note);assert.equal(normalized[0].children[5],free);assert.equal(normalized[1],value[1]);
  assert.deepEqual([...metadataIndex(normalized).affiliationNumbers],[...metadataIndex(value).affiliationNumbers]);assert.deepEqual([...metadataIndex(normalized).noteNumbers],[...metadataIndex(value).noteNumbers]);
  assert.equal(normalizeMetadataLayout(normalized),normalized);assert.equal(normalizeMetadataAuthors(normalized),normalized);assert.deepEqual(normalizeMetadataAuthors(value),normalized);assert.deepEqual(migrateDocumentMetadata(value),normalized);assert.deepEqual(migrateDocumentMetadata(normalized),normalized);assert.equal(JSON.stringify(value),before);
});

test('an affiliation inserted after a note returns to the affiliation group before notes and free content',()=>{
  const title=entry('title','title','Paper'),alice=entry('author','alice','Alice',{affiliationIds:['aff3','aff1'],noteIds:['shared']}),bob=entry('author','bob','Bob',{affiliationIds:['aff2','aff3'],noteIds:['shared']}),aff1=entry('affiliation','aff1','Institute 1'),aff2=entry('affiliation','aff2','Institute 2'),aff3=entry('affiliation','aff3','Institute 3'),note=entry('note','shared','Equal contribution'),textEntry=entry('text','text','Additional information'),free={type:'p',children:[{text:'Legacy free paragraph',italic:true}]};
  const value=[{type:'document_metadata',id:'m',children:[title,alice,bob,aff1,aff2,note,textEntry,aff3,free]}],before=JSON.stringify(value);
  const normalized=normalizeMetadataLayout(value);
  assert.deepEqual(normalized[0].children,[title,alice,bob,aff1,aff2,aff3,note,textEntry,free]);
  normalized[0].children.forEach((child,index)=>assert.equal(child,[title,alice,bob,aff1,aff2,aff3,note,textEntry,free][index]));
  assert.deepEqual([...metadataIndex(normalized).affiliationNumbers],[['aff1',1],['aff2',2],['aff3',3]]);assert.deepEqual(alice.affiliationIds,['aff3','aff1']);assert.deepEqual(bob.affiliationIds,['aff2','aff3']);assert.equal(JSON.stringify(value),before);
  const moved=reorderMetadataEntries(normalized[0],'aff3','aff1');assert.deepEqual(moved.children,[title,alice,bob,aff3,aff1,aff2,note,textEntry,free]);
  assert.deepEqual(reorderMetadataEntries(value[0],'aff3','aff1').children,moved.children,'dragging the late affiliation moves the whole node across the note, rather than swapping old role slots');
  assert.deepEqual([...metadataIndex(moved).affiliationNumbers],[['aff3',1],['aff1',2],['aff2',3]]);assert.equal(moved.children[6],note);assert.equal(moved.children[7],textEntry);assert.equal(moved.children[8],free);
});

test('stable layout ordering keeps every role group and the combined text/free group in relative order',()=>{
  const text1=entry('text','text1','First free entry'),free1={type:'p',children:[{text:'First legacy paragraph'}]},note1=entry('note','note1','First note'),aff1=entry('affiliation','aff1','First affiliation'),alice=entry('author','alice','Alice'),title=entry('title','title','Paper'),free2={type:'p',children:[{text:'Second legacy paragraph'}]},note2=entry('note','note2','Second note'),bob=entry('author','bob','Bob'),aff2=entry('affiliation','aff2','Second affiliation'),text2=entry('text','text2','Second free entry');
  const value=[{type:'document_metadata',id:'m',children:[text1,free1,note1,aff1,alice,title,free2,note2,bob,aff2,text2]}];
  const normalized=normalizeMetadataLayout(value);assert.deepEqual(normalized[0].children,[title,alice,bob,aff1,aff2,note1,note2,text1,free1,free2,text2]);
  assert.equal(normalizeMetadataLayout(normalized),normalized);assert.deepEqual(migrateDocumentMetadata(value),normalized);
});

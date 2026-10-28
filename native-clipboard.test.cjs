const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const compiled=buildSync({stdin:{contents:`export * from './src/native-clipboard'; export {EditorModel} from './src/editor-model'; export {parseBibLibraries} from './src/bibtex';`,resolveDir:__dirname},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const loaded={exports:{}};new Function('module','exports','require',compiled)(loaded,loaded.exports,require);
const api=loaded.exports;
const leaf=text=>({text});
const element=(type,props={},children=[leaf('')])=>({type,...props,children});
const paragraph=(...children)=>element('p',{},children);
const reference=(command,...keys)=>element('tex_reference',{command,keys});
const document=(value,props={})=>({version:1,kind:'document',value,...props});
const library=(source,id='library')=>({id,name:id+'.bib',source});
const transfer=()=>{const values=new Map();return {getData:type=>values.get(type)||'',setData:(type,value)=>values.set(type,value),values};};
const blank=()=>{const m=new api.EditorModel();m.root.items=[];m.index();m.setCursor(m.root.id,0);return m;};

test('custom MIME and inert HTML preserve nested native formula and its Unicode source',()=>{
  const model=blank();model.insertStructure('frac');model.insert('α');model.insertStructure('sqrt');model.insert('中');
  const original={version:1,kind:'math',snapshot:model.snapshot()},clipboard=transfer();
  assert.equal(api.writeNativeClipboard(clipboard,original),true);
  assert.deepEqual(api.readNativeClipboard(clipboard),original);
  clipboard.values.delete(api.nativeClipboardMime);
  clipboard.setData('text/html',api.nativeClipboardHtml(original,'<span>α</span>'));
  assert.deepEqual(api.readNativeClipboard(clipboard),original);
  assert.equal(api.hasNativeClipboard(clipboard),true);
  const restored=new api.EditorModel();restored.restore(api.readNativeClipboard(clipboard).snapshot);
  assert.equal(restored.exportLatex(),model.exportLatex());
});

test('unsupported TeX source node survives native clipboard without interpreting its syntax',()=>{
  const model=blank(),source=String.raw`\unknownMacro{a&b}_\foo + 中`;
  model.insertSourceTex(source);
  const original={version:1,kind:'math',snapshot:model.snapshot()},clipboard=transfer();
  api.writeNativeClipboard(clipboard,original);
  const result=api.readNativeClipboard(clipboard),restored=new api.EditorModel();
  restored.restore(result.snapshot);assert.equal(restored.exportLatex(),source);
  assert.equal(restored.root.items[0].type,'source-tex');
});

test('inline Slate roots retain their shape and original marks',()=>{
  const selected=[{text:'selected ',italic:true},reference('eqref','eq:a'),leaf(' text')];
  const result=api.validateNativeFragment(document(selected));
  assert.deepEqual(result.value,selected);assert.equal(result.value[0].type,undefined);
  result.value[0].text='changed';assert.equal(selected[0].text,'selected ');
});

test('invalid schemas, dangerous property names and malformed math decline safely',()=>{
  for(const value of [null,{},[],{version:2,kind:'document',value:[paragraph(leaf('x'))]},
    document([]),document([paragraph(leaf('x'))],{bibliographyLibraries:[{}]}),
    {version:1,kind:'math',snapshot:'{}'},document([paragraph(element('inline_equation',{snapshot:'{}'}))]),
    JSON.parse('{"version":1,"kind":"document","value":[{"type":"p","children":[{"text":"x","__proto__":{"polluted":true}}]}]}'),
    document([paragraph(leaf('x'))],{endnoteDefinitions:[paragraph(leaf('not a definition'))]}),
  ])assert.equal(api.validateNativeFragment(value),null);
  const clipboard=transfer();clipboard.setData(api.nativeClipboardMime,'{');
  clipboard.setData('text/html','<img src=x onerror=alert(1) data-vulgar-notes-fragment="not-json">');
  assert.equal(api.readNativeClipboard(clipboard),null);assert.equal(api.hasNativeClipboard(clipboard),true);
  clipboard.setData('text/html',api.nativeClipboardHtml(document([leaf('stale other fragment')]),'stale'));
  assert.equal(api.readNativeClipboard(clipboard),null);
  assert.equal({}.polluted,undefined);
  assert.equal(api.readNativeClipboard({getData(){throw Error('Unavailable');}}),null);
});

test('invalid native data never appears as serialized HTML or custom clipboard data',()=>{
  assert.equal(api.writeNativeClipboard(transfer(),document([])),false);
  assert.throws(()=>api.nativeClipboardHtml(document([]),'text'),/Invalid native/);
  assert.equal(api.writeNativeClipboard({setData(){throw Error('Disabled');}},document([leaf('x')])),false);
  let nested=leaf('x');for(let i=0;i<210;i++)nested=element('p',{},[nested]);
  assert.equal(api.validateNativeFragment(document([nested])),null);
});

test('cloning assigns independent IDs and redirects only included equation targets',()=>{
  const value=[element('p',{id:'p'},[
    element('inline_equation',{id:'eq',texLabel:'eq:a',texExpression:'x',display:true,numbered:true}),
    reference('eqref','eq:a'),reference('ref','sec:outside'),
  ])];
  const original=document(value),cloned=api.cloneDocumentFragment(original,value);
  assert.notEqual(cloned.value[0].id,'p');
  const [formula,inside,outside]=cloned.value[0].children;
  assert.notEqual(formula.id,'eq');assert.equal(formula.texLabel,'eq:a-copy2');
  assert.deepEqual(inside.keys,['eq:a-copy2']);assert.deepEqual(outside.keys,['sec:outside']);
  assert.equal(original.value[0].children[0].texLabel,'eq:a');
  const second=api.cloneDocumentFragment(original,value);
  assert.notEqual(second.value[0].id,cloned.value[0].id);
});

test('metadata authors retain copied affiliation and note associations with independent IDs',()=>{
  const entry=(role,id,props={})=>element('metadata_entry',{role,id,...props},[paragraph(leaf(id))]);
  const value=[element('document_metadata',{id:'metadata'},[
    entry('title','title',{noteIds:['note']}),entry('author','author',{affiliationIds:['unit'],noteIds:['note']}),
    entry('affiliation','unit'),entry('note','note'),
  ])];
  const result=api.cloneDocumentFragment(document(value),value).value[0],entries=result.children;
  assert.notEqual(result.id,'metadata');
  assert.deepEqual(entries[1].affiliationIds,[entries[2].id]);assert.deepEqual(entries[1].noteIds,[entries[3].id]);
  assert.deepEqual(entries[0].noteIds,[entries[3].id]);
  for(let i=0;i<entries.length;i++)assert.notEqual(entries[i].id,value[0].children[i].id);
});

test('endnote references carry recursive definitions separately, stopping reference cycles',()=>{
  const ref=id=>element('footnoteReference',{identifier:id});
  const definition=(id,children)=>element('footnoteDefinition',{identifier:id},[paragraph(...children)]);
  const source=[paragraph(ref('note-a')),definition('note-a',[leaf('A'),ref('note-b')]),definition('note-b',[leaf('B'),ref('note-a')])];
  const selected=[ref('note-a')],captured=api.captureDocumentFragment(selected,[],source,'source-id');
  assert.equal(captured.value.length,1);assert.equal(captured.endnoteDefinitions.length,2);
  assert.equal(captured.sourceDocumentId,'source-id');
  const result=api.cloneDocumentFragment(captured,source);
  assert.equal(result.value[0].identifier,'note-a-copy2');
  assert.equal(result.endnoteDefinitions[0].identifier,'note-a-copy2');
  assert.equal(result.endnoteDefinitions[0].children[0].children[1].identifier,'note-b-copy2');
  assert.equal(result.endnoteDefinitions[1].children[0].children[1].identifier,'note-a-copy2');
  const same=api.cloneDocumentFragment(captured,source,{sameDocument:true});
  assert.equal(same.value[0].identifier,'note-a');assert.equal(same.endnoteDefinitions.length,0);
  const full=api.cloneDocumentFragment(api.captureDocumentFragment([source[1]],[],source),source,{sameDocument:true});
  assert.equal(full.value[0].identifier,'note-a-copy2');
});

test('citation capture carries only used records and their BibTeX dependencies',()=>{
  const libraries=[library('@book{parent,title={Parent}}\n@inbook{used,title={Used},crossref={parent}}\n@book{unused,title={Unused}}')];
  const result=api.captureDocumentFragment([paragraph(reference('cite','used'))],libraries);
  assert.equal(result.bibliographyLibraries.length,1);
  assert.deepEqual(api.parseBibLibraries(result.bibliographyLibraries).map(entry=>entry.key),['parent','used']);
  assert.equal(result.bibliographyLibraries[0].source.includes('unused'),false);
  const empty=api.captureDocumentFragment([paragraph(leaf('plain'))],libraries);assert.equal(empty.bibliographyLibraries,undefined);
});

test('distinct bibliography sources remain byte-identical and same entries are not duplicated',()=>{
  const current=[library('@book{old,title={Old}}','current')],incoming=library('% Original comment\n@book{new,title={New}}\n','current');
  const fragment=document([paragraph(reference('cite','new'))],{bibliographyLibraries:[incoming]});
  const cloned=api.cloneDocumentFragment(fragment,[],{existingLibraries:current});
  assert.equal(cloned.bibliographyLibraries[0].source,incoming.source);
  assert.notEqual(cloned.bibliographyLibraries[0].id,current[0].id);
  const same=api.cloneDocumentFragment(document([paragraph(reference('cite','old'))],{bibliographyLibraries:current}),[],{existingLibraries:current});
  assert.deepEqual(same.bibliographyLibraries,[]);assert.deepEqual(same.value[0].children[0].keys,['old']);
});

test('conflicting citation keys rename incoming records and crossref links without changing fields',()=>{
  const existing=[library('@book{parent,title={Old Parent}}\n@inbook{same,title={Chapter},crossref={parent}}','existing')];
  const incoming=[library('@string{label="New " # "Parent"}\n@book{parent,title=label}\n@inbook{same,title={Chapter},crossref={parent}}','incoming')];
  const original=document([paragraph(reference('cite','same'))],{bibliographyLibraries:incoming});
  const cloned=api.cloneDocumentFragment(original,[],{existingLibraries:existing});
  assert.deepEqual(cloned.value[0].children[0].keys,['same-copy2']);
  const records=api.parseBibLibraries([...existing,...cloned.bibliographyLibraries]);
  assert.deepEqual(records.map(entry=>entry.key),['parent','same','parent-copy2','same-copy2']);
  assert.equal(records.find(entry=>entry.key==='parent-copy2').title,'New Parent');
  assert.match(cloned.bibliographyLibraries[0].source,/crossref = \{parent-copy2\}/);
  assert.equal(existing[0].source.includes('copy2'),false);
  assert.deepEqual(original.value[0].children[0].keys,['same']);
});

test('conflicting string macros expand incoming fields rather than modifying existing semantics',()=>{
  const existing=[library('@string{j="Old Journal"}\n@article{old,title={Old},journal=j}','existing')];
  const incoming=[library('@string{j="New Journal"}\n@article{new,title={New},journal=j}','incoming')];
  const cloned=api.cloneDocumentFragment(document([paragraph(reference('cite','new'))],{bibliographyLibraries:incoming}),[],{existingLibraries:existing});
  const records=api.parseBibLibraries([...existing,...cloned.bibliographyLibraries]);
  assert.match(records.find(entry=>entry.key==='old').description,/Old Journal/);
  assert.match(records.find(entry=>entry.key==='new').description,/New Journal/);
});

test('preamble is retained in a new document and unsafe cross-library macro merging aborts',()=>{
  const incoming=library('@preamble{"\\newcommand{\\bibfoo}{A}"}\n@article{new,title={\\bibfoo}}','incoming');
  const fragment=document([paragraph(reference('cite','new'))],{bibliographyLibraries:[incoming]});
  const current=[library('@book{old,title={Old}}','existing')];
  const independent=api.cloneDocumentFragment(fragment,[]);
  assert.equal(independent.bibliographyLibraries[0].source,incoming.source);
  assert.throws(()=>api.cloneDocumentFragment(fragment,[],{existingLibraries:current}),/preamble/);
  assert.equal(current[0].source,'@book{old,title={Old}}');
  assert.deepEqual(fragment.value[0].children[0].keys,['new']);
  // Copying an existing citation in the same library needs no duplicate source.
  const same=api.cloneDocumentFragment(fragment,[],{existingLibraries:[incoming]});
  assert.deepEqual(same.bibliographyLibraries,[]);
});

test('citation names reserve all real keys before allocating collision suffixes',()=>{
  const existing=[library('@book{a,title={Old}}','old')];
  const incoming=[library('@book{a,title={New}}\n@book{a-copy2,title={Already here}}','new')];
  const result=api.cloneDocumentFragment(document([paragraph(reference('cite','a','a-copy2'))],{bibliographyLibraries:incoming}),[],{existingLibraries:existing});
  assert.deepEqual(result.value[0].children[0].keys,['a-copy3','a-copy2']);
  assert.equal(api.parseBibLibraries([...existing,...result.bibliographyLibraries]).length,3);
});

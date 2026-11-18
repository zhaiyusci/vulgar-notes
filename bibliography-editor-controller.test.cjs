const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {build}=require('esbuild');

const compiled=build({entryPoints:['src/bibliography-editor-controller.ts'],bundle:true,write:false,platform:'node',format:'cjs',metafile:true}).then(result=>{
 const module={exports:{}};
 // No document, window, custom element registry, React, Plate, widget store or storage.
 vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports});
 return {api:module.exports,inputs:Object.keys(result.metafile.inputs)};
});
const BIB='% A source comment\n@string{journalName={Test Journal}}\n@article{first,title={Original title},journal=journalName,customfield={Keep me}}\n% Between entries\n@book{second,title={Untouched book}}\n';
const toBibtex=items=>items.map(item=>'@'+(item.csl.type==='book'?'book':'article')+'{'+item.id+',title={'+item.csl.title+'}}').join('\n');
const plain=value=>JSON.parse(JSON.stringify(value));
async function fixture({source=BIB,citedKeys=[],others=[]}={}){
 const {api}=await compiled,library={id:'first-library',name:'paper.bib',source};
 const state={libraries:[library,...others],citedKeys,readOnly:false,commits:0};
 const access={isReadOnly:()=>state.readOnly,getLibraries:()=>state.libraries,getCitedKeys:()=>state.citedKeys,commitLibraries:next=>{state.commits++;state.libraries=next;}};
 const controller=api.createBibliographyEditorController(library,access,toBibtex);
 const items=controller.initialItems.map(csl=>({id:csl.id,csl:{...csl},tags:[],collections:[],addedAt:0,updatedAt:0,source:'bibtex'}));
 return {api,controller,items,state,library};
}

test('bibliography editing core runs without UI, vendor widget, editor framework or platform dependencies',async()=>{
 const {inputs}=await compiled;
 assert.ok(inputs.includes('src/bibliography-editor-controller.ts'));
 assert.ok(inputs.includes('src/bibliography-library-edit.ts'));
 assert.equal(inputs.some(input=>/(?:^|\/)(?:react(?:-dom)?|platejs|slate(?:-react)?|components)(?:\/|$)|src\/(?:generated|plate-host|plate-math-element|i18n|platform)/.test(input)),false,inputs.join('\n'));
 const f=await fixture();assert.deepEqual(plain(f.controller.save(f.items)),{status:'saved'});
 assert.equal(f.state.libraries[0].source,BIB,'no-op saves retain exact original source');assert.equal(f.state.commits,1);
});

test('independent library editors retain source fields and cannot change another document',async()=>{
 const a=await fixture(),b=await fixture();a.items[0].csl.title='Edited title';
 assert.equal(a.controller.save(a.items).status,'saved');
 assert.match(a.state.libraries[0].source,/title=\{Edited title\}/);assert.match(a.state.libraries[0].source,/customfield=\{Keep me\}/);
 assert.ok(a.state.libraries[0].source.startsWith('% A source comment\n@string{journalName={Test Journal}}'));
 assert.ok(a.state.libraries[0].source.endsWith('% Between entries\n@book{second,title={Untouched book}}\n'));
 assert.equal(b.state.libraries[0].source,BIB);assert.equal(b.state.commits,0);
});

test('confirmation covers only newly broken citations and is renewed after source, reference or library changes',async()=>{
 const f=await fixture({citedKeys:['first','already-missing']});
 let items=f.items.filter(item=>item.id!=='first');
 assert.deepEqual(plain(f.controller.save(items)),{status:'confirmation-required',keys:['first']});assert.equal(f.state.commits,0);
 // Another draft edit invalidates an already displayed confirmation.
 f.controller.changed();assert.equal(f.controller.save(items).status,'confirmation-required');
 // A newly cited second entry requires its own warning even without a draft event.
 items=[];f.state.citedKeys=['first','second','already-missing'];
 assert.deepEqual(plain(f.controller.save(items)),{status:'confirmation-required',keys:['first','second']});
 // Removing an unrelated library or updating its content also revokes confirmation.
 f.state.libraries=[...f.state.libraries,{id:'other',name:'other.bib',source:'@book{third,title={Third}}'}];
 assert.equal(f.controller.save(items).status,'confirmation-required');assert.equal(f.state.commits,0);
 assert.equal(f.controller.save(items).status,'saved');assert.equal(f.state.commits,1);
 assert.doesNotMatch(f.state.libraries[0].source,/@(?:article|book)\{/);
});

test('unmodified libraries still resolve citations while the edited library changes',async()=>{
 const f=await fixture({source:'@book{second,title={Uncited}}',citedKeys:['first'],others:[{id:'other',name:'other.bib',source:'@book{first,title={Referenced}}'}]});
 assert.equal(f.controller.save([]).status,'saved');assert.equal(f.state.commits,1);
 assert.match(f.state.libraries[1].source,/@book\{first/);
});

test('read-only, removed and concurrently refreshed libraries cannot commit a stale draft',async()=>{
 for(const kind of ['read-only','removed','refreshed']){
  const f=await fixture({citedKeys:['first']});const items=f.items.filter(item=>item.id!=='first');
  assert.equal(f.controller.save(items).status,'confirmation-required');
  if(kind==='read-only')f.state.readOnly=true;
  if(kind==='removed')f.state.libraries=[];
  if(kind==='refreshed')f.state.libraries=[{...f.library,source:BIB+'% Refreshed'}];
  const before=JSON.stringify(f.state.libraries);
  assert.throws(()=>f.controller.save(items),kind==='read-only'?/read-only/:kind==='removed'?/no longer available/:/changed while the editor was open/);
  assert.equal(f.state.commits,0);assert.equal(JSON.stringify(f.state.libraries),before);
 }
});

test('cross-library key conflicts fail without replacing either source',async()=>{
 const f=await fixture({others:[{id:'other',name:'other.bib',source:'@book{taken,title={Other}}'}]});
 f.items[0].id='taken';f.items[0].csl.id='taken';const before=JSON.stringify(f.state.libraries);
 assert.throws(()=>f.controller.save(f.items),/Duplicate citation key/);assert.equal(f.state.commits,0);assert.equal(JSON.stringify(f.state.libraries),before);
});

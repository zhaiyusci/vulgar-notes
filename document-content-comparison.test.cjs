const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const bundled=buildSync({stdin:{contents:`export {DocumentContentComparison} from './src/document-content-comparison';export {documentContentKey} from './src/plate-document';export {migrateDocumentMetadata,normalizeMetadataLayout,normalizeDocumentTitles} from './src/document-metadata';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',target:'es2022'}).outputFiles[0].text;
const compiled={exports:{}};new Function('module','exports',bundled)(compiled,compiled.exports);
const {DocumentContentComparison,documentContentKey,migrateDocumentMetadata,normalizeMetadataLayout,normalizeDocumentTitles}=compiled.exports;
const p=text=>({type:'p',children:[{text}]}),envelope=value=>({version:1,value,bibliographyLibraries:[],bibliographyStyle:'acs'});
const clone=value=>JSON.parse(JSON.stringify(value));
const metadataEntry=(role,id,text)=>({type:'metadata_entry',role,id,children:[p(text)]});
const mathRoot=text=>({id:'root',type:'sequence',items:[{id:'token',type:'text',text}]});
const formula=(root,cursor=0,extra={})=>({type:'inline_equation',id:'math',texExpression:'x',snapshot:JSON.stringify({root,cursor:{id:'root',offset:cursor},...extra}),numbered:false,children:[{text:''}]});

test('legacy title and author metadata use the same normalization as saved content',()=>{
 const legacy=envelope([p('Body')]);legacy.metadata={title:'Article title',authors:[{name:'Alice',affiliation:'Institute',email:'a@example.test'}]};
 const baseline=JSON.stringify(legacy),comparison=new DocumentContentComparison(baseline);
 const current={...legacy,value:migrateDocumentMetadata(clone(legacy.value),legacy.metadata)};delete current.metadata;
 assert.equal(comparison.isEqual(current),true);
 assert.equal(comparison.isEqual(clone(legacy)),true,'the comparison also accepts a still-legacy runtime envelope');
 const author=current.value[0].children.find(entry=>entry.role==='author');
 const changed={...current,value:[{...current.value[0],children:current.value[0].children.map(entry=>entry===author?{...entry,children:[p('A different author')]}:entry)},...current.value.slice(1)]};
 assert.equal(comparison.isEqual(changed),false);
});

test('title uniqueness and stable metadata role groups compare against the rendered normalized layout',()=>{
 const first={type:'document_metadata',id:'first',children:[metadataEntry('note','n','Correspondence'),metadataEntry('title','t1','Primary'),metadataEntry('author','a','Alice')]};
 const second={type:'document_metadata',id:'second',children:[metadataEntry('title','t2','Secondary retained'),metadataEntry('affiliation','u','University')]};
 const saved=envelope([first,p('Between'),second,p('Body')]),comparison=new DocumentContentComparison(JSON.stringify(saved));
 const normalized={...saved,value:normalizeMetadataLayout(normalizeDocumentTitles(clone(saved.value)))};
 assert.equal(normalized.value[2].children.find(entry=>entry.id==='t2').role,'text');
 assert.equal(comparison.isEqual(normalized),true);
 assert.equal(comparison.isEqual(saved),true,'normalization must not mutate the caller or report a false dirty state');
 assert.equal(second.children[0].role,'title');
});

test('saving an older snapshot does not mark newer current content clean',()=>{
 const old=envelope([p('Before the save')]),current=envelope([p('Typed while saving')]);
 const comparison=new DocumentContentComparison(JSON.stringify(old));assert.equal(comparison.isEqual(old),true);assert.equal(comparison.isEqual(current),false);
 comparison.reset(JSON.stringify(old));assert.equal(comparison.isEqual(current),false,'Save completion must compare with its actual source, not the latest editor value');
 comparison.reset(JSON.stringify(current));assert.equal(comparison.isEqual(current),true);
 comparison.reset(JSON.stringify(old));assert.equal(comparison.isEqual(current),false,'reset must invalidate positive cache results from the previous baseline');
});

test('math cursor and pending-font changes stay clean; content edits and undo compare actual trees',()=>{
 const root=mathRoot('x'),originalFormula=formula(root),saved=envelope([{...p(''),children:[{text:'Before '},originalFormula,{text:' after'}]}]);
 const comparison=new DocumentContentComparison(JSON.stringify(saved));assert.equal(comparison.isEqual(saved),true);
 const withFormula=node=>({...saved,value:[{...saved.value[0],children:[saved.value[0].children[0],node,saved.value[0].children[2]]}]});
 const moved=withFormula(formula(root,1,{pendingFont:'mathfrak',selection:{anchor:0,focus:1}}));
 assert.equal(comparison.isEqual(moved),true);
 assert.equal(documentContentKey(JSON.stringify(saved)),documentContentKey(JSON.stringify(moved)),'the existing saved-key behavior ignores the same transient state');
 const changed=withFormula(formula(mathRoot('y'),1));assert.equal(comparison.isEqual(changed),false);assert.equal(comparison.isEqual(changed),false);
 assert.equal(comparison.isEqual(moved),true,'undo of the formula content restores the clean state');
 const changedTex=withFormula({...originalFormula,texExpression:'y'});assert.equal(comparison.isEqual(changedTex),false,'source changes remain content changes even when the model root is unchanged');
 for(let index=0;index<160;index++)assert.equal(comparison.isEqual(withFormula(formula(root,index))),true,'bounded snapshot caching must not change semantic results');
});

test('unchanged shared images skip their content fields after the initial comparison',()=>{
 const bytes='data:image/png;base64,'+'A'.repeat(4_900_000),image={type:'img',url:bytes,children:[{text:''}]};
 const saved=envelope([image,p('Body')]),comparison=new DocumentContentComparison(JSON.stringify(saved));
 let reads=0;const currentImage={type:'img',get url(){reads++;return bytes;},children:[{text:''}]};
 const original={...saved,value:[currentImage,saved.value[1]]};
 assert.equal(comparison.isEqual(original),true);assert.equal(reads,1);
 assert.equal(comparison.isEqual({...original,value:[currentImage,p('Edited body')]}),false);assert.equal(reads,1,'a body edit must not revisit the unchanged image URL');
 assert.equal(comparison.isEqual({...original,value:[currentImage,p('Another edit')]}),false);assert.equal(reads,1);
 assert.equal(comparison.isEqual(original),true);assert.equal(reads,1);
 const changedImage={...currentImage,url:bytes+'A'};assert.equal(comparison.isEqual({...original,value:[changedImage,original.value[1]]}),false);
 comparison.reset(JSON.stringify(saved));const before=reads;assert.equal(comparison.isEqual(original),true);assert.equal(reads,before+1,'reset invalidates subtree results, even when the baseline text happens to match');
});

test('rich text marks, unknown metadata, bibliography and object property order remain semantic content',()=>{
 const saved=envelope([{type:'p',align:'right',children:[{text:'Rich',bold:true,italic:true}],custom:{source:'A',flags:{reviewed:true},sequence:[1,null,'x']}}]);
 saved.bibliographyLibraries=[{id:'source',name:'Library',source:'@article{test,title={Title}}'}];
 const comparison=new DocumentContentComparison(JSON.stringify(saved));assert.equal(comparison.isEqual(saved),true);
 const reordered={bibliographyStyle:saved.bibliographyStyle,bibliographyLibraries:saved.bibliographyLibraries,value:[{custom:{sequence:[1,null,'x'],flags:{reviewed:true},source:'A'},children:[{italic:true,bold:true,text:'Rich'}],align:'right',type:'p'}],version:1};
 assert.equal(comparison.isEqual(reordered),true,'property insertion order must not make the document dirty');
 const editNode=update=>({...saved,value:[{...saved.value[0],...update}]});
 assert.equal(comparison.isEqual(editNode({children:[{text:'Rich',bold:true}]})),false);
 assert.equal(comparison.isEqual(editNode({custom:{...saved.value[0].custom,flags:{reviewed:false}}})),false);
 assert.equal(comparison.isEqual({...saved,bibliographyLibraries:[{...saved.bibliographyLibraries[0],source:'@article{test,title={Updated title}}'}]}),false);
 assert.equal(comparison.isEqual({...saved,bibliographyStyle:'aip'}),false);
});

test('undefined object fields are omitted while array positions retain JSON null semantics',()=>{
 const saved=envelope([{...p('Body'),custom:{empty:null,sequence:[null,2,null]}}]),comparison=new DocumentContentComparison(JSON.stringify(saved));
 const sequence=new Array(3);sequence[1]=2;sequence[2]=undefined;
 const current={...saved,unused:undefined,value:[{...saved.value[0],unused:undefined,custom:{empty:NaN,sequence,unused:undefined}}]};
 assert.equal(comparison.isEqual(current),true);
 assert.equal(comparison.isEqual({...current,value:[{...current.value[0],custom:{empty:null,sequence:[2,null]}}]}),false,'array omission cannot erase an element');
 assert.equal(comparison.isEqual({...current,value:[{...current.value[0],custom:{sequence:[null,2,null]}}]}),false,'missing and null object properties remain different');
});

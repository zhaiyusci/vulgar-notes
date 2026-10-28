const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');

const compiled={exports:{}};
new Function('module','exports',buildSync({entryPoints:['src/references.ts'],bundle:true,write:false,platform:'browser',format:'cjs',target:'es2022'}).outputFiles[0].text)(compiled,compiled.exports);
const {bibliographyItems,referenceTargets,resolveReference,citedReferenceKeys,planLabelRename}=compiled.exports;
const p=(...children)=>({type:'p',children:children.map(child=>typeof child==='string'?{text:child}:child)});
const cite=(...keys)=>({type:'tex_reference',command:'cite',keys,children:[{text:''}]});
const note=identifier=>({type:'footnoteReference',identifier,children:[{text:''}]});
const definition=(identifier,...children)=>({type:'footnoteDefinition',identifier,children:[p(...children)]});
const manual=(key,text)=>({type:'bibliography_entry',citeKey:key,children:[{text,bold:true}]});
const libs=[{id:'lib',name:'library.bib',source:'@book{B,title={Book B}}\n@book{unused,title={Unused}}\n@book{A,title={Book A}}\n@book{C,title={Book C}}'}];
const summary=items=>items.map(item=>[item.kind,item.key,item.number]);
const cross=(key,command='ref')=>({type:'tex_reference',command,keys:[key],children:[{text:''}]});
const float=(kind,id,key)=>({type:'float',kind,id,numbered:true,texLabel:key,children:kind==='table'?[{type:'float_caption',children:[{text:'Table caption'}]},{type:'table',children:[{type:'tr',children:[{type:'td',children:[p('A')]}]}]}]:[{type:'img',url:'https://example.org/plot.png',children:[{text:''}]},{type:'float_caption',children:[{text:'Figure caption'}]}]});

test('citations and endnotes share first-occurrence numbers and repeated references reuse them',()=>{
 const value=[p(cite('A'),note('first'),cite('B'),note('second'),cite('A'),note('first')),
  definition('second','Second note'),definition('first','First note')];
 assert.deepEqual(summary(bibliographyItems(value,libs)),[
  ['bibliography','A','1'],['endnote','endnote:first','2'],['bibliography','B','3'],['endnote','endnote:second','4'],
 ]);
 const targets=referenceTargets(value,libs);
 assert.equal(targets.find(item=>item.identifier==='first').node,value[2]);
 assert.deepEqual(targets.find(item=>item.identifier==='first').path,[2]);
 assert.equal(targets.find(item=>item.key==='unused').number,'');
 assert.equal(resolveReference(value,cite('A'),libs).text,'[1]');
 assert.equal(resolveReference(value,cite('B','A'),libs).text,'[3, 1]');
 assert.equal(resolveReference(value,cite('B','A'),libs).invalid,false);
});

test('moving body references renumbers the mixed list without using definition or library order',()=>{
 const first=definition('n1','One'),second=definition('n2','Two');
 const value=[p(note('n2'),cite('B'),note('n1'),cite('A')),first,second];
 assert.deepEqual(summary(bibliographyItems(value,libs)),[
  ['endnote','endnote:n2','1'],['bibliography','B','2'],['endnote','endnote:n1','3'],['bibliography','A','4'],
 ]);
 value[0]=p(cite('A'),note('n1'),note('n2'),cite('B'));
 assert.deepEqual(summary(bibliographyItems(value,libs)),[
  ['bibliography','A','1'],['endnote','endnote:n1','2'],['endnote','endnote:n2','3'],['bibliography','B','4'],
 ]);
});

test('notes expand their rich citations and note references on encounter with cycle protection',()=>{
 const first=definition('n1','Read ',cite('B'),' then ',note('n2'));
 const second=definition('n2','Read ',cite('C'),' and return ',note('n1'));
 const value=[second,p(cite('A'),note('n1'),cite('B'),note('n2')),first];
 assert.deepEqual(summary(bibliographyItems(value,libs)),[
  ['bibliography','A','1'],['endnote','endnote:n1','2'],['bibliography','B','3'],['endnote','endnote:n2','4'],['bibliography','C','5'],
 ]);
 assert.equal(resolveReference(value,cite('C'),libs).text,'[5]');
 assert.deepEqual(new Set(citedReferenceKeys(value)),new Set(['A','B','C']));
});

test('unreferenced legacy manual entries and endnotes are retained after body references in stored order',()=>{
 const legacyNote=definition('legacy','An orphan note'),legacyManual=manual('manual','A retained manual entry');
 const later=definition('later','Another orphan note');
 const value=[legacyNote,p(cite('A')),legacyManual,later];
 const items=bibliographyItems(value,libs);
 assert.deepEqual(summary(items),[
  ['bibliography','A','1'],['endnote','endnote:legacy','2'],['bibliography','manual','3'],['endnote','endnote:later','4'],
 ]);
 assert.equal(items[1].node,legacyNote);assert.equal(items[2].node,legacyManual);assert.equal(items[3].node,later);
 assert.equal(items.some(item=>item.key==='unused'),false);
});

test('legacy manual citation numbering follows its body occurrence instead of always preceding library entries',()=>{
 const row=manual('manual','Manual text'),value=[p(cite('A'),note('n'),cite('manual'),cite('B')),row,definition('n','Note')];
 assert.deepEqual(summary(bibliographyItems(value,libs)),[
  ['bibliography','A','1'],['endnote','endnote:n','2'],['bibliography','manual','3'],['bibliography','B','4'],
 ]);
 assert.equal(resolveReference(value,cite('manual'),libs).text,'[3]');
});

test('endnote identifiers and bibliography keys have separate namespaces',()=>{
 const libraries=[{id:'collision',name:'same.bib',source:'@book{same,title={Same name}}\n@book{endnote:same,title={Literal prefixed citation key}}'}];
 const value=[p(cite('same'),note('same'),cite('endnote:same')),definition('same','A note sharing the identifier')];
 const items=bibliographyItems(value,libraries);
 assert.deepEqual(summary(items),[
  ['bibliography','same','1'],['endnote','endnote:same','2'],['bibliography','endnote:same','3'],
 ]);
 assert.equal(items[1].identifier,'same');
 assert.equal(resolveReference(value,cite('same'),libraries).text,'[1]');
 assert.equal(resolveReference(value,cite('endnote:same'),libraries).text,'[3]');
 const ordinaryRef={type:'tex_reference',command:'ref',keys:['endnote:same'],children:[{text:''}]};
 assert.equal(resolveReference(value,ordinaryRef,libraries).invalid,true,'endnotes must not become label targets');
});

test('duplicate manual/library keys and duplicate note definitions remain unresolved and editable',()=>{
 const m1=manual('duplicate','First'),m2=manual('duplicate','Second');
 const n1=definition('note','First note'),n2=definition('note','Second note');
 const libraries=[{id:'dup',name:'dup.bib',source:'@book{duplicate,title={Library duplicate}}\n@book{good,title={Unique}}'}];
 const value=[p(cite('duplicate'),note('note'),cite('good')),m1,n1,m2,n2];
 const items=bibliographyItems(value,libraries);
 assert.equal(items.filter(item=>item.kind==='bibliography'&&item.key==='duplicate').length,3);
 assert.equal(items.filter(item=>item.kind==='endnote'&&item.identifier==='note').length,2);
 assert.ok(items.filter(item=>item.key==='duplicate'||item.kind==='endnote').every(item=>item.number===''));
 assert.equal(items.find(item=>item.key==='good').number,'1','ambiguous targets must not consume numbers');
 for(const node of [m1,m2,n1,n2])assert.ok(items.some(item=>item.node===node),'every stored duplicate remains in the visible group');
 const resolved=resolveReference(value,cite('duplicate'),libraries);
 assert.equal(resolved.text,'[??]');assert.equal(resolved.invalid,true);assert.deepEqual(resolved.targets,[]);
});

test('unresolved references and missing identifiers do not create phantom rows or consume numbers',()=>{
 const empty=definition(undefined,'Retain invalid legacy data');
 const value=[p(cite('missing'),note('missing'),cite('A')),empty];
 assert.deepEqual(summary(bibliographyItems(value,libs)),[
  ['bibliography','A','1'],['endnote','endnote:',''],
 ]);
 assert.equal(resolveReference(value,cite('missing'),libs).text,'[??]');
});

test('equation/heading label numbers remain independent and endnotes cannot resolve as labels',()=>{
 const equation={type:'inline_equation',display:true,numbered:true,texLabel:'eq:one',texExpression:'x',children:[{text:''}]};
 const value=[{type:'h1',texLabel:'section:one',children:[{text:'Heading'}]},p(cite('A'),note('n'),equation),definition('n','Note')];
 const eqref={type:'tex_reference',command:'eqref',keys:['eq:one'],children:[{text:''}]};
 const ref={type:'tex_reference',command:'ref',keys:['section:one'],children:[{text:''}]};
 assert.equal(resolveReference(value,eqref,libs).text,'(1)');assert.equal(resolveReference(value,ref,libs).text,'1');
 assert.equal(referenceTargets(value,libs).find(item=>item.identifier==='n').number,'2');
});

test('computing the mixed view never mutates stored rich text or library sources',()=>{
 const value=[p(cite('A'),note('n')),definition('n','Rich ',{text:'bold',bold:true},' ',cite('B')),manual('legacy','Old entry')];
 const before=JSON.stringify({value,libs});
 bibliographyItems(value,libs);referenceTargets(value,libs);resolveReference(value,cite('A'),libs);
 assert.equal(JSON.stringify({value,libs}),before);
 assert.equal(value[1].children[0].children[1].bold,true);
});

test('figure/table cross-references follow reorder, numbering switches, duplicates and target deletion',()=>{
 const first=float('figure','figure-a','fig:a'),second=float('figure','figure-b','fig:b'),table=float('table','table-a','tab:a');
 const value=[first,table,second,p(cross('fig:b'),cross('tab:a'))],ref=cross('fig:b');
 assert.equal(resolveReference(value,ref).text,'2');assert.equal(resolveReference(value,cross('tab:a')).text,'1');
 value.splice(0,0,value.splice(2,1)[0]);assert.equal(resolveReference(value,ref).text,'1');assert.equal(resolveReference(value,cross('fig:a')).text,'2');
 second.numbered=false;assert.equal(resolveReference(value,ref).text,'??');assert.equal(resolveReference(value,ref).invalid,true);assert.equal(resolveReference(value,cross('fig:a')).text,'1');
 second.numbered=true;value.push(float('table','duplicate','fig:b'));assert.equal(resolveReference(value,ref).text,'??');assert.equal(resolveReference(value,ref).targets.length,0);
 value.pop();value.splice(value.indexOf(second),1);assert.equal(resolveReference(value,ref).text,'??');assert.equal(resolveReference(value,ref).invalid,true);
 assert.equal(resolveReference(value,cross('tab:a','eqref')).invalid,true,'equation-only references cannot resolve a table');
});

test('label rename plans update ref/eqref recursively and leave citation keys and document data intact',()=>{
 const target=float('figure','target','fig:old'),ordinary=cross('fig:old'),equationStyle=cross('fig:old','eqref'),citation=cite('fig:old');
 const value=[target,p(ordinary,citation),{type:'document_metadata',children:[p(equationStyle)]}],before=JSON.stringify(value);
 const plan=planLabelRename(value,[0],'fig:new');
 assert.deepEqual(plan,[{path:[1,0],keys:['fig:new']},{path:[2,0,0],keys:['fig:new']}]);assert.equal(JSON.stringify(value),before);
 for(const update of plan){let node={children:value};for(const index of update.path)node=node.children[index];node.keys=update.keys;}
 target.texLabel='fig:new';assert.equal(resolveReference(value,ordinary).invalid,false);assert.deepEqual(citation.keys,['fig:old']);
 assert.deepEqual(planLabelRename(value,[0],''),[]);assert.deepEqual(planLabelRename(value,[0],'fig:new'),[]);assert.deepEqual(planLabelRename(value,[0],'bad label'),[]);
});

test('ambiguous old labels are never silently redirected when one duplicate gets renamed',()=>{
 const first=float('figure','one','shared'),second=float('table','two','shared'),value=[first,second,p(cross('shared'))];
 assert.deepEqual(planLabelRename(value,[0],'fig:one'),[]);
 first.texLabel='fig:one';assert.equal(resolveReference(value,cross('shared')).targets[0].node,second);
 delete second.texLabel;assert.equal(resolveReference(value,cross('shared')).text,'??','removing a label leaves an explicit broken reference');
});

test('a label and all planned reference-key updates undo and redo together in a real Plate history batch',()=>{
 const compiledEditor={exports:{}};
 new Function('require','module','exports',buildSync({stdin:{contents:"export {createPlateEditor,ParagraphPlugin,createPlatePlugin} from 'platejs/react';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text)(require,compiledEditor,compiledEditor.exports);
 const {createPlateEditor,ParagraphPlugin,createPlatePlugin}=compiledEditor.exports;
 const editor=createPlateEditor({plugins:[ParagraphPlugin,createPlatePlugin({key:'tex_reference',node:{isElement:true,isInline:true,isVoid:true}})],value:[float('figure','figure','fig:old'),p('See ',cross('fig:old'),' and ',cross('fig:old','eqref'))]});
 editor.tf.withoutSaving(()=>editor.tf.normalize({force:true}));
 const before=JSON.stringify(editor.children),updates=planLabelRename(editor.children,[0],'fig:new');
 editor.tf.withNewBatch(()=>{editor.tf.setNodes({texLabel:'fig:new'},{at:[0]});for(const update of updates)editor.tf.setNodes({keys:update.keys},{at:update.path});});
 assert.equal(resolveReference(editor.children,cross('fig:new')).invalid,false);assert.equal(editor.children[1].children[1].keys[0],'fig:new');
 editor.tf.undo();assert.equal(JSON.stringify(editor.children),before);
 editor.tf.redo();assert.equal(editor.children[0].texLabel,'fig:new');assert.equal(editor.children[1].children[1].keys[0],'fig:new');
});

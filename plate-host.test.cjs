const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const fs=require('node:fs');
const {EditorModel}=require('./editor-model');
test('Plate document / independent MathJax mount integration',async t=>{
 const {Window}=await import('happy-dom');const window=new Window({url:'http://localhost/'});
 window.document.write('<!doctype html><html><body></body></html>');
 for(const key of ['innerWidth','innerHeight','window','document','navigator','sessionStorage','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Document','DocumentFragment','MutationObserver','ResizeObserver','DOMParser','Range','Event','CustomEvent','KeyboardEvent','ClipboardEvent','DOMRect','HTMLDivElement','HTMLSpanElement','NodeFilter','ShadowRoot'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
 globalThis.getComputedStyle=window.getComputedStyle.bind(window);globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);
 await build({entryPoints:['src/plate-host.tsx'],bundle:true,platform:'node',format:'cjs',outfile:'.plate-test.cjs',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'test-kit',setup(b){b.onLoad({filter:/components[\\/]editor[\\/]editor-kit\.tsx$/},()=>({contents:`import {ParagraphPlugin} from 'platejs/react';import {MathKit} from './plugins/math-kit';import {MarkdownKit} from './plugins/markdown-kit';import {ReferenceKit} from './plugins/reference-kit';export const EditorKit=[ParagraphPlugin,...MathKit,...ReferenceKit,...MarkdownKit];`,loader:'tsx',resolveDir:require('node:path').resolve('src/components/editor')}))}}]});
 const {PlateMathHost}=require('./.plate-test.cjs');fs.unlinkSync('.plate-test.cjs');
 const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
 function setup(){sessionStorage.clear();const mount=document.createElement('div');document.body.append(mount);const activations=[];const flow=new PlateMathHost(mount,new EditorModel(),{activate:(...args)=>activations.push(args),leave(){},change(){}});return {flow,editor:flow.editor,activations};}
 await t.test('math edits persist and restore as editable trees',async()=>{
  const {flow,editor,activations}=setup();const entry=flow.insertFormula();entry.model.replaceInput(0,0,'z^2');flow.persist();await tick();
  assert.equal(flow.entries().length,2);assert.ok(activations.length);assert.match(flow.exportMarkdown(),/\{z\}\^\{2\}/);
  const saved=JSON.parse(sessionStorage.getItem('math-plate-document-v1'));assert.equal(saved.value[0].children.filter(n=>n.type==='inline_equation').length,2);
  assert.equal(editor.children[0].children.find(n=>n.id===entry.element.dataset.mathId).texExpression,'{z}^{2}');flow.destroy();
 });
 await t.test('document undo and redo restore the math model without reapplying stale edits',async()=>{
  const {flow,editor}=setup();const entry=flow.entries()[0],before=entry.model.exportLatex();entry.model.setCursor(entry.model.root.id,entry.model.root.items.length);entry.model.replaceInput(entry.model.cursor.offset,entry.model.cursor.offset,'+z');flow.persist();await tick();
  editor.tf.undo();await tick();assert.equal(flow.entries()[0].model.exportLatex(),before);
  editor.tf.redo();await tick();assert.equal(flow.entries()[0].model.exportLatex(),before+'+z');flow.destroy();
 });
 await t.test('React keeps MathJax DOM and Slate void children independent',async()=>{
  const {flow,editor}=setup();const element=flow.entries()[0].element;const rendered=document.createElement('mjx-container');rendered.textContent='rendered math';element.replaceChildren(rendered);
  editor.tf.select(editor.api.end([]));editor.tf.insertText('正文');await tick();
  assert.equal(element.firstChild,rendered);assert.ok(element.closest('[data-slate-node="element"]').querySelector('[data-slate-node="text"]'));flow.destroy();
 });
 await t.test('copying a formula creates an independent identity and math model',async()=>{
  const {flow,editor}=setup();const node=editor.children[0].children.find(n=>n.type==='inline_equation');editor.tf.select(editor.api.end([]));editor.tf.insertNodes(JSON.parse(JSON.stringify(node)));await tick();
  const entries=flow.entries();assert.equal(entries.length,2);assert.notEqual(entries[0].element.dataset.mathId,entries[1].element.dataset.mathId);assert.notEqual(entries[0].model,entries[1].model);assert.equal(entries[0].model.exportLatex(),entries[1].model.exportLatex());flow.destroy();
 });
 await t.test('inline/display conversion preserves surrounding prose and numbering can be undone',async()=>{
  const {flow,editor}=setup();const before=flow.entries()[0].model.exportLatex();flow.setDisplay(flow.entries()[0].element,true);await tick();
  assert.ok(flow.entries()[0].element.dataset.display==='true');assert.equal(flow.entries()[0].model.exportLatex(),before);assert.match(flow.exportMarkdown(),/在这里输入正文/);assert.match(flow.exportMarkdown(),/可以继续输入/);
  flow.setNumbered(flow.entries()[0].element,false);await tick();assert.equal(flow.entries()[0].element.dataset.numbered,'false');editor.tf.undo();await tick();assert.equal(flow.entries()[0].element.dataset.numbered,'true');
  flow.setDisplay(flow.entries()[0].element,false);await tick();assert.equal(flow.entries()[0].model.exportLatex(),before);flow.destroy();
 });
 await t.test('inserting while editing math stays beside that formula without focusing prose',async()=>{
  const {flow,editor,activations}=setup();const original=flow.entries()[0];
  let proseFocus=0;editor.tf.focus=()=>{proseFocus++;};
  flow.enter(original.element,'end');const added=flow.insertFormula();
  added.model.replaceInput(0,0,'k');flow.persist();await tick();
  const children=editor.children[0].children;
  const oldIndex=children.findIndex(n=>n.id===original.element.dataset.mathId);
  const newIndex=children.findIndex(n=>n.id===added.element.dataset.mathId);
  assert.ok(newIndex>oldIndex);assert.equal(proseFocus,0);
  assert.equal(activations.at(-1)[0],added.element);
  assert.equal(added.model.exportLatex(),'k');flow.destroy();
 });
 await t.test('math activation releases Slate focus before handing off input',async()=>{
  const {flow,editor}=setup();
  const input=document.createElement('textarea');document.body.append(input);
  editor.tf.focus({at:editor.api.end([])});await tick();
  assert.equal(editor.api.isFocused(),true);
  flow.hooks.activate=()=>{
   assert.equal(editor.api.isFocused(),false,'Slate must release focus before the math textarea gains it');
   input.focus();
  };
  const added=flow.insertFormula();added.model.replaceInput(0,0,'3');flow.persist();await tick();
  assert.equal(editor.api.isFocused(),false);
  assert.equal(document.activeElement,input);
  flow.destroy();input.remove();
 });
 await t.test('selected text becomes editable math with the cursor at its end',async()=>{
  const {flow,editor,activations}=setup();
  editor.tf.setValue([{type:'p',children:[{text:'before x^2 after'}]}]);
  editor.tf.select({anchor:{path:[0,0],offset:7},focus:{path:[0,0],offset:10}});
  const added=flow.insertFormula(false,editor.api.string(editor.selection));await tick();
  assert.match(added.model.exportLatex(),/\^\{2\}/);
  assert.equal(activations.at(-1)[2],'end');
  assert.equal(added.model.cursor.offset,added.model.root.items.length);
  assert.equal(editor.api.string([]),'before  after');
  flow.destroy();
 });
 await t.test('Markdown preserves equation numbering and reimports structural math',async()=>{
  const {flow,editor}=setup();const node=flow.insertFormula(true);node.model.replaceInput(0,0,'q^2');flow.persist();await tick();
  const markdown=flow.exportMarkdown();assert.match(markdown,/numbered/,markdown);
  const nodes=editor.api.markdown.deserialize(markdown);const equation=nodes.find(n=>n.type==='equation');assert.ok(equation,JSON.stringify({markdown,nodes}));assert.equal(equation.numbered,true);assert.equal(equation.texExpression,'{q}^{2}');flow.destroy();
 });
 await t.test('display math inserts and exits within one paragraph; layout toggles preserve prose',async()=>{
  const {flow,editor}=setup();
  const before=editor.children.length,first=flow.entries()[0];
  flow.setDisplay(first.element,true);await tick();
  assert.equal(editor.children.length,before);
  assert.equal(editor.children[0].children.find(n=>n.id===first.element.dataset.mathId).display,true);
  flow.exit(flow.entries()[0].element,1,false);
  assert.equal(editor.selection.anchor.path[0],0);
  const added=flow.insertFormula(true);await tick();
  assert.equal(editor.children.length,before);
  assert.equal(editor.children[0].children.find(n=>n.id===added.element.dataset.mathId).display,true);
  flow.setDisplay(added.element,false);await tick();
  assert.equal(editor.children.length,before);
  assert.match(flow.exportLatex(),/在这里输入正文/);assert.match(flow.exportLatex(),/可以继续输入/);
  const saved=JSON.parse(sessionStorage.getItem('math-plate-document-v1'));
  assert.equal(saved.value[0].children.find(n=>n.id===first.element.dataset.mathId).display,true);
  flow.destroy();
 });
 await t.test('display boundaries remain editable text positions without creating paragraphs',async()=>{
  const {flow,editor}=setup();
  const first=flow.insertFormula(true,'x=1'),second=flow.insertFormula(true,'y=2');await tick();
  const count=editor.children.length;
  flow.exit(first.element,1);await tick();
  const point=editor.selection.anchor;
  assert.equal(editor.api.node(point.path)[0].text,'');
  const empty=first.element.closest('.math-block-node').nextElementSibling;
  assert.equal(empty.dataset.emptyText,'true');
  editor.tf.insertText('explanation');await tick();
  assert.equal(editor.api.node(point.path)[0].text,'explanation');
  assert.equal(first.element.closest('.math-block-node').nextElementSibling.dataset.emptyText,undefined);
  assert.equal(editor.children.length,count);
  editor.tf.select({anchor:point,focus:{...point,offset:11}});editor.tf.delete();await tick();
  assert.equal(first.element.closest('.math-block-node').nextElementSibling.dataset.emptyText,'true');
  assert.equal(flow.entries().find(e=>e.element===second.element).model.exportLatex(),'y=2');
  assert.equal(editor.children.length,count);flow.destroy();
 });
 await t.test('opening a JSON document replaces content, retains math and clears old undo history',async()=>{
  const {flow,editor}=setup();
  const old=flow.serializeDocument();
  const formula=JSON.parse(JSON.stringify(editor.children[0].children.find(n=>n.type==='inline_equation')));
  const model=new EditorModel();model.replaceInput(0,0,'z^2');formula.snapshot=model.snapshot();formula.texExpression=model.exportLatex();
  flow.openDocument(JSON.stringify({version:1,value:[{type:'p',children:[{text:'Opened document '},formula,{text:''}]}]}));await tick();
  assert.equal(editor.children.length,1);assert.match(flow.exportLatex(),/Opened document/);assert.doesNotMatch(flow.exportLatex(),/在这里/);
  assert.equal(flow.entries()[0].model.exportLatex(),model.exportLatex());
  assert.equal(editor.history.undos.length,0);assert.equal(flow.hasUnsavedChanges(),false);
  assert.equal(sessionStorage.getItem('math-plate-document-v1-before-open'),old);
  flow.destroy();
 });
 await t.test('invalid opened documents cannot replace existing prose or formulas',async()=>{
  const {flow}=setup();const before=flow.serializeDocument();
  for(const bad of ['bad',JSON.stringify({version:2,value:[]}),JSON.stringify({version:1,value:[{text:'invalid root'}]})]){
    assert.throws(()=>flow.openDocument(bad));assert.equal(flow.serializeDocument(),before);
  }
  flow.destroy();
 });
 await t.test('saved state tracks edits but ignores math cursor movements',async()=>{
  const {flow,editor}=setup();flow.markDocumentSaved(flow.serializeDocument());
  const entry=flow.entries()[0];entry.model.setCursor(entry.model.root.id,0);flow.persist();assert.equal(flow.hasUnsavedChanges(),false);
  editor.tf.select(editor.api.end([]));editor.tf.insertText('edited');await tick();assert.equal(flow.hasUnsavedChanges(),true);
  const saved=flow.serializeDocument();flow.markDocumentSaved(saved);assert.equal(flow.hasUnsavedChanges(),false);
  editor.tf.insertText('more');await tick();flow.markDocumentSaved(saved);assert.equal(flow.hasUnsavedChanges(),true);
  flow.destroy();
 });
 await t.test('attached BibTeX sources stay in session while native files and drafts capture only cited entries',async()=>{
  const {flow,editor}=setup();flow.markDocumentSaved(flow.serializeDocument());
  const library={id:'papers',name:'Papers.bib',source:'@article{cited,title={Cited title},author={Writer, One},year={2026}}\n@book{later,title={Later title}}\n@book{unused,title={UNUSED_PRIVATE_ENTRY}}'};
  flow.setBibliographyLibraries([library]);await tick();
  assert.equal(flow.hasUnsavedChanges(),false,'attaching uncited sources does not alter native content');
  assert.equal(JSON.parse(flow.serializeDocument()).bibliographyLibraries,undefined);
  const ref=keys=>({type:'tex_reference',command:'cite',keys,children:[{text:''}]});
  editor.tf.select(editor.api.end([]));editor.tf.insertNodes(ref(['cited']));await tick();
  assert.equal(flow.hasUnsavedChanges(),true);
  const saved=flow.serializeDocument(),draft=sessionStorage.getItem('math-plate-document-v1');
  for(const source of [saved,draft]){
   const libraries=JSON.parse(source).bibliographyLibraries;
   assert.equal(libraries.length,1);assert.match(libraries[0].source,/Cited title/);
   assert.doesNotMatch(source,/UNUSED_PRIVATE_ENTRY|Later title/);
  }
  assert.equal(flow.getBibliographyLibraries()[0].source,library.source,'saving must not narrow the session source');
  flow.markDocumentSaved(saved);editor.tf.insertText(' ');editor.tf.insertNodes(ref(['later']));await tick();
  assert.match(flow.serializeDocument(),/Later title/);assert.doesNotMatch(flow.serializeDocument(),/UNUSED_PRIVATE_ENTRY/);
  assert.match(flow.exportMarkdown(),/\\bibitem\{cited\}/);assert.match(flow.exportMarkdown(),/\\bibitem\{later\}/);assert.doesNotMatch(flow.exportMarkdown(),/UNUSED_PRIVATE_ENTRY/);
  flow.destroy();
  const mount=document.createElement('div');document.body.append(mount);
  const restored=new PlateMathHost(mount,new EditorModel(),{activate(){},leave(){},change(){}});await tick();
  assert.match(restored.getBibliographyLibraries()[0].source,/Cited title/);assert.match(restored.getBibliographyLibraries()[0].source,/Later title/);
  assert.doesNotMatch(restored.getBibliographyLibraries()[0].source,/UNUSED_PRIVATE_ENTRY/);restored.destroy();
 });
 await t.test('BibTeX citation resolution, generated bibliography and source updates react without changing prose',async()=>{
  const {flow,editor}=setup();
  editor.tf.setValue([{type:'p',children:[{text:'Cite '},{type:'tex_reference',command:'cite',keys:['2026:论文'],children:[{text:''}]},{text:''}]}]);await tick();
  const prose=JSON.stringify(editor.children);assert.equal(flow.mount.querySelector('[role="link"]').textContent,'[??]');
  let changes=0;const unsubscribe=flow.subscribeBibliography(()=>changes++);
  flow.setBibliographyLibraries([{id:'papers',name:'Papers.bib',source:'@book{2026:论文,title={First title}}\n@book{unused,title={Hidden title}}'}]);await tick();
  assert.equal(JSON.stringify(editor.children),prose);assert.equal(changes,1);
  assert.equal(flow.mount.querySelector('[role="link"]').textContent,'[1]');
  const row=flow.mount.querySelector('[id="bibtex-'+encodeURIComponent('2026:论文')+'"]');assert.ok(row);assert.match(row.textContent,/First title/);
  assert.doesNotMatch(flow.mount.querySelector('.bibtex-bibliography').textContent,/Hidden title/);
  let jumped=false;row.scrollIntoView=()=>{jumped=true;};
  flow.mount.querySelector('[role="link"]').dispatchEvent(new window.MouseEvent('click',{bubbles:true,button:0,ctrlKey:true}));assert.equal(jumped,true);
  flow.setBibliographyLibraries([{id:'papers',name:'Papers.bib',source:'@book{2026:论文,title={Updated title}}'}]);await tick();
  assert.match(flow.mount.querySelector('.bibtex-bibliography').textContent,/Updated title/);assert.equal(changes,2);
  unsubscribe();flow.setBibliographyLibraries([]);await tick();assert.equal(changes,2);assert.equal(flow.mount.querySelector('[role="link"]').textContent,'[??]');
  assert.equal(flow.mount.querySelector('.bibtex-bibliography'),null);flow.destroy();
 });
 await t.test('invalid or duplicate libraries never replace existing body or attached citation data',async()=>{
  const {flow,editor}=setup();
  flow.setBibliographyLibraries([{id:'papers',name:'Papers.bib',source:'@book{a,title={Kept}}'}]);
  const source=flow.serializeDocument(),attached=flow.getBibliographyLibraries();
  assert.throws(()=>flow.setBibliographyLibraries([{id:'bad',name:'Bad.bib',source:'@book{broken,title='}]));
  assert.equal(flow.getBibliographyLibraries(),attached);assert.equal(flow.serializeDocument(),source);
  const invalid=JSON.parse(source);invalid.bibliographyLibraries=[{id:'bad',name:'Bad.bib',source:'@book{broken,title='}];
  assert.throws(()=>flow.openDocument(JSON.stringify(invalid)));assert.equal(flow.serializeDocument(),source);assert.equal(flow.getBibliographyLibraries(),attached);
  editor.tf.insertNodes({type:'bibliography_entry',citeKey:'manual',children:[{text:'Manual entry'}]},{at:[editor.children.length]});await tick();
  assert.throws(()=>flow.setBibliographyLibraries([{id:'conflict',name:'Conflict.bib',source:'@book{manual,title={Duplicate}}'}]));
  assert.equal(flow.getBibliographyLibraries(),attached);flow.destroy();
 });
 await t.test('citation undo and redo update embedded snapshots while retaining attached source choices',async()=>{
  const {flow,editor}=setup();flow.setBibliographyLibraries([{id:'papers',name:'Papers.bib',source:'@book{a,title={Title A}}\n@book{b,title={Title B}}'}]);
  editor.tf.select(editor.api.end([]));editor.tf.withNewBatch(()=>editor.tf.insertNodes({type:'tex_reference',command:'cite',keys:['a'],children:[{text:''}]}));await tick();
  assert.match(flow.serializeDocument(),/Title A/);assert.doesNotMatch(flow.serializeDocument(),/Title B/);
  editor.tf.undo();await tick();assert.equal(JSON.parse(flow.serializeDocument()).bibliographyLibraries,undefined);assert.match(flow.getBibliographyLibraries()[0].source,/Title B/);
  editor.tf.redo();await tick();assert.match(flow.serializeDocument(),/Title A/);assert.doesNotMatch(flow.serializeDocument(),/Title B/);flow.destroy();
 });
 await t.test('pasted bibliography duplicates remain diagnosable and saved documents can still reopen',async()=>{
  const {flow,editor}=setup();flow.setBibliographyLibraries([{id:'papers',name:'Papers.bib',source:'@book{a,title={Library title}}'}]);
  editor.tf.setValue([{type:'p',children:[{text:'See '},{type:'tex_reference',command:'cite',keys:['a'],children:[{text:''}]},{text:''}]}]);await tick();
  assert.equal(flow.mount.querySelector('[role="link"]').textContent,'[1]');
  editor.tf.insertNodes({type:'bibliography_entry',citeKey:'a',children:[{text:'Pasted manual title'}]},{at:[editor.children.length]});await tick();
  assert.equal(flow.mount.querySelector('[role="link"]').textContent,'[??]');
  const saved=flow.serializeDocument();assert.match(saved,/Library title/);assert.match(saved,/Pasted manual title/);
  flow.openDocument(saved);await tick();assert.equal(flow.mount.querySelector('[role="link"]').textContent,'[??]');
  assert.match(flow.serializeDocument(),/Library title/);assert.match(flow.serializeDocument(),/Pasted manual title/);flow.destroy();
 });
 await t.test('reference nodes render, renumber on changes and survive undo and file opening',async()=>{
  const {flow,editor}=setup();
  const initial=editor.children[0].children.find(n=>n.type==='inline_equation');
  const formula={...initial,display:true,numbered:true,texLabel:'eq:a'};
  const ref={type:'tex_reference',id:'ref-a',command:'eqref',keys:['eq:a'],children:[{text:''}]};
  const value=[{type:'p',children:[{text:''},formula,{text:' See '},ref,{text:''}]},{type:'bibliography_entry',citeKey:'paper',children:[{text:'Author. Title.'}]}];
  flow.openDocument(JSON.stringify({version:1,value}));await tick();
  assert.equal(flow.mount.querySelector('[role="link"]').textContent,'(1)');
  editor.tf.insertNodes({type:'p',children:[{text:''},{...formula,id:'earlier',texLabel:'eq:b'},{text:''}]},{at:[0]});await tick();
  assert.equal(flow.mount.querySelector('[role="link"]').textContent,'(2)');
  editor.tf.undo();await tick();assert.equal(flow.mount.querySelector('[role="link"]').textContent,'(1)');
  const md=flow.exportMarkdown();assert.ok(md.includes('eqref'));assert.ok(md.includes('bibitem'));assert.ok(md.includes('eq:a'));
  const saved=flow.serializeDocument();flow.openDocument(saved);await tick();assert.equal(flow.mount.querySelector('[role="link"]').textContent,'(1)');
  editor.tf.setNodes({numbered:false},{at:[0,1]});await tick();assert.equal(flow.mount.querySelector('[role="link"]').textContent,'(??)');
  flow.destroy();
 });
 await t.test('typing a closing brace converts TeX references as one undoable operation',async()=>{
  const {flow,editor}=setup();
  editor.tf.setValue([{type:'p',children:[{text:'See \\cite{paper'}]}]);editor.tf.select(editor.api.end([]));
  let prevented=false;flow.keyDown({key:'}',nativeEvent:{isComposing:false},preventDefault(){prevented=true;}});await tick();
  assert.equal(prevented,true);assert.equal(editor.children[0].children[1].type,'tex_reference');
  assert.deepEqual(editor.children[0].children[1].keys,['paper']);
  editor.tf.undo();await tick();assert.equal(editor.children[0].children[0].text,'See \\cite{paper');
  flow.destroy();
 });
 await t.test('typed citations accept numeric Unicode keys without broadening label syntax',async()=>{
  const {flow,editor}=setup();
  editor.tf.setValue([{type:'p',children:[{text:'\\cite{2026:论文'}]}]);editor.tf.select(editor.api.end([]));
  let prevented=false;flow.keyDown({key:'}',nativeEvent:{isComposing:false},preventDefault(){prevented=true;}});await tick();
  assert.equal(prevented,true);assert.deepEqual(editor.children[0].children[1].keys,['2026:论文']);
  editor.tf.setValue([{type:'p',children:[{text:'\\label{2026:论文'}]}]);editor.tf.select(editor.api.end([]));prevented=false;
  flow.keyDown({key:'}',nativeEvent:{isComposing:false},preventDefault(){prevented=true;}});assert.equal(prevented,false);flow.destroy();
 });
 await t.test('reference and citation clicks distinguish the selected node from its empty trailing text',async()=>{
  for(const command of ['eqref','ref','cite']){
   const {flow,editor}=setup();
   editor.tf.setValue([{type:'p',children:[{text:'See '},{type:'tex_reference',command,keys:['target'],children:[{text:''}]},{text:''}]}]);await tick();
   editor.tf.focus({at:editor.api.end([])});await tick();
   const link=document.querySelector('.tex-reference-content');
   link.getBoundingClientRect=()=>({left:10,right:50,top:0,bottom:20,width:40,height:20});
   link.dispatchEvent(new window.MouseEvent('click',{bubbles:true,clientX:30,button:0}));await tick();
   assert.deepEqual(editor.selection.anchor.path,[0,1,0]);
   assert.equal(link.closest('.tex-reference').dataset.referenceSelected,'true');
   link.dispatchEvent(new window.MouseEvent('click',{bubbles:true,clientX:49,button:0}));await tick();
   assert.deepEqual(editor.selection.anchor.path,[0,2]);assert.equal(editor.selection.anchor.offset,0);
   assert.equal(link.closest('.tex-reference').dataset.referenceSelected,'false');
   editor.tf.insertText('after');assert.equal(editor.children[0].children[2].text,'after');
   flow.destroy();
  }
 });
 await t.test('formula and reference deletion selects first, ignores repeats, then deletes with undo',async()=>{
  const objects=[
   {type:'inline_equation',texExpression:'x',numbered:true,children:[{text:''}]},
   {type:'inline_equation',display:true,texExpression:'x',numbered:true,children:[{text:''}]},
   ...['eqref','ref','cite'].map(command=>({type:'tex_reference',command,keys:['target'],children:[{text:''}]}))
  ];
  for(const object of objects)for(const key of ['Backspace','Delete']){
   const {flow,editor}=setup();editor.tf.setValue([{type:'p',children:[{text:'A'},object,{text:'B'}]}]);await tick();
   editor.tf.focus({at:{path:[0,key==='Backspace'?2:0],offset:key==='Backspace'?0:1}});await tick();
   const before=JSON.stringify(editor.children);let prevented=false;
   const event={key,repeat:false,nativeEvent:{isComposing:false},preventDefault(){prevented=true;}};
   flow.keyDown(event);await tick();assert.equal(prevented,true);assert.equal(JSON.stringify(editor.children),before);
   assert.deepEqual(editor.selection,{anchor:{path:[0,0],offset:1},focus:{path:[0,2],offset:0}});
   flow.keyDown({...event,repeat:true});assert.equal(JSON.stringify(editor.children),before);
   flow.keyDown(event);await tick();assert.equal(editor.children[0].children.length,1);assert.equal(editor.children[0].children[0].text,'AB');
   editor.tf.undo();await tick();assert.equal(JSON.stringify(editor.children),before);flow.destroy();
  }
 });
 await t.test('Backspace in an empty formula selects the document object before removing it',async()=>{
  const {flow,editor}=setup();const entry=flow.insertFormula();await tick();
  const before=flow.entries().length;flow.removeEmpty(entry.element);await tick();assert.equal(flow.entries().length,before);
  assert.equal(entry.element.closest('[data-formula-selected]').dataset.formulaSelected,'true');
  flow.keyDown({key:'Backspace',repeat:false,nativeEvent:{isComposing:false},preventDefault(){}});await tick();
  assert.equal(flow.entries().length,before-1);flow.destroy();
 });
 await window.happyDOM.abort();
});

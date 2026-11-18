const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');

const compiled=build({stdin:{contents:"export {createMathTreeView} from './src/math-tree-view';export {EditorModel} from './src/editor-model';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'treeAPI',metafile:true}).then(result=>({source:result.outputFiles[0].text,inputs:result.metafile.inputs}));
const plain=value=>JSON.parse(JSON.stringify(value));
async function fixture(t){
  const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
  window.localStorage.setItem('editor.locale','en');window.eval((await compiled).source+'\nwindow.treeAPI=treeAPI;');
  const container=window.document.createElement('div');window.document.body.append(container);
  const {EditorModel,createMathTreeView}=window.treeAPI;
  const model=new EditorModel();model.root.items=[];model.index();model.setCursor(model.root.id,0);
  const view=createMathTreeView(container);t.after(async()=>{view.dispose();await window.happyDOM.abort();});
  const region=id=>container.querySelector('[data-region-id="'+id+'"]');
  const node=id=>container.querySelector('[data-node-id="'+id+'"]');
  return {window,container,model,view,region,node,EditorModel,createMathTreeView};
}

test('tree component has no editor-rendering, React, Plate or LaTeX parser runtime dependency',async()=>{
  const {inputs}=await compiled;
  const imports=inputs['src/math-tree-view.ts'].imports;
  assert.deepEqual(imports.map(item=>item.path),['src/i18n.ts']);
  assert.equal(imports.some(item=>/editor-model|tex-|plate|react/.test(item.path)),false);
});

test('shows the live nested model and real item indices without exporting or reparsing LaTeX',async t=>{
  const h=await fixture(t),{model,view,container}=h;
  model.insert('ab😀中');model.setCursor(model.root.id,2);model.insertStructure('frac');
  const fraction=model.root.items[2];model.insertStructure('sqrt');model.insert('x');
  model.setCursor(fraction.regions[1].id,0);model.insert('y');
  const before=model.snapshot(),undo=Array.from(model.undoStack);
  model.exportLatex=()=>{throw Error('The view must never derive a tree from LaTeX');};
  view.update(model);
  assert.equal(container.querySelectorAll('.math-tree-region').length,model.regions.size);
  assert.equal(container.querySelectorAll('.math-tree-node').length,model.nodes.size);
  assert.equal(h.node(fraction.id).dataset.nodeType,'frac');
  assert.equal(h.region(fraction.regions[0].id).closest('[data-node-id]').dataset.nodeId,fraction.id);
  const rootRows=[...container.querySelectorAll('[data-item-region="'+model.root.id+'"]')];
  assert.deepEqual(rootRows.map(row=>[row.dataset.itemStart,row.dataset.itemEnd]),[['0','2'],['2','3'],['3','5']]);
  assert.equal(rootRows[0].querySelector('.math-tree-value').textContent,'"ab"');
  assert.equal(rootRows[2].querySelector('.math-tree-value').textContent,'"😀中"');
  assert.match(rootRows[0].querySelector('.math-tree-index').textContent,/items\[0…1\]/);
  assert.deepEqual(JSON.parse(container.querySelector('.math-tree-raw').textContent),JSON.parse(before).root);
  assert.equal(model.snapshot(),before);assert.deepEqual(Array.from(model.undoStack),undo);
});

test('cursor and selection updates retain tree/JSON DOM nodes and update only position markings',async t=>{
  const h=await fixture(t),{model,view,container}=h;
  model.insert('ab');model.insertStructure('frac');const fraction=model.root.items[2];
  model.setCursor(model.root.id,3);model.insert('cd');
  let snapshots=0;const snapshot=model.snapshot.bind(model);model.snapshot=()=>{snapshots++;return snapshot();};
  view.update(model);
  const tree=container.querySelector('.math-tree-content'),elements=[...tree.querySelectorAll('*')];
  const raw=container.querySelector('.math-tree-raw'),rawText=raw.firstChild;
  model.setCursor(model.root.id,4,1);view.update(model);
  assert.equal(snapshots,1,'Moving the cursor does not regenerate the snapshot JSON');
  assert.deepEqual([...tree.querySelectorAll('*')],elements);assert.equal(raw.firstChild,rawText);
  assert.ok(h.region(model.root.id).classList.contains('math-tree-active-region'));
  assert.equal(h.region(model.root.id).getAttribute('aria-current'),'true');
  const selected=[...container.querySelectorAll('.math-tree-selected')];
  assert.deepEqual(selected.map(row=>[row.dataset.selectionStart,row.dataset.selectionEnd]),[['1','2'],['2','3'],['3','4']]);
  assert.equal(container.querySelector('.math-tree-current-item').dataset.cursorOffset,'4');
  assert.match(container.querySelector('.math-tree-cursor').textContent,/offset 4, anchor 1/);
  assert.equal(container.querySelector('.math-tree-selection').textContent,'Selection: [1, 4)');
  model.setCursor(fraction.regions[0].id,0);view.update(model);
  assert.equal(snapshots,1);assert.equal(h.region(model.root.id).classList.contains('math-tree-active-region'),false);
  assert.ok(h.region(fraction.regions[0].id).classList.contains('math-tree-active-region'));
  assert.equal(container.querySelectorAll('.math-tree-selected').length,0);
  assert.equal(container.querySelectorAll('.math-tree-current-item').length,0,'An empty region has no invented item');
  assert.equal(container.querySelector('.math-tree-selection').textContent,'No selection');
  assert.deepEqual([...tree.querySelectorAll('*')],elements);
});

test('content changes refresh the live tree but preserve region/node and JSON expansion state',async t=>{
  const h=await fixture(t),{model,view,container}=h;
  model.insertStructure('frac');const fraction=model.root.items[0];model.insert('x');view.update(model);
  h.node(fraction.id).open=false;h.region(fraction.regions[0].id).open=false;
  h.region(model.root.id).open=false;container.querySelector('.math-tree-json').open=true;
  const before=h.node(fraction.id);model.insert('+1');view.update(model);
  assert.notEqual(h.node(fraction.id),before);
  assert.equal(h.node(fraction.id).open,false);assert.equal(h.region(fraction.regions[0].id).open,false);
  assert.equal(h.region(model.root.id).open,false);assert.equal(container.querySelector('.math-tree-json').open,true);
  assert.match(h.region(fraction.regions[0].id).textContent,/"x\+1"/);
  assert.deepEqual(JSON.parse(container.querySelector('.math-tree-raw').textContent),JSON.parse(model.snapshot()).root);
  model.root.label='Updated region label';view.update(model);
  assert.match(h.region(model.root.id).querySelector('.math-tree-label').textContent,/Updated region label/);
  assert.equal(h.region(model.root.id).open,false);
});

test('shows only metadata actually present on nodes and regions',async t=>{
  const h=await fixture(t),{model,view}=h;
  model.insertStructure('matrix');const matrix=model.root.items[0];
  model.setCursor(model.root.id,1);model.insertStructure('sum');const sum=model.root.items[1];
  model.ensureOperatorScript(sum,'upper');model.insert('N');
  // The model currently stores placement mostly in the structure type. A
  // concrete future/extension field is shown only when it really exists.
  sum.operatorPlacement='\\limits';
  view.update(model);
  const matrixMetadata=h.node(matrix.id).querySelector('summary > .math-tree-metadata').textContent;
  assert.match(matrixMetadata,/rows: 2/);assert.match(matrixMetadata,/columns: 2/);
  const sumMetadata=h.node(sum.id).querySelector('summary > .math-tree-metadata').textContent;
  assert.match(sumMetadata,/operatorLayout: true/);assert.match(sumMetadata,/operatorPlacement:/);
  assert.doesNotMatch(matrixMetadata,/operatorPlacement/);
  const slot=sum.regions.find(region=>region.slot==='upper');assert.ok(slot);
  assert.match(h.region(slot.id).querySelector('.math-tree-metadata').textContent,/slot: "upper"/);
});

test('opaque source, CJK and hostile markup remain selectable plain text',async t=>{
  const h=await fixture(t),{model,view,container}=h;
  const source='\\unknown{中文}\n<script>alert("no")</script><img src=x onerror=alert(1)>&';
  model.insertSourceTex(source);model.root.label='<svg onload=alert(1)>区域';
  view.update(model);
  assert.equal(container.querySelector('script,img,svg,iframe'),null);
  const value=container.querySelector('.math-tree-value');assert.equal(value.textContent,JSON.stringify(source));
  assert.match(container.textContent,/中文/);assert.match(container.textContent,/unknown/);
  assert.deepEqual(JSON.parse(container.querySelector('.math-tree-raw').textContent),JSON.parse(model.snapshot()).root);
  assert.equal(container.querySelector('.math-tree-raw').tabIndex,0);
  assert.equal(container.querySelector('[contenteditable]'),null,'Inspection does not expose a second editor');
  assert.equal(model.root.items[0].regions[0].items.join(''),source);
});

test('empty tree, independent instances and disposal leave caller-owned DOM alone',async t=>{
  const h=await fixture(t),{model,view,container}=h;
  const sentinel=h.window.document.createElement('span');sentinel.textContent='owned by caller';container.prepend(sentinel);
  view.update(model);assert.equal(container.querySelector('.math-tree-empty').textContent,'Empty region');
  assert.equal(h.region(model.root.id).open,true);assert.equal(container.querySelector('.math-tree-json').open,false);
  const otherContainer=h.window.document.createElement('div');container.after(otherContainer);
  const other=h.createMathTreeView(otherContainer);other.update(model);t.after(()=>other.dispose());
  const originalOther=otherContainer.innerHTML;model.insert('x');view.update(model);
  assert.equal(otherContainer.innerHTML,originalOther);
  view.dispose();view.dispose();view.update(model);
  assert.deepEqual([...container.children],[sentinel]);assert.equal(otherContainer.querySelectorAll('.math-tree-view').length,1);
});

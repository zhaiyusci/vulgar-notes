const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const vm=require('node:vm');
const module_={exports:{}};
const bundled=buildSync({stdin:{contents:"export {EditorModel,catalog} from './src/editor-model';export {importMath} from './src/tex-import';",resolveDir:process.cwd(),sourcefile:'math-fragment-test.ts'},bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text;
vm.runInNewContext(bundled,{module:module_,exports:module_.exports});
const {EditorModel,catalog,importMath}=module_.exports;
const plain=value=>JSON.parse(JSON.stringify(value));
const blank=()=>{const model=new EditorModel();model.root.items=[];model.index();model.setCursor(model.root.id,0);return model;};
const parsed=tex=>{const model=importMath(tex);assert.ok(model,tex);return model;};
const fromSelection=model=>{const copy=new EditorModel();copy.restore(model.selectionSnapshot());return copy;};
const ids=region=>{const result=[region.id];for(const item of region.items)if(typeof item!=='string'){result.push(item.id);for(const child of item.regions)result.push(...ids(child));}return result;};
const semantic=region=>region.items.map(item=>typeof item==='string'?item:{type:item.type,atom:item.atom,operatorLayout:item.operatorLayout,rows:item.rows,columns:item.columns,regions:item.regions.map(r=>({slot:r.slot,items:semantic(r)}))});

test('a selected nested structure copies its original tree and readable LaTeX',()=>{
  const source=parsed('a+\\frac{\\sqrt[3]{x+1}}{b+c_i}+z');
  source.setCursor(source.root.id,3,2);
  const before=source.snapshot(),snapshot=source.selectionSnapshot();
  assert.equal(source.selectionLatex(),'\\frac{\\sqrt[3]{x+1}}{b+{c}_{i}}');
  assert.equal(source.snapshot(),before,'Copy must not alter content, cursor, or history');
  assert.equal(source.undoStack.length,0);
  const copied=new EditorModel();copied.restore(snapshot);
  assert.equal(copied.root.items.length,1);
  assert.deepEqual(plain(semantic(copied.root)),plain(semantic({items:[source.root.items[2]]})));
  assert.equal(copied.exportLatex(),source.selectionLatex());
});

test('repeated and cross-document paste allocates independent IDs and objects',()=>{
  const source=parsed('\\frac{\\sqrt{x}}{y_i}');source.setCursor(source.root.id,1,0);
  const fragment=fromSelection(source),sourceIds=new Set(ids(source.root)),original=fragment.snapshot();
  const destination=blank();destination.replaceFragment(fragment.root.items);
  const first=destination.root.items[0];
  destination.replaceFragment(fragment.root.items);
  const second=destination.root.items[1],destinationIds=ids(destination.root);
  assert.equal(destinationIds.length,new Set(destinationIds).size,'Pasted IDs must be globally unique in their destination');
  for(const id of destinationIds)assert.equal(sourceIds.has(id),false,'Source ID was reused: '+id);
  assert.notEqual(first,second);assert.notEqual(first,fragment.root.items[0]);
  assert.notEqual(first.regions[0],second.regions[0]);
  const secondBefore=JSON.stringify(second),sourceBefore=source.snapshot();
  destination.setCursor(first.regions[0].items[0].regions[0].id,1);destination.insert('+1');
  assert.equal(JSON.stringify(second),secondBefore);
  assert.equal(fragment.snapshot(),original);assert.equal(source.snapshot(),sourceBefore);
});

test('a fragment pasted into a nested argument replaces only that local selection',()=>{
  const source=parsed('\\frac{x}{a+b}'),denominator=source.root.items[0].regions[1];
  source.setCursor(denominator.id,3,0);
  assert.equal(source.selectionLatex(),'a+b');
  const copied=fromSelection(source),destination=parsed('\\sqrt{u+v}');
  const inside=destination.root.items[0].regions[0];destination.setCursor(inside.id,3,2);
  destination.replaceFragment(copied.root.items);
  assert.equal(destination.exportLatex(),'\\sqrt{u+a+b}');
  assert.equal(destination.cursor.region,inside.id);assert.equal(destination.cursor.offset,5);
});

test('structural replacement is one undo step and restores selection and pending font',()=>{
  const source=parsed('\\frac{a}{b}'),destination=parsed('x+\\sqrt{y}+z');
  destination.setCursor(destination.root.id,4,1);destination.pendingFont='font-symbf';
  const before=destination.snapshot();destination.replaceFragment(source.root.items);
  assert.equal(destination.exportLatex(),'x\\frac{a}{b}z');assert.equal(destination.pendingFont,undefined);
  assert.equal(destination.undoStack.length,1);const after=destination.snapshot();
  destination.undo();assert.equal(destination.snapshot(),before);
  destination.redo();assert.equal(destination.snapshot(),after);
});

test('opaque multiline source preserves exact bytes through insertion, save, copy and undo',()=>{
  const raw='\\unknown{𝛼}\r\n% a source comment\n\\begin{aligned}a&=b\\\\\r\nc&=d\\end{aligned}\n';
  const model=parsed('a+b');model.setCursor(model.root.id,1);const before=model.snapshot();
  model.insertSourceTex(raw);assert.equal(model.exportLatex(),'a'+raw+'+b');
  const source=model.root.items[1];assert.equal(source.type,'source-tex');
  assert.equal(source.regions[0].items.join(''),raw);
  const restored=new EditorModel();restored.restore(model.snapshot());assert.equal(restored.exportLatex(),model.exportLatex());
  model.setCursor(model.root.id,2,1);assert.equal(model.selectionLatex(),raw);
  const copied=fromSelection(model),destination=blank();destination.replaceFragment(copied.root.items);
  assert.equal(destination.exportLatex(),raw);
  model.undo();assert.equal(model.snapshot(),before);model.redo();assert.equal(model.exportLatex(),'a'+raw+'+b');
});

test('copy inside every raw region keeps its command context in the native fragment',()=>{
  for(const type of ['source-tex','text-normal','chem-ce','chem-pu']){
    const model=blank();model.insertStructure(type);model.insert('prefix');model.insert('\\alpha^2_suffix');
    const original=model.parents.get(model.cursor.region).node,raw=model.current;
    model.setCursor(raw.id,raw.items.length,6);
    const selected='\\alpha^2_suffix',copy=fromSelection(model);
    assert.equal(model.selectionLatex(),selected,'Readable copy should remain the selected source only');
    assert.equal(copy.root.items[0].type,type);
    assert.equal(copy.root.items[0].regions[0].items.join(''),selected);
    assert.notEqual(copy.root.items[0].id,original.id);
    assert.notEqual(copy.root.items[0].regions[0].id,raw.id);
    const destination=blank();destination.replaceFragment(copy.root.items);
    assert.equal(destination.exportLatex(),catalog.find(d=>d.type===type).render([selected]));
  }
});

test('pasting structured math into raw source inserts canonical TeX, never nested math nodes',()=>{
  const source=parsed('\\frac{a}{b}+x^2'),destination=blank();destination.insertSourceTex('prefix\r\nsuffix');
  const raw=destination.root.items[0].regions[0];destination.setCursor(raw.id,8,6);const before=destination.snapshot();
  destination.replaceFragment(source.root.items);
  assert.ok(raw.items.every(item=>typeof item==='string'));
  assert.equal(raw.items.join(''),'prefix'+source.exportLatex()+'suffix');
  assert.equal(destination.exportLatex(),raw.items.join(''));const after=destination.snapshot();
  destination.undo();assert.equal(destination.snapshot(),before);destination.redo();assert.equal(destination.snapshot(),after);
});

test('source pasted inside a source region stays exact and does not add another wrapper',()=>{
  const model=blank();model.insertSourceTex('a');const raw=model.root.items[0].regions[0];model.setCursor(raw.id,1);
  model.insertSourceTex('\r\n\\foo{b} % keep\n');
  assert.equal(model.exportLatex(),'a\r\n\\foo{b} % keep\n');
  assert.equal(model.root.items.length,1);assert.ok(raw.items.every(item=>typeof item==='string'));
});

test('invalid fragments are rejected before content, selection, pending state, or history changes',()=>{
  const region=(id,items)=>({id,items}),node=(type,regions)=>({id:'n900001',type,regions});
  const valid=plain(parsed('\\frac{a}{b}').root.items[0]);
  const cyclic=[];cyclic.push(cyclic);
  const invalid=[
    [node('not-a-component',[])],['multiple characters'],[null],[42],
    [node('frac',[])],[node('frac',[region('r900002',['a'])])],
    [node('frac',[region('r900002',['a']),region('r900002',['b'])])],
    [valid,plain(valid)],
    [node('source-tex',[])],
    [node('source-tex',[region('r900002',[valid])])],
    [node('sum',[{id:'r900002',slot:'upper',items:['a']},{id:'r900003',slot:'upper',items:['b']}])],
    [{...node('sum',[region('r900002',['a'])]),operatorLayout:true}],
    [{...node('matrix',[region('r900002',['a'])]),columns:2,rows:1}],
    [{...node('matrix',[region('r900002',['a']),region('r900003',['b'])]),columns:2,rows:2}],
    cyclic
  ];
  const destination=parsed('x+y');destination.insert('z');destination.undo();destination.setCursor(destination.root.id,2,1);destination.pendingFont='font-symbf';
  for(const fragment of invalid){
    const before=destination.snapshot(),undo=Array.from(destination.undoStack),redo=Array.from(destination.redoStack);
    assert.throws(()=>destination.replaceFragment(fragment));
    assert.equal(destination.snapshot(),before);assert.deepEqual(Array.from(destination.undoStack),undo);assert.deepEqual(Array.from(destination.redoStack),redo);
  }
});

test('valid clipboard input remains unchanged during validation and ID remapping',()=>{
  const source=plain(parsed('\\frac{a}{b}+\\alpha').root.items),before=JSON.stringify(source);
  const destination=blank();destination.replaceFragment(source);
  assert.equal(JSON.stringify(source),before);
  assert.equal(destination.exportLatex(),'\\frac{a}{b}+\\alpha ');
});

test('all existing component forms can still save and restore after arity validation',()=>{
  for(const definition of catalog){
    const model=blank();model.insertStructure(definition.type);const saved=model.snapshot();
    const restored=new EditorModel();assert.doesNotThrow(()=>restored.restore(saved),definition.type);
    assert.equal(restored.exportLatex(),model.exportLatex(),definition.type);
  }
});

test('dynamic matrices and multiline rows preserve dimensions and cell content on paste',()=>{
  for(const type of ['matrix','cases','aligned','gathered']){
    const source=blank();source.insertStructure(type);const node=source.root.items[0];
    source.setCursor(node.regions[0].id,0);source.insert('a');
    assert.equal(source.editTable(node.id,node.regions[0].id,'rowAfter'),true);
    if(type==='matrix')assert.equal(source.editTable(node.id,node.regions[0].id,'columnAfter'),true);
    const last=node.regions.at(-1);source.setCursor(last.id,0);source.insert('z');
    source.setCursor(source.root.id,1,0);const copied=fromSelection(source),destination=blank();destination.replaceFragment(copied.root.items);
    assert.deepEqual(plain(semantic(destination.root)),plain(semantic(source.root)),type);
    assert.equal(destination.exportLatex(),source.exportLatex());
  }
});

test('legacy operator snapshots still migrate their full script-and-body shape',()=>{
  const snapshot=JSON.stringify({version:2,root:{id:'r910000',items:[{id:'n910001',type:'sum',regions:[
    {id:'r910002',items:['i']},{id:'r910003',items:[]},{id:'r910004',items:['x','+','y']}
  ]}]},cursor:{region:'r910004',offset:1,anchor:0}});
  const model=new EditorModel();model.restore(snapshot);
  assert.equal(model.exportLatex(),'\\sum_{i} x+y');
  assert.equal(model.cursor.region,model.root.id);assert.equal(model.cursor.offset,2);assert.equal(model.cursor.anchor,1);
  model.setCursor(model.root.id,model.root.items.length,0);const copied=fromSelection(model),destination=blank();destination.replaceFragment(copied.root.items);
  assert.equal(destination.exportLatex(),model.exportLatex());
});

test('replacing the last script content with an empty fragment removes that script in one undo step',()=>{
  const model=parsed('x_i');const script=model.root.items[0].regions[1];model.setCursor(script.id,1,0);const before=model.snapshot();
  model.replaceFragment([]);assert.equal(model.exportLatex(),'x');assert.equal(model.cursor.region,model.root.id);assert.equal(model.cursor.offset,1);
  const after=model.snapshot();model.undo();assert.equal(model.snapshot(),before);model.redo();assert.equal(model.snapshot(),after);
});

test('external decimal IDs cannot round into duplicate IDs or poison subsequent clipboard insertions',()=>{
  for(const suffix of ['9007199254740991','9'.repeat(38),'9'.repeat(400)]){
    const model=blank(),id='r'+suffix;
    model.restore(JSON.stringify({version:2,root:{id,items:[]},cursor:{region:id,offset:0,anchor:0}}));
    model.insertStructure('frac');model.insert('x');
    model.setCursor(model.root.id,1,0);const copy=fromSelection(model);model.setCursor(model.root.id,1);model.replaceFragment(copy.root.items);
    const all=ids(model.root);assert.equal(all.length,new Set(all).size);assert.ok(all.every(id=>/^[rn]\d+$/.test(id)));
    const restored=new EditorModel();restored.restore(model.snapshot());assert.equal(restored.exportLatex(),model.exportLatex());
  }
});

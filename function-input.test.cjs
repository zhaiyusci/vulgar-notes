const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const compiled=buildSync({stdin:{contents:`export {EditorModel,catalog,symbols} from './src/editor-model';`,resolveDir:__dirname},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const loaded={exports:{}};new Function('module','exports','require',compiled)(loaded,loaded.exports,require);
const {EditorModel,catalog,symbols}=loaded.exports;
const blank=()=>{const model=new EditorModel();model.root.items=[];model.index();model.setCursor(model.root.id,0);return model;};
const candidates=query=>{const model=blank();model.insert('\\'+query);return model.commandCandidates();};
const byType=type=>catalog.find(definition=>definition.type===type);
const fixedNames='sin cos tan cot sec csc sinh cosh tanh coth arcsin arccos arctan asin acos atan arccsc acsc arcsec asec arccot acot csch sech exp ln log lg arg deg det dim gcd hom ker Pr tr Tr rank erf'.split(' ');

test('ordinary named functions have independent native definitions and no operand region',()=>{
  for(const name of fixedNames){
    const definition=byType('function-'+name);
    assert.ok(definition,'Native function missing: '+name);
    assert.equal(definition.category,'函数名称',name);assert.equal(definition.operator,true,name);
    assert.equal(definition.operatorCommand,name,name);
    assert.deepEqual(definition.labels,[],name);
    assert.deepEqual(definition.scriptSlots,['lower','upper'],name);
    const model=blank();model.insertStructure(definition.type);
    const node=model.root.items[0];
    assert.equal(node.type,definition.type);assert.equal(node.operatorLayout,true);assert.deepEqual(node.regions,[]);
    assert.equal(model.cursor.region,model.root.id,'Function insertion stays in the surrounding sequence');
    assert.equal(model.cursor.offset,1);assert.equal(model.exportLatex(),'\\'+name+' ');
    model.insert('x');assert.equal(model.root.items.length,2);assert.equal(model.root.items[1],'x');
    assert.equal(model.exportLatex(),'\\'+name+' x');
  }
});

test('Tr and tr candidates are case sensitive and Trace/trace commit to matching native names',()=>{
  const upper=candidates('T'),lower=candidates('t');
  for(const name of ['Tr','Trace'])assert.ok(upper.some(candidate=>candidate.name===name),name);
  for(const name of ['tr','trace'])assert.ok(lower.some(candidate=>candidate.name===name),name);
  assert.equal(upper.some(candidate=>candidate.name==='tr'||candidate.name==='trace'),false);
  assert.equal(lower.some(candidate=>candidate.name==='Tr'||candidate.name==='Trace'),false);
  for(const [alias,name] of [['Trace','Tr'],['trace','tr'],['Tr','Tr'],['tr','tr']]){
    const model=blank();model.insert('\\'+alias);
    const candidate=model.commandCandidates().find(candidate=>candidate.name===alias);
    assert.ok(candidate,alias);assert.equal(candidate.type,'function-'+name);assert.equal(candidate.atom,false);
    assert.equal(model.commitCommand(),true);assert.equal(model.root.items[0].type,'function-'+name);
    assert.equal(model.exportLatex(),'\\'+name+' ');assert.equal(model.cursor.region,model.root.id);
  }
});

test('physics additional trigonometric names retain their actual visible spellings',()=>{
  for(const name of ['csch','sech','arccsc','arcsec','arccot','asin','acos','atan','acsc','asec','acot']){
    const entries=candidates(name).filter(candidate=>candidate.name===name);
    assert.equal(entries.length,1,name);assert.equal(entries[0].type,'function-'+name);
    const model=blank();model.insert('\\'+name);assert.equal(model.commitCommand(),true);
    assert.equal(model.exportLatex(),'\\'+name+' ');
  }
  // MathJax physics prints `asin` and `arcsin` differently, so these are not
  // spelling aliases that may silently canonicalize to the same control word.
  assert.notEqual(candidates('asin').find(item=>item.name==='asin').type,candidates('arcsin').find(item=>item.name==='arcsin').type);
});

test('operatorname-only functions remain explicit wrappers rather than undefined bare commands',()=>{
  for(const name of ['arcsinh','arccosh','arctanh','sgn']){
    const definition=byType('function-operatorname-'+name);assert.ok(definition,name);
    assert.equal(definition.category,'函数名称');assert.equal(definition.operator,true);assert.deepEqual(definition.labels,[]);
    const model=blank();model.insert('\\'+name);
    const candidate=model.commandCandidates().find(candidate=>candidate.name===name);
    assert.ok(candidate,name);assert.equal(candidate.type,definition.type);assert.equal(candidate.atom,false);
    assert.equal(model.commitCommand(),true);
    assert.equal(model.exportLatex(),'\\operatorname{'+name+'} ');
    assert.equal(model.root.items[0].regions.length,0);assert.equal(model.cursor.region,model.root.id);
  }
});

test('function scripts attach to the function, keep its category, and disappear when empty',()=>{
  const model=blank();model.insertStructure('function-Tr');const node=model.root.items[0];
  model.replaceInput(...model.range,'_');model.insert('b');
  assert.equal(node.regions[0].slot,'lower');assert.equal(model.cursor.region,node.regions[0].id);
  model.setCursor(model.root.id,1);model.replaceInput(...model.range,'^');model.insert('2');
  assert.deepEqual(node.regions.map(region=>region.slot),['lower','upper']);
  assert.equal(model.exportLatex(),String.raw`\Tr_{b}^{2} `);
  assert.equal(byType(node.type).category,'函数名称');
  assert.doesNotMatch(model.exportLatex(),/\\(?:no)?limits/);
  model.remove(-1);
  assert.deepEqual(model.root.items[0].regions.map(region=>region.slot),['lower']);
  assert.equal(model.cursor.region,model.root.id);assert.equal(model.exportLatex(),String.raw`\Tr_{b} `);
  model.undo();assert.equal(model.exportLatex(),String.raw`\Tr_{b}^{2} `);
});

test('editing a function subscript stays in its current sequence instead of lifting a later script',()=>{
  const model=blank();model.insertStructure('function-Tr');model.replaceInput(...model.range,'_');
  model.replaceInput(...model.range,'b^2');
  const node=model.root.items[0];
  assert.deepEqual(node.regions.map(region=>region.slot),['lower']);
  assert.equal(node.regions[0].items[0].type,'power');
  assert.equal(model.exportLatex(),String.raw`\Tr_{{b}^{2}} `);
});

test('function insertion preserves the selected surrounding content and supports undo and redo',()=>{
  const model=blank();model.insert('xy');model.setCursor(model.root.id,2,0);const before=model.snapshot();
  model.insertStructure('function-Tr');
  assert.equal(model.root.items[0].type,'function-Tr');assert.deepEqual(model.root.items.slice(1),['x','y']);
  assert.equal(model.exportLatex(),String.raw`\Tr xy`);const after=model.snapshot();
  model.undo();assert.equal(model.snapshot(),before);model.redo();assert.equal(model.snapshot(),after);
});

test('native function selections preserve scripts through copy, insertion and saved snapshot restoration',()=>{
  const source=blank();source.insertStructure('function-Tr');const fn=source.root.items[0];
  source.toggleOperatorScript(fn.id,'lower');source.insert('b');source.setCursor(source.root.id,1);source.insert('x');
  source.setCursor(source.root.id,2,0);const snapshot=source.selectionSnapshot(),copy=blank();copy.restore(snapshot);
  assert.equal(copy.root.items[0].type,'function-Tr');assert.equal(copy.root.items[0].regions[0].slot,'lower');
  const destination=blank();destination.insert('q+');const before=destination.snapshot();destination.replaceFragment(copy.root.items);
  assert.equal(destination.root.items[2].type,'function-Tr');assert.notEqual(destination.root.items[2].id,fn.id);
  assert.equal(destination.exportLatex(),String.raw`q+\Tr_{b} x`);const after=destination.snapshot();
  destination.undo();assert.equal(destination.snapshot(),before);destination.redo();assert.equal(destination.snapshot(),after);
  const restored=blank();restored.restore(after);assert.equal(restored.exportLatex(),destination.exportLatex());
});

test('retired function atoms do not create duplicate insertion candidates beside native functions',()=>{
  for(const name of [...fixedNames,'arcsinh','arccosh','arctanh','sgn']){
    const exact=candidates(name).filter(candidate=>candidate.name===name);assert.equal(exact.length,1,name);
    assert.equal(exact[0].atom,false,name);
    const old=symbols.find(definition=>definition.type==='symbol-'+name);
    if(old){assert.equal(old.commandCandidate,false,name);assert.equal(old.hidden,true,name);}
  }
});

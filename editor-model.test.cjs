const test = require('node:test');
const assert = require('node:assert/strict');
const {EditorModel} = require('./editor-model.js');
const denominator = m => m.root.items[0].regions[1];

test('legacy font commands normalize to Unicode-math and existing drafts retain content',()=>{
  for(const [old,next] of [['mathbf','symbf'],['mathrm','symup'],['mathbb','symbb'],['mathbfit','symbfit'],['mathsf','symsf'],['mathbfsfup','symbfsfup']]){
    const m=new EditorModel();m.root.items=[];m.index();m.setCursor(m.root.id,0);
    m.replaceInput(0,0,'\\'+old+' x');assert.equal(m.exportLatex(),'\\'+(old==='mathbfsfup'?'mathbfsf':old)+'{x}');
    assert.equal(m.root.items[0].type,'symbol-letter-x--'+next);assert.equal(m.root.items[0].regions.length,0);
  }
  const m=new EditorModel();m.setCursor(m.root.id,1,0);m.insertStructure('font-mathbf');
  const snapshot=m.snapshot(),n=new EditorModel();n.restore(snapshot);
  assert.equal(n.exportLatex(),m.exportLatex());assert.ok(n.exportLatex().startsWith('\\mathbf{\\frac'));
});
test('physics derivative arguments are independently editable and variants preserve nested contents',()=>{
  const m=new EditorModel();m.root.items=[];m.index();m.setCursor(m.root.id,0);
  m.replaceInput(0,0,'\\dv x^2');const derivative=m.root.items[0];
  m.setCursor(derivative.regions[1].id,0);m.insert('x');
  assert.equal(m.exportLatex(),'\\dv{{x}^{2}}{x}');const regions=[...derivative.regions];
  m.switchVariant(derivative.id,'physics-dvFlat');assert.deepEqual(derivative.regions,regions);
  assert.equal(m.exportLatex(),'\\dv*{{x}^{2}}{x}');
  m.undo();assert.equal(m.exportLatex(),'\\dv{{x}^{2}}{x}');
});
test('chemistry preserves its source syntax for both pasted and streamed input',()=>{
  const source='SO4^2- + Ba^2+ -> BaSO4 v';
  for(const chunks of [[source],Array.from(source)]){
    const m=new EditorModel();m.root.items=[];m.index();m.setCursor(m.root.id,0);m.replaceInput(0,0,'\\ce ');
    for(const chunk of chunks)m.replaceInput(...m.range,chunk);
    assert.equal(m.exportLatex(),'\\ce{'+source+'}');assert.ok(m.rawInput);
    assert.equal(m.current.items.filter(i=>typeof i!=='string').length,0);
    assert.deepEqual(m.commandCandidates(),[]);const saved=m.snapshot();m.remove(-1);m.undo();assert.equal(m.snapshot(),saved);
    const restored=new EditorModel();restored.restore(saved);assert.equal(restored.exportLatex(),m.exportLatex());
  }
  const n=new EditorModel();n.root.items=[];n.index();n.setCursor(n.root.id,0);n.replaceInput(0,0,'\\ce H2O^+');
  assert.equal(n.exportLatex(),'\\ce{H2O^+}');
});
test('units keep spaces and powers; leaving raw regions restores normal script input',()=>{
  const m=new EditorModel();m.root.items=[];m.index();m.setCursor(m.root.id,0);
  m.replaceInput(0,0,'\\pu 1.2e3 kg m/s^2');assert.equal(m.exportLatex(),'\\pu{1.2e3 kg m/s^2}');
  m.move(1);m.replaceInput(...m.range,'x^2');assert.equal(m.exportLatex(),'\\pu{1.2e3 kg m/s^2}{x}^{2}');
});
test('physics divergence command does not change existing division atoms',()=>{
  const m=new EditorModel();m.root.items=[];m.index();m.setCursor(m.root.id,0);m.insertSymbol('symbol-div');
  assert.equal(m.exportLatex(),'\\divisionsymbol ');m.replaceInput(...m.range,'\\div x');
  assert.equal(m.exportLatex(),'\\divisionsymbol \\divergence{x}');
});

test('saved drafts reject malformed data without replacing the current formula',()=>{
  const m=new EditorModel(),before=m.snapshot();
  for(const invalid of [null,{}, {root:{items:[]},cursor:{}}, {...JSON.parse(before),cursor:{region:'missing',offset:0,anchor:0}}]){
    assert.throws(()=>m.restore(JSON.stringify(invalid)));assert.equal(m.snapshot(),before);
  }
  const duplicate=JSON.parse(before);duplicate.root.items.push(duplicate.root.items[0]);
  assert.throws(()=>m.restore(JSON.stringify(duplicate)));assert.equal(m.snapshot(),before);
  const copy=new EditorModel();copy.restore(before);assert.equal(copy.snapshot(),before);
});

test('all large operators default to automatic placement and expose two explicit variants',()=>{
  const {catalog}=require('./editor-model');
  for(const entry of catalog.filter(e=>e.category==='大型算符' && e.variantOf===e.type)){
    const variants=catalog.filter(e=>e.variantOf===entry.type);
    assert.equal(variants.length,3,entry.type);
    const m=new EditorModel();m.insertStructure(entry.type);const node=m.root.items.at(-1);
    m.replaceInput(...m.range,'_a^b');const regions=[...node.regions],cursor={...m.cursor};
    assert.ok(!/\\(?:no)?limits/.test(m.exportLatex()),entry.type);
    for(const placement of ['\\limits','\\nolimits','']){
      const target=variants.find(e=>e.operatorPlacement===placement);
      assert.ok(m.switchVariant(node.id,target.type));assert.deepEqual(node.regions,regions);assert.deepEqual(m.cursor,cursor);
      assert.ok(m.exportLatex().endsWith('\\'+entry.operatorCommand+placement+'_{a}^{b} '));
    }
    const final=m.snapshot();m.undo();assert.ok(m.exportLatex().includes('\\nolimits'));m.redo();assert.equal(m.snapshot(),final);
  }
});

test('command candidates open on backslash, filter prefixes and prioritize exact matches',()=>{
  const m=new EditorModel();m.replaceInput(...m.range,'\\');
  assert.equal(m.commandQuery().name,'');assert.ok(m.commandCandidates().some(e=>e.name==='frac'));
  m.replaceInput(...m.range,'si');assert.ok(m.commandCandidates().some(e=>e.name==='sin'));
  assert.ok(m.commandCandidates().every(e=>e.name.startsWith('si')));
  m.replaceInput(...m.range,'n');assert.equal(m.commandCandidates()[0].name,'sin');
  m.replaceInput(...m.range,'zz');assert.deepEqual(m.commandCandidates(),[]);
});
test('accepting a partial command preserves neighbors, undo and structure entry',()=>{
  for(const [prefix,name,expected] of [['s','sin','a\\sin b'],['fr','frac','a\\frac{}{}b']]){
    const m=new EditorModel();m.root.items=['a','b'];m.index();m.setCursor(m.root.id,1);
    m.replaceInput(...m.range,'\\'+prefix);const before=m.snapshot();
    assert.equal(m.commitCommand(true,'unknown'),false);assert.equal(m.snapshot(),before);
    assert.ok(m.commitCommand(true,name));assert.equal(m.exportLatex(),expected);
    if(name==='frac')assert.equal(m.current.label,'分子');
    m.undo();assert.equal(m.snapshot(),before);m.redo();assert.equal(m.exportLatex(),expected);
  }
});

test('LaTeX command input accepts functions and symbols with delimiters, streamed or pasted',()=>{
  for(const [input,expected] of [['\\sin x','\\sin x'],['\\sinh(x)','\\sinh (x)'],['\\alpha+\\beta ','\\alpha +\\beta '],['\\sin^2','{\\sin }^{2}']]){
    for(const chunks of [[input],Array.from(input)]){
      const m=new EditorModel();m.root.items=[];m.index();m.setCursor(m.root.id,0);
      for(const chunk of chunks)m.replaceInput(...m.range,chunk);
      assert.equal(m.exportLatex(),expected);
    }
  }
});
test('command confirmation is undoable and does not prematurely commit prefixes',()=>{
  const m=new EditorModel();m.replaceInput(...m.range,'\\sin');
  const before=m.snapshot();assert.ok(m.pendingCommand());assert.ok(m.commitCommand());
  assert.equal(m.root.items.at(-1).type,'symbol-sin');m.undo();assert.equal(m.snapshot(),before);
  m.replaceInput(...m.range,'h');m.commitCommand();assert.equal(m.root.items.at(-1).type,'symbol-sinh');
  m.replaceInput(...m.range,'\\unknown');assert.equal(m.commitCommand(),false);m.remove(-1);assert.ok(m.current);
});
test('structure and font commands enter editable arguments and preserve surrounding content',()=>{
  const m=new EditorModel();m.root.items=['a','+','b'];m.index();m.setCursor(m.root.id,2);
  m.replaceInput(...m.range,'\\frac \\sqrt x');
  assert.equal(m.exportLatex(),'a+\\frac{\\sqrt{x}}{}b');
  m.replaceInput(...m.range,'\\mathbf y');assert.equal(m.current.label,'根号内');
  assert.equal(m.exportLatex(),'a+\\frac{\\sqrt{x\\mathbf{y}}}{}b');
});
test('command conversion is one undo step and selection replacement retains neighbors',()=>{
  const m=new EditorModel();m.root.items=['a','b','c'];m.index();m.setCursor(m.root.id,2,1);
  const before=m.snapshot();m.replaceInput(...m.range,'\\exp ');
  assert.equal(m.exportLatex(),'a\\exp c');m.undo();assert.equal(m.snapshot(),before);
  m.redo();assert.equal(m.exportLatex(),'a\\exp c');
});

test('root variants preserve nested radicand and focus the new index',()=>{
  const m=new EditorModel(),node=m.root.items[0].regions[0].items[0],radicand=node.regions[0];
  const before=m.snapshot();assert.ok(m.canSwitchVariant(node.id,'nthroot'));
  m.switchVariant(node.id,'nthroot');assert.equal(node.regions[0],radicand);
  assert.equal(m.current,node.regions[1]);m.insert('3');
  m.switchVariant(node.id,'sqrt');assert.equal(node.regions[0],radicand);
  assert.equal(m.cursor.region,m.root.items[0].regions[0].id);assert.equal(m.cursor.offset,1);
  m.undo();assert.ok(m.exportLatex().includes('\\sqrt[3]{x+1}'));
  m.undo();m.undo();assert.equal(m.snapshot(),before);
});

test('clearing a root index removes only the index and supports undo and redo',()=>{
  for(const mode of ['backspace','selection','native','empty']){
    const m=new EditorModel();m.insertStructure('nthroot');
    const node=m.parents.get(m.cursor.region).node,radicand=node.regions[0];
    m.insertStructure('frac');m.insert('x');
    m.setCursor(node.regions[1].id,0);if(mode!=='empty')m.insert('3');
    const before=m.snapshot();
    if(mode==='selection'){m.setCursor(node.regions[1].id,1,0);m.remove(1);}
    else if(mode==='native')m.replaceInput(0,1,'');
    else m.remove(-1);
    assert.equal(node.type,'sqrt');assert.deepEqual(node.regions,[radicand]);
    assert.equal(m.current,m.root);assert.equal(m.cursor.offset,m.root.items.length);
    assert.ok(m.exportLatex().endsWith('\\sqrt{\\frac{x}{}}'));
    m.undo();
    if(mode!=='selection')assert.equal(m.snapshot(),before);
    m.redo();assert.equal(m.nodes.get(node.id).type,'sqrt');
  }
});

test('clearing a radicand keeps its root and index',()=>{
  const m=new EditorModel();m.insertStructure('nthroot');const node=m.parents.get(m.cursor.region).node;
  m.insert('x');m.remove(-1);assert.equal(node.type,'nthroot');assert.equal(node.regions.length,2);
});

test('nested denominator is one sequence of text and a structure', () => {
  const m = new EditorModel(), den = denominator(m);
  assert.equal(m.exportLatex(), '\\frac{\\sqrt{x+1}}{a+\\frac{b}{c}}');
  assert.deepEqual(den.items.slice(0,2), ['a','+']);
  assert.equal(den.items[2].type, 'frac');
  assert.equal(m.order.length, 6); // root, numerator, radicand, denominator, inner numerator/denominator
});
test('replace + and append text on either side of the inner fraction', () => {
  const m = new EditorModel(), den = denominator(m), fraction = den.items[2];
  m.setCursor(den.id, 2); m.remove(-1); m.insert('-');
  m.insert('2'); m.setCursor(den.id, den.items.length); m.insert('+z');
  assert.equal(den.items[3], fraction);
  assert.equal(m.exportLatex(), '\\frac{\\sqrt{x+1}}{a-2\\frac{b}{c}+z}');
});
test('right and left traverse the same nested path without skipping text', () => {
  const m = new EditorModel(), den = denominator(m);
  m.setCursor(den.id, 0);
  const positions = [JSON.stringify(m.cursor)];
  for (let i=0;i<7;i++) { m.move(1); positions.push(JSON.stringify(m.cursor)); }
  assert.equal(m.cursor.region, den.id); assert.equal(m.cursor.offset, 3);
  for (let i=6;i>=0;i--) { m.move(-1); assert.equal(JSON.stringify(m.cursor), positions[i]); }
});
test('shift selection crosses text and structure in the containing region', () => {
  const m = new EditorModel(), den = denominator(m);
  m.setCursor(den.id,0); m.move(1,true); m.move(1,true); m.move(1,true);
  assert.deepEqual(m.range,[0,3]); m.insert('q');
  assert.equal(m.exportLatex(),'\\frac{\\sqrt{x+1}}{q}');
  m.undo(); assert.equal(m.exportLatex(),'\\frac{\\sqrt{x+1}}{a+\\frac{b}{c}}');
});
test('backspace selects a structure first; undo restores its children', () => {
  const m = new EditorModel(), den = denominator(m); m.setCursor(den.id,3);
  m.remove(-1); assert.equal(den.items.length,3); assert.deepEqual(m.range,[2,3]);
  m.remove(-1); assert.equal(m.exportLatex(),'\\frac{\\sqrt{x+1}}{a+}');
  m.undo(); assert.equal(m.exportLatex(),'\\frac{\\sqrt{x+1}}{a+\\frac{b}{c}}');
  m.redo(); assert.equal(m.exportLatex(),'\\frac{\\sqrt{x+1}}{a+}');
});
test('empty child regions retain their structure and remain writable', () => {
  const m = new EditorModel(), rad = m.root.items[0].regions[0].items[0].regions[0];
  m.setCursor(rad.id,rad.items.length,0);m.insert('');
  assert.equal(m.exportLatex(),'\\frac{\\sqrt{}}{a+\\frac{b}{c}}');
  m.insert('t');assert.equal(m.exportLatex(),'\\frac{\\sqrt{t}}{a+\\frac{b}{c}}');
});
test('all existing examples export their original structure', () => {
  for (const [kind, expected] of Object.entries({frac:'\\frac{a+b}{c}',sqrt:'\\sqrt{x+1}',sup:'{x}_{i}^{2}',matrix:'\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}'})) {
    assert.equal(new EditorModel(kind).exportLatex(),expected);
  }
});

test('insert at an interior cursor preserves both surrounding text and structures', () => {
  const m = new EditorModel(), den = denominator(m), originalFraction = den.items[2];
  m.setCursor(den.id,2); m.insertStructure('frac'); m.insert('p');
  m.tab(1); m.insert('q');
  assert.equal(den.items[3],originalFraction);
  assert.equal(m.exportLatex(),'\\frac{\\sqrt{x+1}}{a+\\frac{p}{q}\\frac{b}{c}}');
});
test('insert a fraction then a radical inside its numerator and continue typing', () => {
  const m = new EditorModel(), den = denominator(m); m.setCursor(den.id,3);
  m.insert('+'); m.insertStructure('frac'); m.insertStructure('sqrt'); m.insert('t+1');
  m.move(1); m.move(1); m.insert('k');
  assert.equal(m.exportLatex(),'\\frac{\\sqrt{x+1}}{a+\\frac{b}{c}+\\frac{\\sqrt{t+1}}{k}}');
});
test('wrap mixed text and a nested fraction without losing descendants; undo/redo insertion', () => {
  const m = new EditorModel(), den = denominator(m), innerId = den.items[2].id;
  m.setCursor(den.id,3,0); const before = m.snapshot();
  m.insertStructure('sqrt'); const after = m.snapshot();
  assert.equal(m.current.items[2].id,innerId);
  assert.equal(m.exportLatex(),'\\frac{\\sqrt{x+1}}{\\sqrt{a+\\frac{b}{c}}}');
  m.undo(); assert.equal(m.snapshot(),before); m.redo(); assert.equal(m.snapshot(),after);
});
test('all insertion tools preserve selection and put the cursor inside the new node', () => {
  for (const [type, expected] of Object.entries({frac:'\\frac{a+}{}',sqrt:'\\sqrt{a+}',sup:'{a+}_{}^{}',matrix:'\\begin{pmatrix}a+&\\\\&\\end{pmatrix}'})) {
    const m = new EditorModel(), den = denominator(m); m.setCursor(den.id,2,0); m.insertStructure(type);
    assert.equal(m.projection(),'a+');
    assert.equal(m.exportLatex(),`\\frac{\\sqrt{x+1}}{${expected}\\frac{b}{c}}`);
  }
});
test('first insertion appends to the existing formula and creates unique region IDs', () => {
  const m = new EditorModel(), old = m.exportLatex(); m.insertStructure('sqrt'); m.insertStructure('frac');
  assert.equal(m.exportLatex(),old+'\\sqrt{\\frac{}{}}');
  assert.equal(m.regions.size,m.order.length);
});

test('every board structure preserves a nested selection and survives undo/redo', () => {
  const {catalog} = require('./editor-model.js');
  for (const entry of catalog) {
    const m = new EditorModel(), den = denominator(m), inner = den.items[2];
    m.setCursor(den.id,3,0); const before = m.snapshot();
    m.insertStructure(entry.type);
    if(entry.raw)assert.ok(m.current.items.join('').includes('\\frac{b}{c}'),entry.type);
    else assert.equal(m.current.items[entry.operator?3:2],inner,entry.type);
    if(entry.operator)assert.equal(m.current,den);
    else if(entry.rowEnvironment)assert.match(m.current.label,/^第1行/);
    else assert.equal(m.current.label,entry.matrixEnvironment?'矩阵第1行第1列':entry.labels[entry.selectedIndex],entry.type);
    assert.ok(!m.exportLatex().includes('undefined'),entry.type);
    const inserted = m.snapshot();
    m.undo(); assert.equal(m.snapshot(),before,entry.type);
    m.redo(); assert.equal(m.snapshot(),inserted,entry.type);
  }
});
test('3 by 3 matrix navigation follows columns and all cells are serialized', () => {
  const m = new EditorModel(); m.insertStructure('matrix3');
  const first = m.cursor.region; m.insert('a');m.vertical(1);m.insert('b');
  assert.equal(m.current.label,'矩阵第2行第1列');
  m.vertical(-1);assert.equal(m.cursor.region,first);
  assert.ok(m.exportLatex().endsWith('\\begin{pmatrix}a&&\\\\b&&\\\\&&\\end{pmatrix}'));
});
test('large operator inserts before selection in the same continuous sequence', () => {
  const m = new EditorModel(), den = denominator(m); m.setCursor(den.id,3,0); m.insertStructure('sum');
  assert.equal(m.current,den);
  assert.equal(m.exportLatex(),'\\frac{\\sqrt{x+1}}{\\sum a+\\frac{b}{c}}');
});

test('accent variants export their distinct commands rather than aliasing wide forms', () => {
  const {catalog} = require('./editor-model.js');
  for (const entry of catalog.filter(e=>e.category==='重音与修饰')) {
    const m = new EditorModel(),den=denominator(m);m.setCursor(den.id,2,0);
    m.insertStructure(entry.type);
    assert.equal(m.exportLatex(),`\\frac{\\sqrt{x+1}}{${entry.command}{a+}\\frac{b}{c}}`);
  }
  for (const command of ['hat','widehat','tilde','widetilde','bar','overline']) {
    assert.equal(catalog.find(e=>e.type===command).render(['xy']),`\\${command}{xy}`);
  }
});

test('audited forms preserve their distinct commands, environments and options', () => {
  const {catalog}=require('./editor-model.js');
  const definitions=new Map(catalog.map(e=>[e.type,e]));
  assert.equal(definitions.size,catalog.length,'Each button must have a unique structure type');
  for(const [type,expected] of Object.entries({
    dbinom:'\\dbinom{a}{b}',tbinom:'\\tbinom{a}{b}',cfracl:'\\cfrac[l]{a}{b}',cfracr:'\\cfrac[r]{a}{b}',
    splitfrac:'\\splitfrac{a}{b}',splitdfrac:'\\splitdfrac{a}{b}',
    prescript:'\\prescript{b}{c}{a}',intSide:'\\int\\nolimits_{a}^{b} c',iiint:'\\iiint_{a}^{b} c',
    Bmatrix:'\\begin{Bmatrix}a&b\\\\c&d\\end{Bmatrix}',pmatrixl:'\\begin{pmatrix*}[l]a&b\\\\c&d\\end{pmatrix*}',
    rcases:'\\begin{rcases}a&b\\\\c&d\\end{rcases}',dcases:'\\begin{dcases}a&b\\\\c&d\\end{dcases}',
    xleftarrow:'\\xleftarrow[b]{a}',xRightarrow:'\\xRightarrow[b]{a}',bcancel:'\\bcancel{a}',xcancel:'\\xcancel{a}',cancelto:'\\cancelto{b}{a}'
  })) assert.equal(definitions.get(type).render(['a','b','c','d','e']),expected,type);
});

test('switch matrix alignment preserves regions, nested content, cursor and undo', () => {
  const m=new EditorModel('matrix'), node=m.root.items[0];
  m.setCursor(node.regions[1].id,1);m.insertStructure('sqrt');m.insert('x+1');
  const cursor={...m.cursor}, ids=node.regions.map(r=>r.id), before=m.exportLatex();
  assert.equal(m.switchVariant(node.id,'pmatrixl'),true);
  assert.deepEqual(node.regions.map(r=>r.id),ids);assert.deepEqual(m.cursor,cursor);
  assert.match(m.exportLatex(),/pmatrix\*\}\[l\]/);assert.match(m.exportLatex(),/sqrt/);
  m.undo();assert.equal(m.exportLatex(),before);m.redo();assert.match(m.exportLatex(),/pmatrix\*/);
});
test('matrix layout variants retain custom dimensions and all cell contents', () => {
  const m=new EditorModel('matrix'), node=m.root.items[0];
  m.editMatrix(node.id,node.regions[1].id,'columnAfter');m.insert('z');
  const ids=node.regions.map(r=>r.id);
  m.switchVariant(node.id,'pmatrixl');
  assert.equal(node.columns,3);assert.equal(node.rows,2);assert.deepEqual(node.regions.map(r=>r.id),ids);
  assert.equal(m.exportLatex(),'\\begin{pmatrix*}[l]a&b&z\\\\c&d&\\end{pmatrix*}');
  m.switchVariant(node.id,'psmallmatrix');assert.equal(node.columns,3);assert.deepEqual(node.regions.map(r=>r.id),ids);
});

test('insert and delete rows/columns preserve unaffected nested cells and undo', () => {
  const m=new EditorModel('matrix'), node=m.root.items[0];
  m.setCursor(node.regions[3].id,1);m.insertStructure('sqrt');m.insert('x');
  const nestedRegion=m.cursor.region, oldCells=[...node.regions], before=m.snapshot();
  m.editMatrix(node.id,oldCells[0].id,'rowBefore');
  assert.deepEqual(node.regions.slice(2),oldCells);assert.equal(node.rows,3);
  m.editMatrix(node.id,oldCells[1].id,'columnBefore');
  assert.equal(node.columns,3);assert.equal(node.regions[3],oldCells[0]);assert.equal(node.regions[5],oldCells[1]);assert.equal(node.regions[8],oldCells[3]);
  m.setCursor(nestedRegion,1);
  m.editMatrix(node.id,node.regions[1].id,'deleteRow');
  assert.equal(m.cursor.region,nestedRegion);
  m.editMatrix(node.id,node.regions[1].id,'deleteColumn');
  assert.deepEqual(node.regions,oldCells);assert.equal(m.cursor.region,nestedRegion);
  for(let i=0;i<4;i++)m.undo();assert.equal(m.snapshot(),before);
  for(let i=0;i<4;i++)m.redo();assert.match(m.exportLatex(),/sqrt\{x\}/);
});
test('rectangular matrices grow beyond presets and navigate using actual columns', () => {
  const m=new EditorModel('matrix'), node=m.root.items[0];
  for(let i=0;i<3;i++)m.editMatrix(node.id,node.regions[0].id,'columnAfter');
  m.editMatrix(node.id,node.regions[0].id,'rowAfter');
  assert.equal(node.columns,5);assert.equal(node.rows,3);
  m.setCursor(node.regions[2].id,0);m.vertical(1);assert.equal(m.cursor.region,node.regions[7].id);
  assert.equal(m.exportLatex(),'\\begin{pmatrix}a&&&&b\\\\&&&&\\\\c&&&&d\\end{pmatrix}');
  assert.equal(new Set(m.order).size,m.order.length);
});
test('deleting the current nested cell moves cursor safely and keeps at least one row/column', () => {
  const m=new EditorModel('matrix'), node=m.root.items[0];
  m.setCursor(node.regions[3].id,1);m.insertStructure('sqrt');m.insert('x');
  const before=m.snapshot();m.editMatrix(node.id,m.cursor.region,'deleteRow');
  assert.equal(node.rows,1);assert.equal(m.cursor.region,node.regions[1].id);
  m.undo();assert.equal(m.snapshot(),before);m.redo();
  const current=m.nodes.get(node.id);m.editMatrix(current.id,current.regions[1].id,'deleteColumn');
  assert.equal(m.exportLatex(),'\\begin{pmatrix}a\\end{pmatrix}');
  const count=m.undoStack.length;
  assert.equal(m.editMatrix(current.id,current.regions[0].id,'deleteRow'),false);
  assert.equal(m.editMatrix(current.id,current.regions[0].id,'deleteColumn'),false);
  assert.equal(m.undoStack.length,count);assert.ok(m.current);
});
test('every matrix environment exports dynamic rows and columns', () => {
  const {catalog}=require('./editor-model.js');
  for(const entry of catalog.filter(e=>e.matrixEnvironment)){
    const m=new EditorModel();m.insertStructure(entry.type);
    const node=m.parents.get(m.cursor.region).node;
    m.editMatrix(node.id,node.regions[0].id,'columnBefore');
    m.editMatrix(node.id,node.regions[0].id,'rowAfter');
    m.insert('x');assert.ok(m.exportLatex().includes('x'));
    assert.equal(node.regions.length,node.rows*node.columns);
    if(entry.type==='array')assert.match(m.exportLatex(),/begin\{array\}\{lll\}/);
  }
});
test('nested variant switch only changes the target and no-op creates no undo entry', () => {
  const m=new EditorModel(), node=denominator(m).items[2], before=m.exportLatex();
  assert.equal(m.switchVariant(node.id,'dfrac'),true);
  assert.equal(m.exportLatex(),before.replace('frac{b}','dfrac{b}'));
  const count=m.undoStack.length;
  assert.equal(m.switchVariant(node.id,'dfrac'),false);
  assert.equal(m.switchVariant(node.id,'matrix'),false);assert.equal(m.undoStack.length,count);
});

test('all multiline structures support dynamic rows, nested content and undo', () => {
  const {catalog}=require('./editor-model.js');
  for(const entry of catalog.filter(e=>e.rowEnvironment)){
    const m=new EditorModel();m.insertStructure(entry.type);
    const node=m.parents.get(m.cursor.region).node;
    for(let i=0;i<node.regions.length;i++){m.setCursor(node.regions[i].id,0);m.insert(String(i));}
    const cells=[...node.regions],before=m.snapshot();
    m.setCursor(cells[0].id,1);m.insertStructure('sqrt');m.insert('z');
    const nested=m.cursor.region;
    m.editTable(node.id,cells[0].id,'rowAfter');
    assert.equal(node.rows,3,entry.type);assert.equal(node.columns,entry.columns);
    assert.equal(node.regions[0],cells[0]);assert.equal(node.regions[2*entry.columns],cells[entry.columns]);
    for(let i=0;i<3;i++)m.editTable(node.id,cells[0].id,'rowBefore');
    assert.equal(node.rows,6);assert.ok(m.exportLatex().includes('sqrt{z}'));
    const target=catalog.find(e=>e.variantOf===entry.variantOf && e.type!==entry.type);
    if(target && entry.variantOf){m.switchVariant(node.id,target.type);assert.equal(node.rows,6);assert.ok(m.regions.has(nested));}
    const state=m.snapshot(),count=m.undoStack.length;
    assert.equal(m.editTable(node.id,cells[0].id,'columnAfter'),false);assert.equal(m.undoStack.length,count);
    m.editTable(node.id,nested,'deleteRow');assert.ok(!m.regions.has(nested));assert.equal(node.rows,5);
    m.undo();assert.equal(m.snapshot(),state);m.redo();assert.equal(m.nodes.get(node.id).rows,5);
    while(m.undoStack.length>1)m.undo();assert.equal(m.nodes.get(node.id).rows,2);
  }
});
test('cases and alignedat export all rows with expression/condition pairs intact', () => {
  for(const type of ['cases','alignedat']){
    const m=new EditorModel();m.insertStructure(type);const node=m.parents.get(m.cursor.region).node;
    ['a','b','c','d'].forEach((text,i)=>{m.setCursor(node.regions[i].id,0);m.insert(text);});
    m.editTable(node.id,node.regions[3].id,'rowBefore');m.insert('x');
    const prefix=type==='alignedat'?'\\begin{alignedat}{1}':'\\begin{cases}';
    assert.ok(m.exportLatex().endsWith(prefix+'a&b\\\\&x\\\\c&d\\end{'+type+'}'));
    m.setCursor(node.regions[5].id,1);m.vertical(-1);assert.equal(m.cursor.region,node.regions[3].id);
    m.editTable(node.id,node.regions[3].id,'deleteRow');
    m.editTable(node.id,node.regions[3].id,'deleteRow');
    assert.equal(node.rows,1);assert.equal(m.editTable(node.id,node.regions[0].id,'deleteRow'),false);
  }
});

test('literal caret and tilde are safe in math mode',()=>{
  const {texChar}=require('./editor-model');
  assert.equal(texChar('^'),'\\unicode{x005E}');assert.equal(texChar('~'),'\\unicode{x007E}');
});
test('symbols and function names are sequence atoms without editable slots',()=>{
  const {symbols}=require('./editor-model');
  for(const entry of symbols){
    const m=new EditorModel();m.setCursor(m.root.id,0);const before=m.snapshot();
    m.insertSymbol(entry.type);const atom=m.root.items[0];
    assert.equal(atom.regions.length,0);assert.equal(m.cursor.region,m.root.id);assert.equal(m.cursor.offset,1);
    assert.ok(m.exportLatex().startsWith(entry.exportTex??entry.tex));
    m.move(-1);assert.equal(m.cursor.offset,0);m.move(1);assert.equal(m.cursor.offset,1);
    m.remove(-1);assert.equal(m.root.items.length,1);m.undo();assert.equal(m.root.items[0].type,entry.type);
    m.undo();assert.equal(m.snapshot(),before);
  }
});
test('font formatting preserves symbols and nested structures and can switch font',()=>{
  const m=new EditorModel();m.setCursor(m.root.id,0);m.insertSymbol('symbol-alpha');
  m.setCursor(m.root.id,2,0);m.insertStructure('font-mathbfit');
  const node=m.parents.get(m.cursor.region).node, ids=node.regions.map(r=>r.id);
  assert.ok(m.exportLatex().startsWith('\\mathbfit{\\alpha \\frac'));
  const before=m.snapshot();m.switchVariant(node.id,'font-mathbfsfit');
  assert.deepEqual(node.regions.map(r=>r.id),ids);assert.ok(m.exportLatex().startsWith('\\mathbfsfit{'));
  m.undo();assert.equal(m.snapshot(),before);
});
test('restored drafts allocate fresh ids above saved node and region ids',()=>{
  const m=new EditorModel();m.root.id='r90000';m.root.items[0].id='n90001';
  m.setCursor(m.root.id,0);m.cursor={region:m.root.id,offset:1,anchor:1};
  const saved=m.snapshot(),restored=new EditorModel();restored.restore(saved);restored.insertStructure('sqrt');
  assert.equal(new Set(restored.order).size,restored.order.length);
  assert.ok(Number(restored.current.id.slice(1))>90001);
});

test('typing ^ and _ enters scripts for streamed and batched input',()=>{
  for(const [text,expected] of [['x^2','{x}^{2}'],['x_i','{x}_{i}'],['x^2_i','{x}_{i}^{2}'],['x_i^2','{x}_{i}^{2}'],['x^y^2','{x}^{{y}^{2}}']]){
    for(const chunks of [[text],Array.from(text)]){
      const m=new EditorModel();m.root.items=[];m.index();m.setCursor(m.root.id,0);
      for(const part of chunks)m.replaceInput(...m.range,part);
      assert.equal(m.exportLatex(),expected,text);assert.ok(m.current);assert.equal(m.projection(),text.endsWith('i')?'i':'2');
    }
  }
});
test('script shortcut wraps selection or preceding structure and is undoable',()=>{
  const m=new EditorModel();const before=m.snapshot();
  m.replaceInput(...m.range,'^2');assert.equal(m.exportLatex(),'{\\frac{\\sqrt{x+1}}{a+\\frac{b}{c}}}^{2}');
  m.undo();assert.equal(m.snapshot(),before);m.redo();assert.equal(m.current.label,'上标');
  const n=new EditorModel();n.root.items=['a','+','b'];n.index();n.setCursor(n.root.id,3,0);
  n.replaceInput(...n.range,'_i');assert.equal(n.exportLatex(),'{a+b}_{i}');
});
test('empty base and completing scripts preserve surrounding content',()=>{
  const m=new EditorModel();m.root.items=['x','+','z'];m.index();m.setCursor(m.root.id,1);
  m.replaceInput(...m.range,'^');assert.equal(m.current.label,'上标');m.replaceInput(...m.range,'2');
  m.move(1);m.replaceInput(...m.range,'_i');assert.equal(m.exportLatex(),'{x}_{i}^{2}+z');
  const n=new EditorModel();n.root.items=[];n.index();n.setCursor(n.root.id,0);n.replaceInput(0,0,'^2');assert.equal(n.exportLatex(),'{}^{2}');
});

test('every large operator starts with no limits or body slot and permits independent scripts',()=>{
  const {catalog}=require('./editor-model');
  for(const entry of catalog.filter(e=>e.operator)){
    const m=new EditorModel(),outer=m.root;m.insertStructure(entry.type);const node=outer.items.at(-1);
    assert.equal(m.current,outer);assert.equal(node.regions.length,0);
    const before=m.snapshot();m.replaceInput(...m.range,'_i');
    assert.equal(node.regions.length,1);assert.equal(node.regions[0].slot,'lower');
    m.replaceInput(...m.range,'^n');assert.equal(node.regions.length,2);
    m.move(1);assert.equal(m.current,outer);m.insert('x+y');assert.deepEqual(outer.items.slice(-3),['x','+','y']);
    m.toggleOperatorScript(node.id,'lower');assert.equal(node.regions.length,1);assert.equal(node.regions[0].slot,'upper');
    m.toggleOperatorScript(node.id,'upper');assert.equal(node.regions.length,0);assert.ok(m.current);
    m.undo();assert.equal(m.nodes.get(node.id).regions.length,1);m.redo();assert.equal(m.nodes.get(node.id).regions.length,0);
    assert.ok(!m.exportLatex().includes('undefined'),entry.type);
  }
});
test('old operator drafts migrate without losing nested bodies, limits or cursor',()=>{
  const m=new EditorModel();const body={id:'r99002',label:'运算内容',items:['x',m.root.items[0]]};
  const op={id:'n99003',type:'sum',regions:[{id:'r99000',label:'下限',items:['i']},{id:'r99001',label:'上限',items:[]},body]};
  m.root.items=['a',op,'z'];m.cursor={region:body.id,offset:1,anchor:0};m.index();
  assert.deepEqual(m.root.items.slice(0,3),['a',op,'x']);assert.equal(m.root.items.at(-1),'z');
  assert.equal(op.regions.length,1);assert.equal(op.regions[0].slot,'lower');
  assert.equal(m.cursor.region,m.root.id);assert.equal(m.cursor.offset,3);assert.equal(m.cursor.anchor,2);
  assert.equal(m.exportLatex(),'a\\sum_{i} x\\frac{\\sqrt{x+1}}{a+\\frac{b}{c}}z');
  const stable=m.snapshot();m.index();assert.equal(m.snapshot(),stable);
  m.switchVariant(op.id,'sumSide');assert.ok(m.exportLatex().includes('\\sum\\nolimits_{i} x'));assert.equal(op.regions.length,1);
});

test('deleting the last limit character removes only that limit and undo restores cursor',()=>{
  for(const marker of ['_','^']){
    const m=new EditorModel();m.insertStructure('sum');const node=m.root.items.at(-1);
    m.replaceInput(...m.range,marker+'i');const before=m.snapshot();
    m.remove(-1);assert.equal(node.regions.length,0);assert.equal(m.current,m.root);
    assert.ok(m.exportLatex().endsWith('\\sum '));
    m.undo();assert.equal(m.snapshot(),before);m.redo();assert.equal(m.current,m.root);
    m.insert('x');assert.ok(m.exportLatex().endsWith('\\sum x'));
  }
});
test('selection deletion and native input deletion remove empty limits but preserve opposite limit',()=>{
  const m=new EditorModel();m.insertStructure('integral');const node=m.root.items.at(-1);
  m.replaceInput(...m.range,'_ab^n');const upper=node.regions.find(r=>r.slot==='upper');
  const lower=node.regions.find(r=>r.slot==='lower');m.setCursor(lower.id,2,0);m.remove(1);
  assert.deepEqual(node.regions,[upper]);assert.equal(m.current,m.root);
  m.setCursor(upper.id,0);m.replaceInput(0,1,'');assert.equal(node.regions.length,0);
});
test('new empty limits remain enterable and backspace cancels them; normal fraction slots remain',()=>{
  const m=new EditorModel();m.insertStructure('sum');m.replaceInput(...m.range,'^');
  const node=m.parents.get(m.cursor.region).node;assert.equal(node.regions.length,1);
  m.remove(-1);assert.equal(node.regions.length,0);assert.equal(m.current,m.root);
  m.insertStructure('frac');const frac=m.parents.get(m.cursor.region).node;m.insert('x');m.remove(-1);
  assert.equal(frac.regions.length,2);assert.equal(m.current.items.length,0);assert.notEqual(m.current,m.root);
});

test('deleting ordinary scripts unwraps the base, preserves neighbors and restores on undo',()=>{
  for(const marker of ['^','_']){
    const m=new EditorModel();m.root.items=['x','+','y'];m.index();m.setCursor(m.root.id,1);
    m.replaceInput(...m.range,marker+'2');const before=m.snapshot();m.remove(-1);
    assert.equal(m.exportLatex(),'x+y');assert.equal(m.current,m.root);assert.equal(m.cursor.offset,1);
    m.undo();assert.equal(m.snapshot(),before);m.redo();assert.equal(m.exportLatex(),'x+y');
  }
});
test('combined scripts keep the opposite script before unwrapping the base',()=>{
  for(const first of [1,2]){
    const m=new EditorModel();m.root.items=[];m.index();m.setCursor(m.root.id,0);m.replaceInput(0,0,'x_i^2');
    const node=m.root.items[0],base=node.regions[0],other=node.regions[first===1?2:1];
    m.setCursor(node.regions[first].id,1,0);m.remove(1);
    assert.equal(node.type,first===1?'power':'subscript');assert.equal(node.regions[0],base);assert.equal(node.regions[1],other);
    assert.equal(m.current,m.root);assert.equal(m.cursor.offset,1);
    m.setCursor(other.id,0);m.replaceInput(0,1,'');assert.equal(m.exportLatex(),'x');assert.equal(m.cursor.offset,1);
  }
});
test('script removal preserves a structured base and only removes the innermost script',()=>{
  const m=new EditorModel(),base=m.root.items[0];m.replaceInput(...m.range,'^2');m.remove(-1);
  assert.equal(m.root.items[0],base);assert.equal(m.nodes.get(base.id),base);
  const n=new EditorModel();n.root.items=[];n.index();n.setCursor(n.root.id,0);n.replaceInput(0,0,'x^y^2');n.remove(-1);
  assert.equal(n.exportLatex(),'{x}^{y}');assert.equal(n.current.items.join(''),'y');assert.equal(n.cursor.offset,1);
});
test('empty newly created scripts can be cancelled without losing base; left scripts behave likewise',()=>{
  const m=new EditorModel();m.root.items=['x'];m.index();m.setCursor(m.root.id,1);m.replaceInput(...m.range,'^');m.remove(-1);
  assert.equal(m.exportLatex(),'x');
  for(const type of ['leftPower','leftSubscript','prescript']){
    const n=new EditorModel();n.setCursor(n.root.id,1,0);n.insertStructure(type);const node=n.parents.get(n.cursor.region).node;
    const base=node.regions[0].items[0];n.setCursor(node.regions[1].id,0);n.insert('a');n.remove(-1);
    assert.equal(n.root.items[0],base);assert.equal(n.current,n.root);
  }
});

test('font diagnostics preserve input, support Greek commands and clear after switching styles',()=>{
  const m=new EditorModel();m.root.items=[];m.index();m.setCursor(m.root.id,0);
  m.insertStructure('font-symcal');m.replaceInput(0,0,'Aα+');m.insertSymbol('symbol-beta');
  const before=m.snapshot();assert.equal(m.fontWarnings().length,2);assert.equal(m.snapshot(),before);
  const node=m.root.items[0];m.switchVariant(node.id,'font-symbf');assert.equal(m.fontWarnings().length,0);
  m.undo();assert.equal(m.fontWarnings().length,2);m.redo();assert.equal(m.fontWarnings().length,0);
});
test('font diagnostics follow nested regions and explicit inner fonts, retaining blackboard exceptions',()=>{
  const m=new EditorModel();m.root.items=[];m.index();m.setCursor(m.root.id,0);
  m.insertStructure('font-symbb');m.insert('αγπΓΠΣ');assert.equal(m.fontWarnings().length,0);
  m.insertStructure('frac');m.insert('β');assert.equal(m.fontWarnings().length,0);
  m.insertStructure('font-symup');m.insert('α');assert.equal(m.fontWarnings().length,0);
  m.insertSymbol('symbol-sin');assert.equal(m.fontWarnings().length,0);
});
test('Greek style resolver matches recorded LuaLaTeX unicode-math glyphs',()=>{
  const {buildSync}=require('esbuild'),vm=require('node:vm'),fs=require('node:fs');
  const code=buildSync({entryPoints:['src/unicode-math-greek.ts'],bundle:true,format:'cjs',write:false}).outputFiles[0].text;
  const sandbox={module:{exports:{}}};vm.runInNewContext(code,sandbox);
  const chars=Array.from('αβγδϵεζηθϑικϰλμνξοπϖρϱσςτυϕφχψωΓΔΘΛΞΠΣΥΦΨΩ∂∇');
  const rows=fs.readFileSync('diagnostics/tex-font-audit/glyphs.tsv','utf8').trim().split(/\r?\n/).slice(1);
  for(const row of rows){const [style,cmd,input,index,hex]=row.split('\t');if(input!=='macro')continue;
    assert.equal(sandbox.module.exports.unicodeMathGreek(chars[Number(index)-1],[cmd.slice(3)],style).codePointAt(0),parseInt(hex,16),style+' '+cmd+' '+index);
  }
});


test('unicode-math diagnostic coverage agrees with real TeX for every warned audit character',()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const code=require('esbuild').buildSync({entryPoints:['src/font-diagnostics.ts'],bundle:true,format:'cjs',write:false}).outputFiles[0].text;
  const sandbox={module:{exports:{}}};vm.runInNewContext(code,sandbox);
  const {fontDiagnostic}=sandbox.module.exports;
  const chars=Array.from('Aa019αΓγπΠΣ∂∇ıȷϝ');
  const rows=fs.readFileSync('diagnostics/font-diagnostics-audit/glyphs.tsv','utf8').trim().split(/\r?\n/).slice(1).map(l=>l.split('\t'));
  let checked=0;
  for(const style of ['TeX','ISO']){
    const baseline=rows.filter(r=>r[0]===style&&r[1]==='default');assert.equal(baseline.length,chars.length);
    for(const row of rows.filter(r=>r[0]===style&&r[1]!=='default')){
      const [,cmd,input,i,hex]=row,char=chars[Number(i)-1],warning=fontDiagnostic(cmd,char);
      if(!warning)continue;
      const reference=input==='nested'?rows.filter(r=>r[0]===style&&r[1]==='symbf'&&r[2]==='macro'):baseline;
      assert.equal(hex,reference[Number(i)-1][4],`${style} ${cmd} ${input} ${char}`);
      assert.match(warning,/unicode-math/);assert.match(warning,/沿用外层或默认样式/);assert.doesNotMatch(warning,/不存在|字体不支持/);checked++;
    }
  }
  assert.ok(checked>150);
});
test('all font menu commands diagnose only uncovered character classes without blocking edits',()=>{
  const {catalog}=require('./editor-model.js');
  const digit=['symit','symsfit','symbfit','symbfsfit','symcal','symscr','symbfcal','symbfscr','symfrak','symbffrak'];
  const greek=['symsf','symsfup','symsfit','symcal','symscr','symbfcal','symbfscr','symfrak','symbffrak','symtt'];
  for(const def of catalog.filter(d=>d.font&&!d.legacy&&d.command.startsWith('\\sym'))){
    const m=new EditorModel();m.root.items=[];m.index();m.setCursor(m.root.id,0);m.insertStructure(def.type);
    m.insert('Aα1+');const before=m.snapshot(),warnings=m.fontWarnings(),cmd=def.command.slice(1);
    assert.deepEqual(warnings.map(w=>w.index),[...(greek.includes(cmd)?[1]:[]),...(digit.includes(cmd)?[2]:[])],cmd);
    assert.equal(m.snapshot(),before);const preferred=({symup:'mathrm',symrm:'mathrm',symbfcal:'mathbfcal'})[cmd]??cmd.replace(/^sym/,'math');
    assert.equal(m.exportLatex(),cmd==='symbb'?'\\mathbb{A}\\bbalpha \\mathbb{1}+':`\\${preferred}{Aα1+}`);
  }
});
test('symbol commands, nested style overrides, old aliases, and restored drafts receive accurate hints',()=>{
  const m=new EditorModel();m.root.items=[];m.index();m.setCursor(m.root.id,0);
  m.insertStructure('font-mathsf');m.insertSymbol('symbol-partial');m.insertSymbol('symbol-nabla');m.insertSymbol('symbol-imath');
  assert.equal(m.fontWarnings().length,3);assert.match(m.fontWarnings()[0].message,/\\symsf/);
  m.insertStructure('font-symit');m.insertSymbol('symbol-partial');m.insertSymbol('symbol-imath');assert.equal(m.fontWarnings().length,3);
  m.insertSymbol('symbol-sin');m.insertSymbol('symbol-infty');assert.equal(m.fontWarnings().length,3);
  const n=new EditorModel();n.restore(m.snapshot());assert.deepEqual(n.fontWarnings(),m.fontWarnings());
});

test('named operators have one palette and command path with optional limits',()=>{
 const {catalog,symbols}=require('./editor-model');
 const names=['lim','limsup','liminf','sup','inf','max','min'];
 for(const name of names){
  assert.ok(!symbols.some(e=>!e.hidden&&e.command==='\\'+name));
  const op=catalog.find(e=>e.operatorCommand===name&&e.variantOf===e.type);
  assert.ok(op);
  const m=new EditorModel();m.root.items=[];m.index();m.setCursor(m.root.id,0);
  m.replaceInput(0,0,'\\'+name);
  const candidates=m.commandCandidates().filter(e=>e.name===name);
  assert.equal(candidates.length,1);assert.equal(candidates[0].type,op.type);
  m.commitCommand();const node=m.root.items[0];assert.equal(node.type,op.type);assert.equal(node.regions.length,0);
  m.replaceInput(...m.range,'_i');assert.equal(node.regions[0].slot,'lower');
 }
 assert.ok(symbols.some(e=>!e.hidden&&e.type==='symbol-sin'));
});

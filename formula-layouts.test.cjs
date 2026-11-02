const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const compiled=buildSync({stdin:{contents:`export * from './src/formula-layouts';export {EditorModel,catalog} from './src/editor-model';export {convertMath} from './src/tex-convert';export {equationNumbering} from './src/math-equation-numbering';`,resolveDir:__dirname},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const loaded={exports:{}};new Function('module','exports','require',compiled)(loaded,loaded.exports,require);const api=loaded.exports;
const blank=()=>{const model=new api.EditorModel();model.root.items=[];model.index();model.setCursor(model.root.id,0);return model;};
const nodes=root=>root.items.flatMap(item=>typeof item==='string'?[]:[item,...item.regions.flatMap(nodes)]);

test('the five document entries initialize whole-formula containers and cannot be inserted as components',()=>{
  assert.equal(api.formulaEntries.length,5);
  for(const entry of api.formulaEntries){
    const model=blank();assert.equal(model.initializeFormula(entry.defaultType),true);
    const definition=model.formulaLayout();assert.equal(definition.scope,'formula');assert.equal(definition.formula.kind,entry.kind);
    assert.equal(model.initializeFormula(entry.defaultType),false);
    const before=model.snapshot();assert.throws(()=>model.insertStructure(entry.defaultType),/whole-formula/);assert.equal(model.snapshot(),before);
    model.setCursor(model.root.id,0);model.insert('a');assert.equal(model.root.items.length,1);assert.equal(model.formulaLayout().formula.kind,entry.kind);
    model.setCursor(model.root.id,1);model.insert('+');assert.equal(model.root.items.length,1);
  }
});

test('all layout variants export native environments and preserve row IDs and edited contents',()=>{
  for(const entry of api.formulaEntries){
    const model=blank();model.initializeFormula(entry.defaultType);model.insert('f=');
    const node=model.root.items[0],beforeIds=nodes(model.root).flatMap(item=>item.regions.map(r=>r.id));
    for(const variant of api.formulaLayouts.filter(layout=>layout.kind===entry.kind)){
      if(node.type!==variant.type)assert.equal(model.switchVariant(node.id,variant.type),true);
      assert.deepEqual(nodes(model.root).flatMap(item=>item.regions.map(r=>r.id)),beforeIds);
      const source=model.exportLatex();assert.ok(source.startsWith('\\begin{'+variant.environment+'}'));
      assert.doesNotMatch(source,/\\begin\{equation\}.*\\begin\{(?:numcases|align|gather|multline)\}/);
      assert.ok(source.includes('f='));
      const restored=blank();restored.restore(model.snapshot());assert.equal(restored.exportLatex(),source);
    }
  }
});

test('rows, subrows and unnumbered variants consume only the intended document numbers',()=>{
  for(const layout of api.formulaLayouts){
    const model=blank();model.initializeFormula(layout.type);const source=model.exportLatex();
    assert.equal(api.equationNumbering(source).count,layout.numbering==='none'?0:layout.numbering==='rows'?2:1,source);
  }
});

test('supported standalone source imports as a root entry; illegal nesting retains complete source',()=>{
  for(const source of [String.raw`\begin{align}a&=b\\c&=d\end{align}`,String.raw`\begin{gather}a\\b\end{gather}`,String.raw`\begin{multline}a+b\\+c\end{multline}`,String.raw`\begin{equation}x=1\end{equation}`,String.raw`\begin{equation}\begin{aligned}a&=b\\c&=d\end{aligned}\end{equation}`,String.raw`\begin{numcases}{f=}x&positive\\-x&otherwise\end{numcases}`]){
    const model=api.convertMath(source);assert.equal(model.formulaLayout()?.scope,'formula',source);assert.equal(model.exportLatex(),source);
  }
  for(const source of [String.raw`x+\begin{numcases}{}x&positive\\-x&otherwise\end{numcases}`,String.raw`\frac{\begin{align}a&b\end{align}}{c}`,String.raw`\begin{equation}\begin{numcases}{}a&b\end{numcases}\end{equation}`]){
    const model=api.convertMath(source);assert.equal(model.root.items[0].type,'source-tex');assert.equal(model.exportLatex(),source);
  }
});

test('whole formula clipboard rejects nesting before changing destination or undo history',()=>{
  const whole=blank();whole.initializeFormula('formula-align');
  const destination=blank();destination.insertStructure('sqrt');destination.insert('x');
  const before=destination.snapshot(),history=destination.undoStack.length;
  assert.throws(()=>destination.replaceFragment(whole.root.items),/complete formula/);assert.equal(destination.snapshot(),before);assert.equal(destination.undoStack.length,history);
  const empty=blank();empty.replaceFragment(whole.root.items);assert.equal(empty.formulaLayout().formula.kind,'align');
  const fresh=blank();fresh.initializeFormula('formula-equation');const freshBefore=fresh.snapshot();fresh.replaceFragment(whole.root.items);
  assert.equal(fresh.formulaLayout().formula.kind,'align');fresh.undo();assert.equal(fresh.snapshot(),freshBefore);
  assert.throws(()=>destination.insertSourceTex(String.raw`\begin{equation}x\end{equation}`),/complete formula/);assert.equal(destination.snapshot(),before);
});

test('legacy mixed numcases moves only an unambiguous prefix into the empty lhs and keeps identities',()=>{
  const model=blank();model.initializeFormula('numcases');const node=model.root.items[0],ids=nodes(model.root).map(item=>item.id),leftId=node.regions[0].id;
  model.root.items=['Z','=',node];model.cursor={region:model.root.id,offset:2,anchor:2};model.index();
  assert.equal(model.root.items.length,1);assert.deepEqual(node.regions[0].items,['Z','=']);assert.equal(model.cursor.region,leftId);
  assert.deepEqual(nodes(model.root).map(item=>item.id),ids);assert.match(model.exportLatex(),/^\\begin\{numcases\}\{Z=\}/);
});

test('all multiline entries edit rows in place and undo without changing existing region identities',()=>{
  for(const entry of api.formulaEntries.filter(entry=>entry.kind!=='equation')){
    const model=blank();model.initializeFormula(entry.defaultType);const root=model.root.items[0];
    const table=entry.kind==='cases'?root.regions[1].items[0]:root;
    const ids=table.regions.map(region=>region.id);model.setCursor(table.regions[0].id,0);model.insert('a');
    const before=model.snapshot();assert.equal(model.editTable(table.id,table.regions[0].id,'rowAfter'),true);
    assert.equal(table.rows,3);assert.equal(table.regions[0].id,ids[0]);assert.equal(table.regions[2*table.columns].id,ids[table.columns]);
    model.undo();assert.equal(model.snapshot(),before);
  }
});

test('piecewise numbering changes retain mathematical conditions and imported textual conditions',()=>{
  const model=blank();model.initializeFormula('formula-cases');const root=model.root.items[0],body=root.regions[1].items[0];
  model.setCursor(body.regions[1].id,0);model.insert('x>0');const id=body.regions[1].id;
  model.switchVariant(root.id,'numcases');assert.ok(model.exportLatex().includes('&$x>0$'));assert.equal(body.regions[1].id,id);
  model.switchVariant(root.id,'formula-cases');assert.ok(model.exportLatex().includes('&x>0'));assert.deepEqual(body.regions[1].items,Array.from('x>0'));
  const source=String.raw`\begin{numcases}{f=}x&if $x>0$\\0&otherwise\end{numcases}`,imported=api.convertMath(source),node=imported.root.items[0];
  imported.switchVariant(node.id,'formula-cases');assert.ok(imported.exportLatex().includes(String.raw`\textnormal{if $x>0$}`));
  imported.switchVariant(node.id,'numcases');assert.equal(imported.exportLatex(),source);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {buildSync}=require('esbuild');
const loaded={exports:{}};
new Function('module','exports','require',buildSync({stdin:{contents:`
export {EditorModel,catalog} from './src/editor-model';
export {convertMath} from './src/tex-convert';
export {mathJaxExtensionLoads,mathJaxTexPackages,mathJaxDisabledTexPackages} from './src/mathjax-extension-policy';
`,resolveDir:__dirname},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text)(loaded,loaded.exports,require);
const api=loaded.exports;
const def=name=>api.catalog.find(entry=>entry.type==='physics-'+name);
const model=()=>{const m=new api.EditorModel();m.root.items=[];m.index();m.setCursor(m.root.id,0);return m;};
const sample=(name,args)=>{
  const m=model();m.insertStructure('physics-'+name);const node=m.root.items[0];
  args.forEach((value,i)=>{m.setCursor(node.regions[i].id,0);m.insert(value);});
  return {m,node};
};
const examples=[
  ...['dv','pdv','fdv'].flatMap(name=>[
    [name+'Operator',['x']],[name+'OperatorFlat',['x']],
    [name+'OperatorOrder',['x','2']],[name+'OperatorOrderFlat',['x','2']],
    [name+'Order',['f','x','2']],[name+'OrderFlat',['f','x','2']],
  ]),
  ['pdvMixed',['f','x','y']],['pdvMixedFlat',['f','x','y']],
  ['ddOrder',['x','2']],['varOrder',['x','2']],
  ['braketSelf',['a']],['braketSelfStar',['a']],['ketbraSelf',['a']],['ketbraSelfStar',['a']],
  ['expvalStar',['A']],['expvalState',['A','a']],['expvalStateStar',['A','a']],['expvalStateDoubleStar',['A','a']],
];

test('physics GUI variants are reachable through their existing primary buttons',()=>{
  for(const [name,args] of examples){
    const entry=def(name),primary=api.catalog.find(item=>item.type===entry.variantOf);
    assert.ok(!entry.hidden&&!entry.legacy,name);assert.ok(primary&&!primary.hidden&&!primary.legacy,name);
    assert.equal(entry.labels.length,args.length,name);
    const {m}=sample(name,args);assert.equal(m.exportLatex(),entry.render(args),name);
  }
  // These are either redundant command spellings or options ignored upstream.
  for(const name of ['pdvMixedOrder','pdvMixedOrderFlat','expvalDoubleStar','pqty','bqty','Bqty','vqty'])assert.equal(def(name).hidden,true,name);
});

test('derivative variants preserve variable identity and never reinterpret an order as another variable',()=>{
  const {m,node}=sample('dvOperator',['x']),variable=node.regions[0],cursor={...m.cursor};
  assert.ok(m.switchVariant(node.id,'physics-dvOrder'));
  assert.equal(node.regions[1],variable);assert.deepEqual(m.cursor,cursor);
  m.setCursor(node.regions[0].id,0);m.insert('f');m.setCursor(node.regions[2].id,0);m.insert('2');
  assert.equal(m.exportLatex(),String.raw`\dv[2]{f}{x}`);
  assert.equal(m.canSwitchVariant(node.id,'physics-dv'),false,'Nonempty order cannot be discarded');
  assert.equal(m.canSwitchVariant(node.id,'physics-dvOperator'),false,'Nonempty function cannot be discarded');
  const regions=[...node.regions];assert.ok(m.switchVariant(node.id,'physics-dvOrderFlat'));assert.deepEqual(node.regions,regions);
  m.undo();assert.equal(m.exportLatex(),String.raw`\dv[2]{f}{x}`);

  const partial=sample('pdvOrder',['f','x','2']);
  assert.equal(partial.m.canSwitchVariant(partial.node.id,'physics-pdvMixed'),false);
  partial.m.setCursor(partial.node.regions[2].id,0,1);partial.m.insert('');
  const kept=partial.node.regions.slice(0,2);
  assert.ok(partial.m.switchVariant(partial.node.id,'physics-pdvMixed'));
  assert.deepEqual(partial.node.regions.slice(0,2),kept);assert.equal(partial.node.regions[2].items.length,0);
  partial.m.setCursor(partial.node.regions[2].id,0);partial.m.insert('y');
  assert.equal(partial.m.exportLatex(),String.raw`\pdv{f}{x}{y}`);
  assert.equal(partial.m.canSwitchVariant(partial.node.id,'physics-pdvOrder'),false);
});

test('expectation and higher differential options keep their operands and cannot erase nonempty options',()=>{
  const {m,node}=sample('expval',['A']),expression=node.regions[0];
  assert.ok(m.switchVariant(node.id,'physics-expvalState'));assert.equal(node.regions[0],expression);
  m.setCursor(node.regions[1].id,0);m.insert('a');
  assert.equal(m.canSwitchVariant(node.id,'physics-expval'),false);
  const regions=[...node.regions];assert.ok(m.switchVariant(node.id,'physics-expvalStateDoubleStar'));assert.deepEqual(node.regions,regions);
  assert.equal(m.exportLatex(),String.raw`\expval**{A}{a}`);
  for(const name of ['dd','var']){
    const value=sample(name,['x']),variable=value.node.regions[0];
    assert.ok(value.m.switchVariant(value.node.id,'physics-'+name+'Order'));assert.equal(value.node.regions[0],variable);
    value.m.setCursor(value.node.regions[1].id,0);value.m.insert('2');
    assert.equal(value.m.canSwitchVariant(value.node.id,'physics-'+name),false);
  }
});

test('same-state products insert directly without silently merging or duplicating independently editable states',()=>{
  for(const name of ['braket','ketbra']){
    const {m,node}=sample(name+'Self',['a']),state=node.regions[0];
    assert.ok(m.switchVariant(node.id,'physics-'+name+'SelfStar'));assert.equal(node.regions[0],state);
    assert.equal(m.canSwitchVariant(node.id,'physics-'+name),false);
    const separate=sample(name,['a','b']);assert.equal(separate.m.canSwitchVariant(separate.node.id,'physics-'+name+'Self'),false);
  }
});

test('new physics GUI choices roundtrip through editable nodes with native MathJax output',async()=>{
  const root=pathToFileURL(path.dirname(require.resolve('mathjax/node-main.cjs'))+'/').href.replace(/\/$/,'');
  const M=await require('mathjax').init({
    loader:{paths:{mathjax:root},load:['input/tex',...api.mathJaxExtensionLoads.filter(name=>name!=='[tex]/bboldx')]},
    tex:{packages:{'[+]':api.mathJaxTexPackages.filter(entry=>(Array.isArray(entry)?entry[0]:entry)!=='bboldx'),'[-]':api.mathJaxDisabledTexPackages}},
    startup:{typeset:false},
  });
  const clean=value=>value.replace(/\sdata-latex(?:-[\w-]+)?="[^"]*"/g,'').replace(/>\s+</g,'><').trim();
  for(const [name,args] of examples){
    const source=def(name).render(args),converted=api.convertMath(source);
    assert.equal([...converted.nodes.values()].some(node=>node.type==='source-tex'),false,source);
    const actual=await M.tex2mmlPromise(converted.exportLatex()),expected=await M.tex2mmlPromise(source);
    assert.doesNotMatch(actual,/<merror\b/,source);assert.doesNotMatch(expected,/<merror\b/,source);
    assert.equal(clean(actual),clean(expected),name);
  }
});

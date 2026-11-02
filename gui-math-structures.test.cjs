// SPDX-License-Identifier: GPL-3.0-or-later
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {buildSync}=require('esbuild');
const loaded={exports:{}};
new Function('module','exports','require',buildSync({stdin:{contents:`
export {EditorModel,catalog,symbols} from './src/editor-model';
export {convertMath} from './src/tex-convert';
export {mathjaxCommands,mathjaxCommandDefinition} from './src/mathjax-commands';
export * from './src/mathjax-extension-policy';
`,resolveDir:__dirname},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text)(loaded,loaded.exports,require);
const api=loaded.exports;
const arrows=['xtwoheadrightarrow','xtwoheadleftarrow','xtofrom','xlongequal'];
const fixtures=[
  ...arrows.map(type=>({type,source:`\\${type}[\\sqrt{x}]{\\frac{a}{b}}`,slots:2})),
  {type:'overparen',source:String.raw`\overparen{\frac{a}{b}+x}`,slots:1},
  {type:'underparen',source:String.raw`\underparen{\frac{a}{b}+x}`,slots:1},
  {type:'overunderset',source:String.raw`\overunderset{\frac{a}{b}}{\sqrt{x}}{=}`,slots:3},
  {type:'pmod',source:String.raw`\pmod{\frac{a}{b}+x}`,slots:1},
  {type:'mod',source:String.raw`\mod{\frac{a}{b}+x}`,slots:1},
  {type:'pod',source:String.raw`\pod{\frac{a}{b}+x}`,slots:1},
  {type:'layout-centernot',source:String.raw`\centernot{\subseteq}`,slots:1},
  {type:'layout-nicefrac',source:String.raw`\nicefrac{\sqrt{x}}{b+c}`,slots:2},
];
const visible=entry=>entry&&!entry.hidden&&!entry.legacy&&entry.scope!=='formula';
const reachable=entry=>visible(entry)&&(!entry.variantOf||entry.variantOf===entry.type||api.catalog.some(primary=>primary.type===entry.variantOf&&visible(primary)&&(!primary.variantOf||primary.variantOf===primary.type)));
const blank=()=>{const model=new api.EditorModel();model.root.items=[];model.index();model.setCursor(model.root.id,0);return model;};
const converted=source=>{
  const model=api.convertMath(source);
  assert.equal([...model.nodes.values()].some(node=>node.type==='source-tex'),false,source);
  return model;
};
const clean=markup=>markup.replace(/\sdata-latex(?:-[a-z]+)?="[^"]*"/g,'').replace(/\s+/g,' ').trim();
const ids=region=>[region.id,...region.items.flatMap(item=>typeof item==='string'?[]:[item.id,...item.regions.flatMap(ids)])];
let runtime;
async function mathjax(){
  if(!runtime)runtime=require('mathjax').init({
    loader:{paths:{mathjax:pathToFileURL(path.resolve('node_modules/mathjax')).href},load:['input/tex',...api.mathJaxExtensionLoads]},
    tex:{packages:{'[+]':api.mathJaxTexPackages,'[-]':api.mathJaxDisabledTexPackages},require:api.mathJaxRequireOptions,textmacros:{packages:{'[+]':['textcomp']}}},
    startup:{typeset:false},
  });
  return runtime;
}

test('all configured labeled-arrow handlers have reachable GUI structures, including extpfeil arrows',()=>{
  // mhchem's generated reaction helpers stay behind its existing ce/pu entry.
  // They are not standalone public mathematical arrow commands.
  const configured=api.mathjaxCommands.filter(command=>api.mathjaxCommandDefinition(command)?.handler==='xArrow'&&!command.name.startsWith('mhchem'));
  for(const command of configured){
    const entry=api.catalog.find(entry=>entry.render(entry.labels.map(()=>'')).startsWith('\\'+command.name+'['));
    assert.ok(reachable(entry),command.name+' needs a primary button or reachable variant');
    assert.equal(entry.labels.length,2,command.name+' has upper and lower annotations');
  }
  for(const type of arrows)assert.ok(configured.some(command=>command.name===type),type+' uses the real configured handler');
});

test('new symbol structures are insertable through the existing palette without entering LaTeX',()=>{
  for(const fixture of fixtures){
    const entry=api.catalog.find(entry=>entry.type===fixture.type);
    assert.ok(reachable(entry),fixture.type);
    const model=blank();model.insertStructure(fixture.type);
    const node=model.root.items[0];
    assert.equal(node.type,fixture.type);
    assert.equal(node.regions.length,fixture.slots,fixture.type);
    assert.ok(node.regions.some(region=>region.id===model.cursor.region),fixture.type+' focuses an editable argument');
  }
});

test('new structure imports and exports preserve native MathJax meaning inside a surrounding sequence',async()=>{
  const M=await mathjax();
  for(const fixture of fixtures){
    const source='u'+fixture.source+'+v',model=converted(source);
    const node=[...model.nodes.values()].find(node=>node.type===fixture.type);
    assert.ok(node,fixture.type);assert.equal(node.regions.length,fixture.slots);
    const expected=await M.tex2mmlPromise(source),actual=await M.tex2mmlPromise(model.exportLatex());
    assert.doesNotMatch(expected,/<merror/,fixture.type);assert.doesNotMatch(actual,/<merror/,fixture.type);
    assert.equal(clean(actual),clean(expected),fixture.type+' must preserve math classes and argument order');
  }
});

test('labeled arrows accept omitted lower annotations and keep upper and lower regions distinct',async()=>{
  const M=await mathjax();
  for(const type of arrows){
    for(const source of [`\\${type}{u}`,`\\${type}[d]{u}`]){
      const model=converted(source),node=model.root.items[0];
      assert.equal(node.type,type);assert.deepEqual(node.regions.map(region=>region.items.join('')),['u',source.includes('[')?'d':'']);
      assert.equal(clean(await M.tex2mmlPromise(model.exportLatex())),clean(await M.tex2mmlPromise(source)),source);
    }
  }
  const model=converted(String.raw`\overunderset{u}{d}{=}`),node=model.root.items[0];
  assert.equal(node.type,'overunderset');assert.deepEqual(node.regions.map(region=>region.items.join('')),['=','u','d']);
});

test('new structures retain nested contents through save, native selection copy, and repeated paste',()=>{
  for(const fixture of fixtures){
    const model=converted(fixture.source),latex=model.exportLatex();
    const restored=new api.EditorModel();restored.restore(model.snapshot());assert.equal(restored.exportLatex(),latex,fixture.type);
    model.setCursor(model.root.id,1,0);
    const selected=new api.EditorModel();selected.restore(model.selectionSnapshot());
    const pasted=blank();pasted.replaceFragment(selected.root.items);pasted.replaceFragment(selected.root.items);
    assert.equal(pasted.root.items[0].type,fixture.type);assert.equal(pasted.root.items[1].type,fixture.type);
    assert.equal(pasted.exportLatex(),latex+latex,fixture.type);
    const allIds=ids(pasted.root);assert.equal(allIds.length,new Set(allIds).size,fixture.type+' pasted components need independent IDs');
    for(const id of ids(selected.root))assert.equal(allIds.includes(id),false,fixture.type+' clipboard IDs must not be reused');
    assert.equal(selected.exportLatex(),latex,fixture.type+' paste must not mutate the source');
  }
});

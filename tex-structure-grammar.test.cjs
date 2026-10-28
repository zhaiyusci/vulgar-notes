const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {buildSync}=require('esbuild');
const compiled=buildSync({stdin:{contents:`export * from './src/tex-structure-grammar'; export {EditorModel,catalog} from './src/editor-model'; export {convertMath} from './src/tex-convert'; export {mathJaxExtensionLoads,mathJaxTexPackages,mathJaxDisabledTexPackages} from './src/mathjax-extension-policy';`,resolveDir:__dirname},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const loaded={exports:{}};new Function('module','exports','require',compiled)(loaded,loaded.exports,require);
const api=loaded.exports;
let serial=30000000,mathjax;
const region=items=>({id:'r'+ ++serial,label:'',items});
const factory=(type,regions,dimensions)=>({id:'n'+ ++serial,type,regions,...dimensions});
const raw=source=>region(source?[factory('source-tex',[region(Array.from(source))])]:[]);
const parse=source=>api.parseTexCatalogStructure(source,0,raw,factory);
const saved=node=>{
  const model=new api.EditorModel(),root=region([node]);
  model.restore(JSON.stringify({version:2,root,cursor:{region:root.id,offset:1,anchor:1}}));return model;
};
const content=region=>region.items.map(item=>typeof item==='string'?item:item.regions[0].items.join('')).join('');
const canonical=source=>source.replace(/\sdata-latex(?:-[\w-]+)?="[^"]*"/g,'').replace(/>\s+</g,'><').trim();
test.before(async()=>{
  const root=pathToFileURL(path.dirname(require.resolve('mathjax/node-main.cjs'))+'/').href.replace(/\/$/,'');
  // All enabled TeX layout packages and their real priority policy, without
  // loading a font package for these input-only non-alphabet grammar checks.
  mathjax=await require('mathjax').init({
    loader:{paths:{mathjax:root},load:['input/tex',...api.mathJaxExtensionLoads.filter(name=>name!=='[tex]/bboldx')]},
    tex:{packages:{'[+]':api.mathJaxTexPackages.filter(entry=>(Array.isArray(entry)?entry[0]:entry)!=='bboldx'),'[-]':api.mathJaxDisabledTexPackages}},
    startup:{typeset:false},
  });
});
async function mml(source){
  mathjax.startup.document.inputJax[0].parseOptions.tags.reset(0);
  const result=await mathjax.tex2mmlPromise(source,{display:false});assert.doesNotMatch(result,/<merror\b/,source);return canonical(result);
}
async function equivalent(source,result){
  assert.ok(result,source);const exported=saved(result.node).exportLatex();
  assert.equal(await mml(exported),await mml(source),source+' -> '+exported);return exported;
}

test('all render-derived grammar templates preserve exact MathML including atom classes',async()=>{
  const coverage=api.texCatalogStructureCoverage(),failures=[];
  assert.ok(coverage.supported.length>80,'Substantial actual catalog coverage');
  for(const type of coverage.supported){
    const definition=api.catalog.find(entry=>entry.type===type),source=definition.render(definition.labels.map((_,index)=>String.fromCharCode(97+index)));
    try{const result=parse(source);assert.ok(result);assert.equal(result.next,source.length);await equivalent(source,result);}
    catch(error){failures.push({type,source,message:String(error.message).split('\n')[0]});}
  }
  assert.deepEqual(failures,[]);
});

test('optional lower arrow annotations and their nested contents use the correct argument order',async()=>{
  for(const command of ['xrightarrow','xleftarrow','xleftrightarrow','xLeftarrow','xRightarrow','xLeftrightarrow','xhookleftarrow','xhookrightarrow','xmapsto','xleftharpoonup','xleftharpoondown','xrightharpoonup','xrightharpoondown','xleftrightharpoons','xrightleftharpoons']){
    for(const lower of ['',String.raw`[\frac{a}{b}]`]){
      const source='\\'+command+lower+String.raw`{\hat{x}}+tail`,result=parse(source);
      assert.ok(result,source);assert.equal(source.slice(result.next),'+tail');
      assert.equal(content(result.node.regions[0]),String.raw`\hat{x}`);
      assert.equal(content(result.node.regions[1]),lower?String.raw`\frac{a}{b}`:'');
      await equivalent(source.slice(0,result.next),result);
    }
  }
});

test('brace and bracket annotations preserve the script placement rather than wrapping an Ord base',async()=>{
  for(const [command,script] of [['overbrace','^'],['underbrace','_'],['overbracket','^'],['underbracket','_']]){
    for(const annotation of ['{a}',String.raw`\alpha`]){
      const source='\\'+command+'{x+y}'+script+annotation+'+z',result=parse(source);
      assert.ok(result,source);assert.equal(result.node.type,command);assert.equal(content(result.node.regions[0]),'x+y');
      assert.equal(source.slice(result.next),'+z');
      if(annotation.startsWith('{'))await equivalent(source.slice(0,result.next),result);
      else {
        const before=await mml(source.slice(0,result.next)),after=await mml(saved(result.node).exportLatex());
        // Bracing a single ordinary Greek script token is harmless; retain
        // every OP/base class and every other group in this comparison.
        assert.equal(after.replace(/<mrow data-mjx-texclass="ORD">(<mi>&#x3B1;<\/mi>)<\/mrow>/g,'$1'),before);
        assert.match(after,/data-mjx-texclass="OP"/);
      }
    }
  }
});

test('genfrac constants are matched exactly and unsupported delimiter, size or thickness is declined',async()=>{
  for(const type of ['genfracBrackets','genfracBraces']){
    const definition=api.catalog.find(entry=>entry.type===type),source=definition.render(['x','y']);
    const result=parse(source);assert.equal(result.node.type,type);await equivalent(source,result);
  }
  for(const source of [String.raw`\genfrac{(}{)}{0pt}{}{x}{y}`,String.raw`\genfrac{[}{]}{1pt}{}{x}{y}`,String.raw`\genfrac{[}{]}{0pt}{2}{x}{y}`])assert.equal(parse(source),null,source);
});

test('fixed-size parentheses preserve their exact delimiter command and nested fences',async()=>{
  for(const size of ['big','Big','bigg','Bigg']){
    const source='\\'+size+'l('+String.raw`\frac{a}{b}+\bigl(x\bigr)`+'\\'+size+'r)+tail',result=parse(source);
    assert.ok(result,source);assert.equal(result.node.type,'paren'+size);assert.equal(source.slice(result.next),'+tail');await equivalent(source.slice(0,result.next),result);
  }
  assert.equal(parse(String.raw`\bigl(x\Bigr)`),null);
});

test('substack dynamically preserves any number of rows and atop keeps its outer group',async()=>{
  const source=String.raw`\substack{a\\b\\c\\d}+tail`,result=parse(source);
  assert.equal(result.node.type,'substack');assert.equal(result.node.rows,4);assert.equal(result.node.columns,1);
  assert.equal(source.slice(result.next),'+tail');await equivalent(source.slice(0,result.next),result);
  const atop=String.raw`{a+b\atop c+d}`,fraction=parse(atop);assert.ok(fraction);assert.equal(fraction.node.type,'atop');await equivalent(atop,fraction);
});

test('physics explicit argument counts select the longest complete grammar and leave following prose alone',async()=>{
  for(const source of [String.raw`\dv{x}`,String.raw`\dv{f}{x}`,String.raw`\dv[2]{f}{x}`,String.raw`\dv*[2]{f}{x}`,String.raw`\pdv{f}{x}{y}`,String.raw`\pdv[3]{f}{x}{y}`,String.raw`\expval{A}`,String.raw`\expval{A}{\psi}`,String.raw`\ev{A}{\psi}`,String.raw`\braket{a}`,String.raw`\braket{a}{b}`]){
    const result=parse(source+'+tail');assert.ok(result,source);assert.equal(result.next,source.length);await equivalent(source,result);
  }
  const mixed=parse(String.raw`\pdv{f}{x}{y}`);assert.equal(mixed.node.regions.length,3);
  const state=parse(String.raw`\expval{A}{\psi}`);assert.equal(state.node.regions.length,2);
  for(const source of [String.raw`\dv x + y`,String.raw`\pdv f x + y`,String.raw`\braket a + b`,String.raw`\qty x + y`])assert.equal(parse(source),null,source);
});

test('physics stars, explicit aliases and evaluation are compared against physics-priority MathJax',async()=>{
  for(const source of [String.raw`\vb*{x}`,String.raw`\vectorbold*{x}`,String.raw`\va*{x}`,String.raw`\vu*{x}`,String.raw`\comm*{a}{b}`,String.raw`\anticommutator*{a}{b}`,String.raw`\bra*{a}`,String.raw`\ket*{a}`,String.raw`\braket*{a}`,String.raw`\ketbra*{a}{b}`,String.raw`\expval*{A}{\psi}`,String.raw`\expval**{A}{\psi}`,String.raw`\mel**{a}{A}{b}`,String.raw`\dd[2]{x}`,String.raw`\var[2]{x}`,String.raw`\eval{x}`,String.raw`\evaluated*{x}`,String.raw`\derivative[2]{f}{x}`]){
    const result=parse(source);assert.ok(result,source);assert.equal(result.next,source.length);await equivalent(source,result);
  }
  assert.equal(parse(String.raw`\ev{a}`).node.type,'physics-expval');
  assert.equal(parse(String.raw`\evaluated{a}`).node.type,'physics-eval');
});

test('physics literal quantity delimiters and forced delimiters are not collapsed into one style',async()=>{
  for(const source of [String.raw`\qty(x)`,String.raw`\qty[x]`,String.raw`\qty{x}`,String.raw`\qty|x|`,String.raw`\qty[a[b]c]`,String.raw`\quantity{x}`,String.raw`\pqty{x}`,String.raw`\bqty{x}`,String.raw`\Bqty{x}`,String.raw`\vqty{x}`,String.raw`\pqty*{x}`,String.raw`\bqty*{x}`,String.raw`\Bqty*{x}`,String.raw`\vqty*{x}`]){
    const result=parse(source+'+tail');assert.ok(result,source);assert.equal(result.next,source.length);await equivalent(source,result);
  }
  assert.equal(parse(String.raw`\qty{x}`).node.type,'physics-qtyBraces');
  assert.equal(parse(String.raw`\qty[x]`).node.type,'physics-qtyBrackets');
  assert.equal(parse(String.raw`\qty(x)`).node.type,'physics-qty');
});

test('adjacent bra and ket form one consuming component so rendering wrappers cannot break their lookahead',async()=>{
  for(const left of ['', '*'])for(const right of ['', '*']){
    const source='\\bra'+left+'{a}\\ket'+right+'{b}',result=parse(source);
    assert.ok(result,source);assert.equal(result.next,source.length);assert.equal(result.node.regions.length,2);
    assert.match(result.node.type,/^physics-braKetAdjacent/);await equivalent(source,result);
  }
});

test('unknown control words and incomplete constant templates never consume unrelated following tokens',()=>{
  for(const source of [String.raw`\xrightarrowfoo{a}`,String.raw`\unknown{a}{b}`,String.raw`\dv[2]x+y`,String.raw`\genfrac{[}{]}{0pt}{`,String.raw`\qty(x`,String.raw`\overbrace{x}^{`])assert.equal(parse(source),null,source);
  const before=serial;
  assert.equal(api.parseTexCatalogStructure(String.raw`\dv x + y`,0,()=>{throw Error('No speculative region parse');},factory),null);
  assert.equal(serial,before);
  const coverage=api.texCatalogStructureCoverage();assert.ok(coverage.unsupported.every(entry=>entry.type&&entry.reason));
});

test('dedicated optional-argument parsers retain precedence over short catalog templates',()=>{
  for(const source of [String.raw`\sqrt[3`,String.raw`\cfrac[l`,String.raw`\overbracket[2pt`,String.raw`\xrightarrow[lower`,String.raw`\qty[unclosed`,String.raw`\dv[2`]){
    assert.equal(parse(source),null,source);
    assert.equal(api.convertMath(source).exportLatex(),source,source+' keeps the complete original source');
  }
});

const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const Module=require('node:module');
const {buildSync}=require('esbuild');
const loaded=new Module(path.join(process.cwd(),'tex-layout-structures-test.cjs'),module);loaded.paths=module.paths;
loaded._compile(buildSync({stdin:{contents:"export * from './src/tex-layout-structures';export * from './src/mathjax-extension-policy';export {importMath} from './src/tex-import';export {convertMath} from './src/tex-convert';export {EditorModel} from './src/editor-model';",loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text,loaded.id);
const api=loaded.exports,catalog=[];api.registerTexLayoutStructures(catalog);
let id=90000000;
const region=items=>({id:'r'+ ++id,label:'',items});
const factory=(type,regions)=>({id:'n'+ ++id,type,regions});
const raw=source=>region([factory('source-tex',[region(Array.from(source))])]);
const parse=(source,callback=raw,start=0)=>api.parseTexLayoutStructure(source,start,callback,factory);
const serialize=node=>{
  if(node.type==='source-tex')return node.regions[0].items.join('');
  const definition=catalog.find(entry=>entry.type===node.type);assert.ok(definition,node.type);
  const regions=node.regions.map(r=>r.items.map(item=>typeof item==='string'?item:serialize(item)).join(''));
  return node.texOptions===undefined?definition.render(regions):definition.command+node.texOptions+regions.map(value=>'{'+value+'}').join('');
};
const body=node=>node.regions.map(r=>r.items[0].regions[0].items.join(''));

test('layout registration is compact, hidden, idempotent and has explicit mathematical arity',()=>{
  assert.equal(catalog.length,34);assert.equal(new Set(catalog.map(entry=>entry.type)).size,34);
  const length=catalog.length;api.registerTexLayoutStructures(catalog);assert.equal(catalog.length,length);
  for(const definition of catalog){
    assert.equal(definition.hidden,true);assert.equal(definition.commandCandidate,!definition.type.endsWith('-quantity'));
    assert.equal(definition.ungroupScriptBase,true);assert.ok(definition.labels.length>0);
  }
  assert.equal(catalog.find(entry=>entry.type==='layout-mathchoice').labels.length,4);
  assert.equal(catalog.find(entry=>entry.type==='layout-units-quantity').labels.length,2);
});

test('all wrappers consume their exact braced arguments and keep following input untouched',()=>{
  for(const definition of catalog){
    const args=Array.from({length:definition.labels.length},(_,i)=>String.fromCharCode(97+i));
    const source=definition.render(args),result=parse(source+' +next');
    assert.ok(result,source);assert.equal(result.node.type,definition.type,source);
    assert.equal(serialize(result.node),source);assert.equal((source+' +next').slice(result.next),' +next');
    assert.deepEqual(body(result.node),args);
  }
  const source=String.raw`ab \phantom{\frac{x}{y}}+z`,result=parse(source,raw,3);
  assert.ok(result);assert.equal(source.slice(result.next),'+z');
  assert.equal(serialize(result.node),String.raw`\phantom{\frac{x}{y}}`);
});

test('safe mathematical content stays structural rather than becoming an opaque region',()=>{
  const parsed=[];
  const result=parse(String.raw`\mathrel{\frac{a}{b}+\sqrt{x}}`,source=>{
    const model=api.importMath(source);assert.ok(model,source);
    const r=JSON.parse(model.snapshot()).root;parsed.push(r);return r;
  });
  assert.ok(result);assert.equal(result.node.regions[0],parsed[0]);
  assert.deepEqual(parsed[0].items.filter(item=>typeof item!=='string').map(item=>item.type),['frac','sqrt']);
});

test('variable options retain exact bytes outside editable mathematical arguments',()=>{
  for(const source of [
    String.raw`\bbox[ 2px , #aBc , border: 1px solid blue ]{x+y}`,
    String.raw`\bbox[border: 1px solid red; width: 50%]{x}`,
    String.raw`\enclose{circle,updiagonalstrike}[mathcolor="red",data-padding=".2em"]{x}`,
    String.raw`\enclose{circle}  [background={red}]{x}`,
    String.raw`\enclose{circle}{x}`,
    String.raw`\smash[ t ]{x}`,
    String.raw`\mathclap[\scriptstyle]{x}`,
    String.raw`\nicefrac[\mathsf]{a}{b}`
  ]){
    const result=parse(source);assert.ok(result,source);assert.equal(serialize(result.node),source);
    const definition=catalog.find(entry=>entry.type===result.node.type);
    assert.equal(api.validateTexLayoutOptions(definition.texOptionsKind,result.node.texOptions),true);
  }
  const quantity=parse(String.raw`\unitfrac[\frac{1}{2}]{m}{s}+x`);
  assert.equal(quantity.node.texOptions,undefined);assert.deepEqual(body(quantity.node),[String.raw`\frac{1}{2}`,'m','s']);
});

test('escaped delimiters and braced right brackets do not truncate options or bodies',()=>{
  for(const source of [String.raw`\smash[{x]y}]{a\}b}`,String.raw`\enclose{circle\{x\}}[color={a]b}]{\{x\}}`]){
    const result=parse(source+'+tail');assert.ok(result,source);assert.equal(serialize(result.node),source);
    assert.equal((source+'+tail').slice(result.next),'+tail');
  }
  for(const value of [String.raw`[]`,String.raw`[a{b]c}d]`,String.raw`[a\]b]`])assert.equal(api.validateTexLayoutOptions('bracket',value),true,value);
  for(const value of ['',null,42,'[x','[x]]','[a[b]c]','[a}b]','[x]{y}','[x]+z'])assert.equal(api.validateTexLayoutOptions('bracket',value),false,String(value));
  for(const value of ['{circle}','{circle}[color=red]','{circle}  [color=red]'])assert.equal(api.validateTexLayoutOptions('enclose',value),true,value);
  for(const value of ['circle','{circle','{circle}[x','{circle}{x}','{circle}[x]+z'])assert.equal(api.validateTexLayoutOptions('enclose',value),false,value);
});

test('missing arguments, unknown syntax and unsupported formatters refuse atomically without stealing plus',()=>{
  for(const source of [
    String.raw`\phantom+x`,String.raw`\phantom{x`,String.raw`\phantom*{x}`,
    String.raw`\mathchoice{a}{b}{c}+d`,String.raw`\unitfrac{m}+x`,String.raw`\unitfrac[3]{m}+x`,
    String.raw`\unit{m}`,String.raw`\units[3]{m`,String.raw`\smash[[t]]{x}`,
    String.raw`\bbox[red,blue]{x}`,String.raw`\bbox[0px,2px]{x}`,String.raw`\bbox[2%zz]{x}`,
    String.raw`\bbox[padding:1px,border:1px]{x}`,String.raw`\enclose{circle}[color=red]+x`,
    String.raw`\nicefrac[\futureformatter]{a}{b}`,String.raw`\nicefrac[\textnormal]{a}{b}`,
    String.raw`\futurelayout{x}`
  ])assert.equal(parse(source),null,source);
  let created=0;
  const result=api.parseTexLayoutStructure(String.raw`\mathchoice{a}{b}{bad}{d}`,0,source=>source==='bad'?null:raw(source),(...args)=>{created++;return factory(...args);});
  assert.equal(result,null);assert.equal(created,0,'An abort must not emit any partial layout node');
});

test('saved layout options cannot escape their prefix or attach to an unrelated node',()=>{
  const destination=api.convertMath('a+b'),before=destination.snapshot();
  for(const [source,options] of [
    [String.raw`\bbox{x}`,'[red]{evil}'],[String.raw`\bbox{x}`,'[red'],
    [String.raw`\enclose{box}{x}`,'[red]'],[String.raw`\enclose{box}{x}`,'{box}[red]+evil'],
    [String.raw`\sqrt{x}`,'[red]']
  ]){
    const state=JSON.parse(api.convertMath(source).snapshot());state.root.items[0].texOptions=options;
    assert.throws(()=>destination.restore(JSON.stringify(state)),source+' '+options);
    assert.equal(destination.snapshot(),before,'Invalid options must not change the document');
  }
});

test('upstream MathJax agrees with all wrappers and preserved option behavior',async t=>{
  const url=folder=>pathToFileURL(path.resolve(folder)).href;
  const runtime=await require('mathjax').init({
    loader:{paths:{mathjax:url('node_modules/mathjax')},load:['input/tex',...api.mathJaxExtensionLoads.filter(name=>name!=='[tex]/bboldx')]},
    tex:{packages:{'[+]':api.mathJaxTexPackages.filter(item=>(typeof item==='string'?item:item[0])!=='bboldx'),'[-]':api.mathJaxDisabledTexPackages}},
    startup:{typeset:false}
  });
  const clean=value=>value.replace(/\sdata-latex(?:-item)?="[^"]*"/g,'').replace(/>\s+</g,'><')
    // Canonical braced single-letter/digit scripts add an equivalent ORD row.
    .replace(/<mrow data-mjx-texclass="ORD">(<(?:mi|mn)\b[^>]*>[^<]*<\/(?:mi|mn)>)<\/mrow>/g,'$1');
  const compare=(source,suffix='+z')=>{
    const result=parse(source);assert.ok(result,source);
    const original=runtime.tex2mml(source+suffix),converted=runtime.tex2mml(serialize(result.node)+suffix);
    assert.doesNotMatch(original,/<merror\b/,source+'\n'+original);
    assert.equal(clean(converted),clean(original),source);return original;
  };
  for(const definition of catalog)await t.test(definition.type,()=>{
    const args=Array.from({length:definition.labels.length},(_,i)=>i===0?String.raw`\frac{x}{y}`:String.fromCharCode(97+i));
    compare(definition.render(args));
  });
  await t.test('optional dimensions, atom classes, formatters and quantities',()=>{
    for(const source of [
      String.raw`\smash[t]{\frac{x}{y}}`,String.raw`\smash[b]{x}`,String.raw`\mathclap[\scriptstyle]{x}`,
      String.raw`\bbox[2px,#abc,border: 1px solid blue]{\frac{x}{y}}`,
      String.raw`\bbox[border: 1px solid red; width: 50%]{x}`,
      String.raw`\enclose{circle,updiagonalstrike}[mathcolor="red",data-padding=".2em"]{x}`,
      String.raw`\nicefrac[\mathsf]{x}{y}`,String.raw`\units[3]{m}`,String.raw`\unitfrac[3]{m}{s}`
    ])compare(source);
    const operator=compare(String.raw`\mathop{x+y}`,'_i+z');assert.match(operator,/<munder\b/);assert.match(operator,/data-mjx-texclass="OP"/);
    assert.match(compare(String.raw`\nicefrac{x}{y}`),/bevelled="true"/);
    assert.match(compare(String.raw`\smash[t]{x}`),/height="0"/);
    assert.match(compare(String.raw`\bbox[2px,red]{x}`),/mathbackground="red"/);
  });
  await t.test('the integrated converter retains native children, saved options and scripted atom classes',()=>{
    for(const source of [
      String.raw`\phantom{\frac{a}{b}}+x`,String.raw`\mathop{\frac{x}{y}}_i+z`,
      String.raw`\mathrel{\frac{x}{y}}^2+z`,String.raw`\smash[t]{\sqrt{x}}+y`,
      String.raw`\bbox[ 2px , red ]{\frac{x}{y}}`,
      String.raw`\enclose{circle}[mathcolor="red"]{\sqrt{x}}`,
      String.raw`\unitfrac[3]{m}{s}`,String.raw`\nicefrac[\mathsf]{x}{y}`
    ]){
      const model=api.convertMath(source),snapshot=model.snapshot();
      assert.doesNotMatch(snapshot,/source-tex/,source+' must remain completely editable');
      const restored=new api.EditorModel();restored.restore(snapshot);
      assert.equal(restored.exportLatex(),model.exportLatex(),source+' must preserve its options on save');
      const original=runtime.tex2mml(source),converted=runtime.tex2mml(model.exportLatex());
      assert.doesNotMatch(converted,/<merror\b/,source+'\n'+model.exportLatex());
      assert.equal(clean(converted),clean(original),source+'\n'+model.exportLatex());
    }
  });
});

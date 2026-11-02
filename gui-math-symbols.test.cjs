const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {buildSync}=require('esbuild');
const loaded={exports:{}};
new Function('module','exports','require',buildSync({stdin:{contents:`
export * from './src/gui-math-symbols';
export * from './src/gui-math-delimiters';
export * from './src/install-math-delimiters';
export * from './src/mathjax-commands';
export * from './src/math-input-policy';
export * from './src/mathjax-extension-policy';
export {installUnicodeFonts} from './src/mathjax-unicode-fonts';
export {EditorModel,catalog,symbols} from './src/editor-model';
export {convertMath} from './src/tex-convert';
`,resolveDir:__dirname},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text)(loaded,loaded.exports,require);
const api=loaded.exports;
const definitions=[...api.symbols,...api.catalog];
const visible=entry=>!entry.hidden&&!entry.legacy;
const guiDefinitions=definitions.filter(entry=>visible(entry)&&entry.scope!=='formula');
const primaryTypes=new Set(guiDefinitions.filter(entry=>!entry.variantOf||entry.variantOf===entry.type).map(entry=>entry.type));
const reachable=entry=>!!entry&&visible(entry)&&entry.scope!=='formula'&&(!entry.variantOf||primaryTypes.has(entry.variantOf));
const canonicalEntry=entry=>definitions.find(candidate=>candidate.type===api.guiSymbolCanonicalType(entry.type));
const converted=source=>{
  const model=api.convertMath(source);
  assert.equal([...model.nodes.values()].some(node=>node.type==='source-tex'),false,source);
  return model;
};
const emptyModel=()=>{
  const model=new api.EditorModel();model.root.items=[];model.index();model.setCursor(model.root.id,0);return model;
};
const restoredModel=model=>{
  const restored=new api.EditorModel();restored.restore(model.snapshot());
  assert.deepEqual(JSON.parse(restored.snapshot()),JSON.parse(model.snapshot()),'saved node types, identities, content and cursor survive');
  assert.equal(restored.exportLatex(),model.exportLatex());
  return restored;
};
let runtime;
async function mathjax(){
  if(!runtime)runtime=require('mathjax').init({
    loader:{paths:{mathjax:pathToFileURL(path.resolve('node_modules/mathjax')).href},load:['input/tex',...api.mathJaxExtensionLoads]},
    tex:{packages:{'[+]':api.mathJaxTexPackages,'[-]':api.mathJaxDisabledTexPackages},require:api.mathJaxRequireOptions,textmacros:{packages:{'[+]':['textcomp']}}},
    startup:{typeset:false,ready(){api.installUnicodeFonts(globalThis.MathJax._);api.installMathDelimiters(globalThis.MathJax._);globalThis.MathJax.startup.defaultReady();}},
  });
  return runtime;
}
const clean=markup=>markup.replace(/\sdata-latex(?:-[a-z]+)?="[^"]*"/g,'').replace(/\s+/g,' ').trim();

test('configured character maps and verified fixed symbols have GUI definitions, with no guessed argument macros',()=>{
  for(const command of api.mathjaxSymbolCommands())assert.ok(definitions.some(entry=>entry.command==='\\'+command.name),command.name);
  assert.equal(api.guiFixedSymbolCommands().length,49);
  for(const command of api.guiFixedSymbolCommands()){
    const definition=definitions.find(entry=>entry.command==='\\'+command.name||entry.operatorCommand===command.name);
    assert.ok(definition,command.name);
    assert.ok(reachable(canonicalEntry(definition))||api.isSourceOnlyMathCommand(command.name),command.name);
  }
  assert.equal(api.guiFixedSymbolCommands().some(command=>['frac','div','bbox','mathstrut','bfbbalpha','mathbfbb'].includes(command.name)),false);
  assert.equal(api.symbols.filter(entry=>visible(entry)&&['\\qc','\\qcomma','\\Residue'].includes(entry.command)).length,0);
  for(const command of ['coloneq','Coloneq','eqcolon','bmod','nuparrow']){
    const entry=definitions.find(entry=>entry.command==='\\'+command);assert.ok(entry&&!entry.hidden);
    assert.equal(entry.label,'\\'+command,'command labels work in both interface languages');
  }
});

test('paired delimiter buttons expose mathematical delimiters while retaining construction glyphs for saved documents',()=>{
  assert.equal(api.guiDelimiterPairs.length,23);
  const constructionTypes=new Set(['fence-arrowvert','fence-bracevert']);
  assert.equal(api.guiDelimiterPairs.filter(pair=>reachable(api.catalog.find(entry=>entry.type===pair.type))).length,21);
  for(const pair of api.guiDelimiterPairs){
    const primary=api.catalog.find(entry=>entry.type===pair.type);assert.ok(primary);assert.equal(primary.variantOf,primary.type);
    const variants=api.catalog.filter(entry=>entry.variantOf===pair.type);assert.equal(variants.length,7,pair.type+' keeps all registered geometries');
    for(const variant of variants){
      assert.equal(variant.labels.length,1);
      assert.equal(reachable(variant),!constructionTypes.has(pair.type),variant.type);
      if(constructionTypes.has(pair.type))assert.equal(variant.hidden,true,variant.type+' must not leak into a size menu');
    }
  }
  for(const command of api.mathjaxCommands){
    const definition=command.definitions.find(entry=>entry.context==='math'&&entry.configured&&entry.kind==='delimiter');
    if(!definition?.character||!/^\\[A-Za-z]+$/.test(command.name))continue;
    assert.ok(definitions.some(entry=>entry.command===command.name),command.name+' remains an available atom');
  }
});

test('generic fraction presets stay readable without becoming separate mathematical choices',()=>{
  for(const type of ['genfracBrackets','genfracBraces']){
    const definition=api.catalog.find(entry=>entry.type===type);assert.ok(definition.hidden);
    const source=definition.render(['a+b','c']),model=converted(source);
    assert.equal(model.root.items[0].type,type);assert.equal(model.exportLatex(),source);
    const restored=new api.EditorModel();restored.restore(model.snapshot());assert.equal(restored.exportLatex(),source);
  }
  for(const type of ['frac','binom','atop','splitfrac','layout-nicefrac'])assert.ok(reachable(api.catalog.find(entry=>entry.type===type)),type+' is an actual mathematical form');
  for(const command of ['TeX','LaTeX','MTThinColon','textcompwordmark','tripledash']){
    const entries=definitions.filter(entry=>entry.command==='\\'+command);assert.ok(entries.length,command);
    assert.equal(entries.some(reachable),false,command+' is not a mathematical palette entry');
  }
});

test('all new fixed symbols preserve native TeX meaning through import and export',async()=>{
  const M=await mathjax();
  for(const command of api.guiFixedSymbolCommands()){
    const source='a \\'+command.name+' b',model=converted(source),exported=model.exportLatex();
    const expected=await M.tex2mmlPromise(source),actual=await M.tex2mmlPromise(exported);
    assert.doesNotMatch(expected,/<merror/);assert.doesNotMatch(actual,/<merror/);
    assert.equal(clean(actual),clean(expected),command.name);
  }
});

test('every delimiter geometry and size, including hidden construction glyphs, roundtrips and saves its nested fraction intact',async()=>{
  const M=await mathjax();
  for(const pair of api.guiDelimiterPairs){
    for(const entry of api.catalog.filter(entry=>entry.variantOf===pair.type)){
      const source=entry.render([String.raw`\frac{a}{b}+c`]),model=converted(source);
      assert.ok([...model.nodes.values()].some(node=>node.type==='frac'),entry.type);
      restoredModel(model);
      const expected=await M.tex2mmlPromise(source),actual=await M.tex2mmlPromise(model.exportLatex());
      assert.doesNotMatch(expected,/<merror/,entry.type);assert.doesNotMatch(actual,/<merror/,entry.type);
      assert.equal(clean(actual),clean(expected),entry.type);
      // A saved node need not have been constructed by today's TeX importer.
      // Restore each registered legacy type directly, preserving its child IDs.
      if(entry.hidden){
        const legacy=converted(String.raw`\frac{a}{b}+c`);legacy.setCursor(legacy.root.id,0,legacy.root.items.length);legacy.insertStructure(entry.type);
        assert.equal(legacy.root.items[0].type,entry.type);
        assert.equal(clean(await M.tex2mmlPromise(restoredModel(legacy).exportLatex())),clean(expected),entry.type+' legacy node');
      }
    }
  }
});

test('double bracket aliases use native MathJax OPEN/CLOSE glyphs and do not redefine relational gt',async()=>{
  const M=await mathjax();
  for(const source of [String.raw`\left\llbracket\frac{a}{b}\right\rrbracket`,String.raw`\left\lBrack\frac{a}{b}\right\rBrack`,'\\left⟦\\frac{a}{b}\\right⟧']){
    const model=converted(source);assert.equal(model.root.items[0].type,'doubleBrackets');
    assert.match(model.exportLatex(),/\\left\\lBrack /);assert.match(model.exportLatex(),/\\right\\rBrack/);
    const markup=clean(await M.tex2mmlPromise(model.exportLatex()));
    assert.doesNotMatch(markup,/<merror/);assert.match(markup,/data-mjx-texclass="OPEN">&#x27E6;/);assert.match(markup,/data-mjx-texclass="CLOSE">&#x27E7;/);
    assert.match(markup,/<mfrac/);
  }
  const compare=converted(String.raw`a\gt b`);assert.match(await M.tex2mmlPromise(compare.exportLatex()),/<mo[^>]*>&gt;<\/mo>/);
  assert.equal(converted(String.raw`\left\lt x\right\gt`).root.items[0].type,'angles');
});

test('new limits use existing operator slots, retain the body sequence, and support save/restore',()=>{
  for(const name of ['injlim','projlim','varinjlim','varprojlim','varliminf','varlimsup','bigtimes']){
    const model=converted('\\'+name+'_{n}^{N}x'),node=model.root.items[0];
    assert.equal(node.operatorLayout,true,name);assert.deepEqual(node.regions.map(region=>region.slot),['lower','upper']);assert.equal(model.root.items.at(-1),'x');
    const restored=new api.EditorModel();restored.restore(model.snapshot());assert.equal(restored.exportLatex(),model.exportLatex());
  }
});

test('public CharacterMap symbols have reachable GUI entries; implementation helpers remain source-only',()=>{
  for(const command of api.mathjaxSymbolCommands()){
    const entries=definitions.filter(entry=>entry.command==='\\'+command.name);
    if(api.isSourceOnlyMathCommand(command.name)){
      assert.ok(entries.length&&entries.every(entry=>!reachable(entry)),command.name+' is an implementation helper, not a palette symbol');
      continue;
    }
    assert.ok(entries.some(entry=>reachable(canonicalEntry(entry))),command.name);
  }
  for(const entry of guiDefinitions)assert.ok(reachable(entry),entry.type+' has no primary button');
});

test('automatic symbols use their mathematical classes and preserve genuinely different text tokens',async()=>{
  const M=await mathjax(),dictionary=M._.core.MmlTree.OperatorDictionary.OPTABLE;
  for(const command of api.mathjaxSymbolCommands()){
    const definition=command.definition;
    if(!['mathchar0mo','AMSsymbols-mathchar0mo','AMSmath-mathchar0mo'].includes(definition.map))continue;
    const cls=definition.attributes?.texClass??(dictionary.infix[command.character]??dictionary.prefix[command.character]??dictionary.postfix[command.character])?.[2];
    const category=api.guiMathjaxSymbolCategory(command);
    if(cls===1)assert.equal(category,'大型算符',command.name);
    if(cls===2)assert.equal(category,'运算符号',command.name);
    if(cls===3)assert.ok(['关系符号','箭头符号'].includes(category),command.name);
    if(cls===6)assert.equal(category,'其他符号',command.name);
  }
  for(const [name,category] of [['nless','关系符号'],['boxplus','运算符号'],['looparrowleft','箭头符号'],['digamma','希腊字母'],['upalpha','希腊字母'],['ohm','化学与单位'],['vdot','物理记号'],['textperiodcentered','其他符号']]){
    const entry=definitions.find(entry=>entry.command==='\\'+name);assert.ok(entry,name);assert.equal(entry.category,category,name);
  }
  // Same codepoint does not mean same TeX atom: punctuation and text stay distinct.
  for(const name of ['cdot','cdotp','textperiodcentered','leq','textless']){
    const entry=definitions.find(entry=>entry.command==='\\'+name);assert.ok(reachable(canonicalEntry(entry)),name);
  }
  assert.notEqual(api.guiSymbolCanonicalType('mathjax-symbol-cdotp'),api.guiSymbolCanonicalType('symbol-cdot'));
  assert.notEqual(api.guiSymbolCanonicalType('symbol-textperiodcentered'),api.guiSymbolCanonicalType('symbol-cdot'));
});

test('upright Greek aliases resolve to equivalent existing per-letter style menus',async()=>{
  const M=await mathjax();
  const tokens=markup=>[...markup.matchAll(/<(mi|mo|mtext)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g)].map(match=>clean(match[0]));
  for(const command of api.mathjaxSymbolCommands().filter(command=>command.definition.map==='upgreek')){
    const entry=definitions.find(entry=>entry.command==='\\'+command.name),canonical=canonicalEntry(entry);
    assert.ok(entry.hidden,command.name);assert.ok(canonical.letter,command.name);assert.ok(reachable(canonical),command.name);
    assert.equal(canonical.letter,command.character,command.name);
    assert.deepEqual(tokens(await M.tex2mmlPromise(entry.tex)),tokens(await M.tex2mmlPromise(canonical.tex)),command.name);
  }
  // The installed font adaptation currently renders AMS var-capitals
  // differently from symit; do not silently collapse their insertion paths.
  for(const command of api.mathjaxSymbolCommands().filter(command=>command.definition.map==='AMSsymbols-mathchar0mi'&&command.definition.attributes?.mathvariant==='italic')){
    const entry=definitions.find(entry=>entry.command==='\\'+command.name);assert.ok(reachable(entry),command.name);
    const model=new api.EditorModel();model.root.items=[command.character];model.index();model.setCursor(model.root.id,1);
    assert.equal(model.switchLetter(model.root.id,0,entry.type),true,command.name+' can replace its directly typed Greek letter');
    assert.equal(model.root.items[0].type,entry.type,command.name);
    assert.equal(model.exportLatex(),'\\'+command.name+' ',command.name+' retains its native command');
  }
});

test('native integral forms use optional limits and their own variant semantics',async()=>{
  const M=await mathjax();
  for(const name of ['oiint','oiiint','intop','ointop','smallint']){
    const atom=definitions.find(entry=>entry.type==='mathjax-symbol-'+name),entry=canonicalEntry(atom);
    const sourceOnly=['intop','ointop'].includes(name);
    assert.ok(atom.hidden,name);assert.ok(entry.operator,name);assert.equal(reachable(entry),!sourceOnly,name);
    if(['intop','smallint'].includes(name))assert.equal(entry.variantOf,'integral');
    if(name==='ointop')assert.equal(entry.variantOf,'contourIntegral');
    const variants=api.catalog.filter(candidate=>candidate.operatorCommand===name);
    assert.equal(variants.length,3,name+' retains automatic and both forced placements');
    for(const variant of variants){
      assert.equal(reachable(variant),!sourceOnly,variant.type);
      if(sourceOnly){assert.equal(variant.hidden,true);assert.equal(variant.commandCandidate,false);}
      const model=emptyModel();model.insertStructure(variant.type);
      assert.equal(model.root.items[0].operatorLayout,true,variant.type);
      assert.deepEqual(model.root.items[0].regions,[],variant.type+' starts without empty limits');
      const source='\\'+name+(variant.operatorPlacement??'')+' ';
      assert.equal(clean(await M.tex2mmlPromise(restoredModel(model).exportLatex())),clean(await M.tex2mmlPromise(source)),variant.type);
      if(sourceOnly){
        const imported=converted(source+'_{a}^{b}f'),operator=imported.root.items[0];
        assert.equal(operator.type,variant.type,variant.type+' imports its native placement');
        assert.deepEqual(operator.regions.map(region=>region.slot),['lower','upper']);
        assert.equal(imported.root.items.at(-1),'f');
        assert.equal(clean(await M.tex2mmlPromise(restoredModel(imported).exportLatex())),clean(await M.tex2mmlPromise(source+'_{a}^{b}f')),variant.type+' preserves limits');
      }
    }
  }
  for(const name of ['sum','prod','int','iint','oint']){
    const atom=definitions.find(entry=>entry.type==='mathjax-symbol-'+name);assert.ok(atom.hidden,name);
    assert.ok(canonicalEntry(atom).operator,name);assert.ok(reachable(canonicalEntry(atom)),name);
  }
});

test('hidden helper atoms remain readable in old snapshots and preserve native meaning on import',async()=>{
  const M=await mathjax();
  for(const name of ['qcomma','qc','Residue','intop','ointop']){
    const entry=api.symbols.find(entry=>entry.type==='mathjax-symbol-'+name);
    assert.ok(entry,name);assert.equal(entry.hidden,true,name);assert.equal(entry.commandCandidate,false,name);
    const legacy=emptyModel();legacy.root.items=['a','b'];legacy.index();legacy.setCursor(legacy.root.id,1);legacy.insertSymbol(entry.type);
    const restored=restoredModel(legacy);assert.equal(restored.root.items[1].type,entry.type);
    const source='a \\'+name+' b',expected=clean(await M.tex2mmlPromise(source));
    assert.doesNotMatch(expected,/<merror/);
    assert.equal(clean(await M.tex2mmlPromise(restored.exportLatex())),expected,name+' old atom');
    const imported=converted(source);
    assert.equal(clean(await M.tex2mmlPromise(restoredModel(imported).exportLatex())),expected,name+' imported command');
  }
  // intop/ointop differ from int/oint in automatic limit placement, even though
  // they share a glyph. Hiding the extra menu choice must not rewrite them.
  for(const [native,ordinary] of [['intop','int'],['ointop','oint']]){
    const source='\\'+native+'_{a}^{b}f',imported=converted(source),exported=restoredModel(imported).exportLatex();
    assert.match(exported,new RegExp('\\\\'+native+'(?:\\s|_|\\^)'));
    const expected=clean(await M.tex2mmlPromise(source,{display:true}));
    assert.equal(clean(await M.tex2mmlPromise(exported,{display:true})),expected,native);
    assert.notEqual(expected,clean(await M.tex2mmlPromise('\\'+ordinary+'_{a}^{b}f',{display:true})),native+' is not merely an alias');
  }
});

test('dot and colon menus retain each command and mathematical class while switching the existing atom',async()=>{
  const M=await mathjax();
  const families=[
    ['symbol-cdot',['cdot','cdotp','ldotp']],
    ['mathjax-symbol-colon',['colon','ordinarycolon','vcentercolon']],
  ];
  for(const [primary,names] of families){
    const variants=names.map(name=>api.symbols.find(entry=>entry.command==='\\'+name));
    assert.ok(primaryTypes.has(primary),primary+' is the single main button');
    for(const entry of variants){
      assert.ok(reachable(entry),entry?.type);assert.equal(entry.variantOf,primary);assert.equal(entry.variantLabel,entry.command);
      assert.equal(primaryTypes.has(entry.type),entry.type===primary,entry.type+' is only a right-click variant');
      assert.equal(api.guiSymbolCanonicalType(entry.type),entry.type,entry.type+' is not collapsed into a different TeX atom');
    }
    const model=converted('a '+variants[0].command+String.raw` \frac{b}{c}`);
    const node=model.root.items[1],fraction=model.root.items[2];assert.equal(node.type,primary);
    model.setCursor(fraction.regions[1].id,1);
    const rootBefore=JSON.parse(JSON.stringify(model.root)),cursorBefore={...model.cursor};
    for(const entry of [...variants.slice(1),variants[0]]){
      assert.equal(model.canSwitchVariant(node.id,entry.type),true);
      assert.equal(model.switchVariant(node.id,entry.type),true);
      const expectedRoot=JSON.parse(JSON.stringify(rootBefore));expectedRoot.items[1].type=entry.type;
      assert.deepEqual(model.root,expectedRoot,entry.type+' preserves atom ID, surrounding sequence, and nested content');
      assert.deepEqual(model.cursor,cursorBefore,entry.type+' preserves the editing position');
      const source='a '+entry.command+String.raw` \frac{b}{c}`,expected=clean(await M.tex2mmlPromise(source));
      assert.doesNotMatch(expected,/<merror/);
      assert.equal(clean(await M.tex2mmlPromise(restoredModel(model).exportLatex())),expected,entry.type+' uses its own native command');
      const imported=converted(source);assert.equal(imported.root.items[1].type,entry.type);
      assert.equal(clean(await M.tex2mmlPromise(imported.exportLatex())),expected,entry.type+' retains meaning on import');
    }
  }
  for(const name of ['cdotp','ldotp','colon']){
    const command=api.mathjaxCommands.find(command=>command.name===name);
    assert.equal(api.mathjaxCommandDefinition(command).attributes.texClass,6,name+' is punctuation');
  }
  const binary=clean(await M.tex2mmlPromise(String.raw`a\cdot b`)),punctuation=clean(await M.tex2mmlPromise(String.raw`a\cdotp b`));
  assert.notEqual(binary,punctuation,'the same centered dot glyph retains different binary/punctuation spacing');
});

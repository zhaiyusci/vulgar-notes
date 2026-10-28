const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {buildSync}=require('esbuild');
const {execFileSync}=require('node:child_process');
const compiled=new Module(path.resolve('.mathjax-commands-test.cjs'),module);compiled.paths=module.paths;
compiled._compile(buildSync({stdin:{contents:"export * from './src/mathjax-commands';export {EditorModel} from './src/editor-model';export {convertMath} from './src/tex-convert';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,path.resolve('.mathjax-commands-test.cjs'));
const api=compiled.exports;
const modelFor=query=>{const model=new api.EditorModel();model.root.items=Array.from(query);model.index();model.setCursor(model.root.id,model.root.items.length);return model;};

test('generated metadata matches installed official runtime registries and selected package policy',()=>{
  execFileSync(process.execPath,['scripts/audit-mathjax-coverage.cjs','--check'],{cwd:process.cwd(),stdio:'pipe'});
  const data=JSON.parse(fs.readFileSync('src/mathjax-command-data.json','utf8'));
  assert.equal(data.mathjaxVersion,require('mathjax/package.json').version);assert.ok(data.commands.length>1400);assert.ok(data.environments.length>50);
  assert.equal(data.coverage,undefined,'diagnostic probes do not ship in the application metadata');assert.ok(fs.statSync('src/mathjax-command-data.json').size<600000);
});
test('effective physics semantics win over conflicting base and optional definitions',()=>{
  const command=api.findMathjaxCommand('div'),definition=api.mathjaxCommandDefinition(command);
  assert.equal(definition.package,'physics');assert.equal(definition.handler,'VectorOperator');assert.equal(definition.syntax.kind,'handler-defined');assert.equal(definition.character,undefined);
  const action=api.findMathjaxCommand('toggle');assert.ok(action);assert.equal(api.mathjaxCommandDefinition(action),undefined);assert.equal(api.mathjaxSourceTemplate('toggle'),undefined);
  assert.equal(api.mathjaxSourceCommands(false).some(command=>command.packages.every(name=>['action','amscd','bbm','dsfont','texhtml'].includes(name))),false);
});
test('runtime character maps provide real symbols while unknown argument grammars are not invented',()=>{
  const lnot=api.mathjaxSymbolCommands().find(command=>command.name==='lnot');assert.ok(lnot);assert.equal(lnot.character,'¬');assert.equal(lnot.definition.syntax.arity,0);
  assert.equal(api.mathjaxSymbolCommands().some(command=>command.name==='div'),false,'physics div is an argument-bearing vector operator');
  assert.equal(api.mathjaxSourceTemplate('frac'),'\\frac','dispatch handler args are not guessed as TeX argument counts');
  assert.equal(api.mathjaxSourceTemplate('notAnOfficialCommand'),undefined);
  const macro=api.mathjaxSourceCommands().find(command=>api.mathjaxCommandDefinition(command).syntax.kind==='macro-expansion'&&api.mathjaxCommandDefinition(command).syntax.arity>0);assert.ok(macro);
  const syntax=api.mathjaxCommandDefinition(macro).syntax,arity=syntax.arity-(syntax.optionalDefault===undefined?0:1);assert.equal(api.mathjaxSourceTemplate(macro.name),'\\'+macro.name+'{}'.repeat(arity));
});
test('actual commandCandidates covers enabled math commands and preserves the single blackboard policy',()=>{
  const candidates=modelFor('\\').commandCandidates(),names=new Set(candidates.map(command=>command.name));
  const missing=api.mathjaxSourceCommands().map(command=>command.name).filter(name=>!names.has(name));assert.deepEqual(missing,[]);
  assert.ok(candidates.length>1200);assert.ok(candidates.some(command=>command.atom));assert.ok(candidates.some(command=>command.source));
  for(const name of ['toggle','mathtip','bfbbalpha','mathbfbb','imathbfbb','jmathbfbb','mathbbm','mathds'])assert.equal(names.has(name),false,name+' is intentionally omitted');
  assert.ok(names.has('bbalpha'));assert.ok(names.has('flat'));assert.ok(names.has('lnot'));
});
test('a newly covered official symbol enters as an editable native atom and survives scripts and save',()=>{
  const model=modelFor('\\flat');assert.ok(model.commitCommand());assert.equal(model.root.items[0].atom,true);assert.equal(model.exportLatex().trim(),'\\flat');
  const loaded=new api.EditorModel();loaded.restore(model.snapshot());assert.equal(loaded.root.items[0].type,model.root.items[0].type);
  assert.equal([...api.convertMath('\\flat_{x}').nodes.values()].some(node=>node.type==='source-tex'),false);
});
test('source command candidates focus the raw region and preserve editable source, save, undo and redo',()=>{
  const model=modelFor('\\color'),candidate=model.commandCandidates().find(command=>command.name==='color');assert.ok(candidate.source);
  const before=model.snapshot();assert.ok(model.commitCommand());assert.equal(model.rawInput,true);assert.equal(model.current.items.join(''),candidate.source);assert.equal(model.parents.get(model.current.id).node.type,'source-tex');
  const next=candidate.source+'{red}x';model.setCursor(model.current.id,0,model.current.items.length);model.replace(...model.range,next);assert.equal(model.exportLatex(),next);
  const loaded=new api.EditorModel();loaded.restore(model.snapshot());assert.equal(loaded.rawInput,true);assert.equal(loaded.exportLatex(),next);
  model.undo();assert.equal(model.exportLatex(),candidate.source);model.undo();assert.deepEqual(JSON.parse(model.snapshot()).root,JSON.parse(before).root);model.redo();model.redo();assert.equal(model.exportLatex(),next);
});

test('sp and sb use the same current-flow script insertion as typed markers',()=>{
  const model=modelFor('x\\sp');assert.ok(model.commitCommand());model.insert('N');
  model.replaceInput(...model.range,'\\sb');assert.ok(model.commitCommand());model.insert('bead');
  assert.equal(model.exportLatex(),'{x}^{{N}_{bead}}');
  const restored=new api.EditorModel();restored.restore(model.snapshot());assert.equal(restored.exportLatex(),model.exportLatex());
});

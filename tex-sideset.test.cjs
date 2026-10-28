const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {buildSync}=require('esbuild');
const compiled=buildSync({stdin:{contents:`export * from './src/tex-sideset'; export {EditorModel,catalog} from './src/editor-model'; export {convertMath} from './src/tex-convert';`,resolveDir:__dirname},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const loaded={exports:{}};new Function('module','exports','require',compiled)(loaded,loaded.exports,require);
const api=loaded.exports;
let serial=40000000,mathjax;
const region=items=>({id:'r'+ ++serial,label:'',items});
const factory=(type,regions)=>({id:'n'+ ++serial,type,regions});
const raw=source=>region([factory('source-tex',[region(Array.from(source))])]);
const parse=source=>api.parseTexSideSet(source,0,raw,factory);
const restore=node=>{
  const model=new api.EditorModel(),root=region([node]);
  model.restore(JSON.stringify({version:2,root,cursor:{region:root.id,offset:1,anchor:1}}));return model;
};
const blank=()=>{const model=new api.EditorModel();model.root.items=[];model.index();model.setCursor(model.root.id,0);return model;};
const canonical=source=>source.replace(/\sdata-latex(?:-[\w-]+)?="[^"]*"/g,'').replace(/>\s+</g,'><').trim();
test.before(async()=>{
  const root=pathToFileURL(path.dirname(require.resolve('mathjax/node-main.cjs'))+'/').href.replace(/\/$/,'');
  mathjax=await require('mathjax').init({loader:{paths:{mathjax:root},load:['input/tex']},startup:{typeset:false}});
});
async function mml(source){const result=await mathjax.tex2mmlPromise(source,{display:true});assert.doesNotMatch(result,/<merror\b/,source);return canonical(result);}

test('large-operator sideset variants are registered once without exposing operand placeholders',()=>{
  const length=api.catalog.length;api.registerSideSetStructures(api.catalog);assert.equal(api.catalog.length,length);
  for(const command of 'sum prod coprod bigcup bigcap bigsqcup biguplus bigvee bigwedge bigodot bigoplus bigotimes int iint iiint iiiint idotsint oint'.split(' ')){
    const definition=api.catalog.find(entry=>entry.operatorCommand===command&&!entry.operatorPlacement&&entry.scriptSlots?.includes('leftLower'));
    assert.ok(definition,command);assert.equal(definition.operator,true);assert.equal(definition.category,'大型算符');
    if(command!=='sum'){assert.equal(definition.hidden,true);assert.equal(definition.commandCandidate,false);}
    const model=blank();model.insertStructure(definition.type);
    assert.equal(model.root.items[0].operatorLayout,true);assert.deepEqual(model.root.items[0].regions,[]);
    assert.equal(model.cursor.region,model.root.id);assert.equal(model.root.items.length,1);
  }
});

test('all supported bare operators and placements preserve exact MathJax scripts and OP classes',async()=>{
  for(const command of 'sum prod coprod bigcup bigcap bigsqcup biguplus bigvee bigwedge bigodot bigoplus bigotimes int iint iiint iiiint idotsint oint'.split(' ')){
    for(const placement of ['',String.raw`\limits`,String.raw`\nolimits`]){
      const source=String.raw`\sideset{_{a}^{b}}{_{c}^{d}}`+'\\'+command+placement,result=parse(source+' x');
      assert.ok(result,source);assert.equal(result.next,source.length);
      assert.equal(result.node.operatorLayout,true);assert.deepEqual(result.node.regions.map(region=>region.slot),['leftLower','leftUpper','lower','upper']);
      const model=restore(result.node);assert.equal(await mml(model.exportLatex()),await mml(source),source+' -> '+model.exportLatex());
    }
  }
});

test('absent sideset scripts do not create empty editable regions',async()=>{
  for(const source of [String.raw`\sideset{_{a}}{}\prod`,String.raw`\sideset{}{^{b}}\sum`]){
    const result=parse(source);assert.ok(result,source);
    assert.ok(result.node.regions.every(region=>region.items.length>0));
    const model=restore(result.node);assert.equal(await mml(model.exportLatex()),await mml(source));
  }
  const empty=String.raw`\sideset{}{}\sum`;
  assert.equal(parse(empty),null);const preserved=api.convertMath(empty);assert.equal(preserved.exportLatex(),empty);
  assert.equal(await mml(preserved.exportLatex()),await mml(empty));
});

test('sideset does not consume the following operand or conflate outer scripts with right-side scripts',()=>{
  const prefix=String.raw`\sideset{_{a}}{^{b}}\prod`,source=prefix+String.raw` x+\frac{1}{2}`,result=parse(source);
  assert.equal(result.next,prefix.length);assert.equal(source.slice(result.next),String.raw` x+\frac{1}{2}`);
  for(const suffix of ['_{n}','^{2}',"'",String.raw`\limits_{n}`,String.raw`\displaylimits`]){
    assert.equal(parse(prefix+suffix),null,suffix);
    assert.equal(api.convertMath(prefix+suffix).exportLatex(),prefix+suffix,'Preserve the whole original outer-script construct');
  }
});

test('pure scripts may use single ordinary tokens but malformed, consuming or unrelated content stays source',()=>{
  const source=String.raw`\sideset{_a^\alpha}{_b^c}\prod`,result=parse(source);assert.ok(result);
  assert.deepEqual(result.node.regions.map(region=>region.slot),['leftLower','leftUpper','lower','upper']);
  for(const invalid of [String.raw`\sideset{a}{b}\prod`,String.raw`\sideset{_{}}{}\sum`,String.raw`\sideset{_a_b}{}\sum`,String.raw`\sideset{^\frac{1}{2}}{}\sum`,String.raw`\sideset{_a}{}{\prod}`,String.raw`\sideset{_a}{}\sin`,String.raw`\sideset{_a}{}\product`,String.raw`\sideset{_{a}}{^{b}\sum`])assert.equal(parse(invalid),null,invalid);
});

test('sideset regions survive model save, native selection copy, undo and redo',()=>{
  const source=String.raw`\sideset{_{a}^{b}}{_{c}^{d}}\prod`,converted=api.convertMath(source);
  assert.equal(converted.root.items[0].type,'sideset-prod');
  assert.deepEqual(converted.root.items[0].regions.map(region=>region.slot),['leftLower','leftUpper','lower','upper']);
  const copy=blank();converted.setCursor(converted.root.id,1,0);copy.restore(converted.selectionSnapshot());
  const destination=blank();destination.insert('x+');const before=destination.snapshot();destination.replaceFragment(copy.root.items);
  assert.notEqual(destination.root.items[2].id,converted.root.items[0].id);
  const after=destination.snapshot(),restored=blank();restored.restore(after);assert.equal(restored.exportLatex(),destination.exportLatex());
  destination.undo();assert.equal(destination.snapshot(),before);destination.redo();assert.equal(destination.snapshot(),after);
});

test('clearing a side script removes just that region, leaves its operator and restores on undo',()=>{
  const model=api.convertMath(String.raw`\sideset{_{a}}{^{b}}\prod`),node=model.root.items[0];
  assert.equal(node.type,'sideset-prod');
  const left=node.regions.find(region=>region.slot==='leftLower');model.setCursor(left.id,left.items.length);model.remove(-1);
  assert.equal(model.root.items[0].type,'sideset-prod');assert.deepEqual(model.root.items[0].regions.map(region=>region.slot),['upper']);
  assert.equal(model.cursor.region,model.root.id);const cleared=model.snapshot();
  model.undo();assert.deepEqual(model.root.items[0].regions.map(region=>region.slot),['leftLower','upper']);
  model.redo();assert.equal(model.snapshot(),cleared);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {buildSync}=require('esbuild');
const {TextEncoder}=require('node:util');

const result=buildSync({stdin:{contents:"export * from './src/math-editor-file';export {EditorModel,catalog} from './src/editor-model';export {importMath} from './src/tex-import';",resolveDir:process.cwd(),sourcefile:'formula-file-test.ts'},bundle:true,write:false,platform:'node',format:'cjs',metafile:true});
const module_={exports:{}};
vm.runInNewContext(result.outputFiles[0].text,{module:module_,exports:module_.exports,TextEncoder});
const {EditorModel,catalog,importMath,encodeFormulaFile,decodeFormulaFile,formulaFileExtension,formulaFileFormat,maxFormulaFileBytes}=module_.exports;
const plain=value=>JSON.parse(JSON.stringify(value));
const blank=()=>{const model=new EditorModel();model.root.items=[];model.index();model.setCursor(model.root.id,0);return model;};
const parsed=tex=>{const model=importMath(tex);assert.ok(model,tex);return model;};
const envelope=snapshot=>({format:formulaFileFormat,version:1,display:true,numbered:true,snapshot});
const saved=model=>JSON.parse(model.snapshot());

test('formula files are independent of article, UI, persistence and rendering dependencies',()=>{
  const inputs=Object.keys(result.metafile.inputs);
  assert.equal(inputs.some(input=>/(?:^|\/)(?:react(?:-dom)?|platejs|slate(?:-react)?|components)(?:\/|$)|src\/(?:plate-|platform|document-|editor-ui|i18n|mathjax-loader)/.test(input)),false,inputs.join('\n'));
  assert.equal(formulaFileExtension,'.vulgar-math');
  assert.equal(formulaFileFormat,'vulgar-notes-formula');
  assert.equal(maxFormulaFileBytes,10*1024*1024);
});

test('nested structures, CJK, opaque source, selection and pending font round-trip unchanged',()=>{
  const model=parsed('a+\\frac{\\sqrt[3]{x+1}}{b+c_i}+z');
  const denominator=model.root.items[2].regions[1];
  model.setCursor(model.root.id,model.root.items.length);
  model.insertStructure('text-normal');model.insert('中文说明 — 日本語');
  model.setCursor(model.root.id,model.root.items.length);
  const raw='\\unknown{𝛼}\r\n% keep this comment\n\\newcommand{\\x}{?}';
  model.insertSourceTex(raw);
  model.setCursor(denominator.id,3,1);model.pendingFont='font-symbf';
  const before=model.snapshot(),latex=model.exportLatex(),undo=Array.from(model.undoStack);
  const text=encodeFormulaFile(model,{display:true,numbered:true}),file=JSON.parse(text);
  assert.equal(typeof file.snapshot,'object');assert.equal(file.snapshot.version,2);
  assert.deepEqual(Object.keys(file),['format','version','display','numbered','snapshot']);
  assert.equal(model.snapshot(),before);assert.deepEqual(Array.from(model.undoStack),undo);
  const restored=decodeFormulaFile(text);
  assert.equal(restored.display,true);assert.equal(restored.numbered,true);
  assert.equal(restored.model.snapshot(),before);assert.equal(restored.model.exportLatex(),latex);
  assert.deepEqual(plain(restored.model.cursor),plain(model.cursor));
  assert.equal(restored.model.pendingFont,'font-symbf');
  assert.equal(restored.model.root.items.at(-1).regions[0].items.join(''),raw);
  restored.model.insert('q');assert.equal(model.snapshot(),before,'Restored models share no writable tree with the original');
});

test('every registered structure and every display/numbering combination saves without changing its tree',()=>{
  for(const definition of catalog){
    const model=blank();
    if(definition.scope==='formula')model.initializeFormula(definition.type);else model.insertStructure(definition.type);
    const before=model.snapshot();
    const result=decodeFormulaFile(encodeFormulaFile(model,{display:true,numbered:false}));
    assert.equal(result.model.snapshot(),before,definition.type);
  }
  for(const display of [false,true])for(const numbered of [false,true]){
    const model=blank(),result=decodeFormulaFile(encodeFormulaFile(model,{display,numbered}));
    assert.equal(result.display,display);assert.equal(result.numbered,numbered);
    assert.equal(result.model.snapshot(),model.snapshot());
  }
});

test('legacy bare version 2 formula snapshots open inline and retain selection',()=>{
  const model=parsed('x+\\sqrt{y}');model.setCursor(model.root.id,2,0);
  const snapshot=saved(model);snapshot.root.label='A historical label';
  const result=decodeFormulaFile(JSON.stringify(snapshot));
  assert.equal(result.display,false);assert.equal(result.numbered,false);
  assert.equal(result.model.snapshot(),model.snapshot());
  assert.equal(JSON.parse(encodeFormulaFile(result.model,result)).format,formulaFileFormat);
});

test('arbitrary JSON, articles, unsupported versions and malformed envelope fields are rejected',()=>{
  const snapshot=saved(blank()),valid=envelope(snapshot);
  for(const text of ['', '{', 'NaN', '\\frac{a}{b}'])assert.throws(()=>decodeFormulaFile(text),/JSON/);
  const invalid=[null,[],true,42,{}, {theme:'dark'},
    {version:1,value:[{type:'p',children:[{text:'An article'}]}],bibliographyLibraries:[]},
    {version:2,doc:{type:'doc',content:[]}},
    {...valid,format:'other'}, {...valid,version:2}, {...valid,display:'true'},
    {...valid,numbered:0}, {...valid,display:undefined}, {...valid,snapshot:JSON.stringify(snapshot)},
    {...valid,snapshot:null}, {...valid,snapshot:{...snapshot,version:1}},
    {...snapshot,version:undefined}, {...snapshot,format:'other'}];
  for(const value of invalid)assert.throws(()=>decodeFormulaFile(JSON.stringify(value)),undefined,JSON.stringify(value));
});

test('invalid tree shape, cursor, IDs and illegal standalone nesting never open as an empty or rewritten formula',()=>{
  const region=(id,items)=>({id,items});
  const node=(type,regions,extra={})=>({id:'n900001',type,regions,...extra});
  const basic=saved(blank()),fraction=saved(parsed('\\frac{a}{b}'));
  const invalidItems=[null,42,'two',node('not-a-structure',[]),node('frac',[]),
    node('frac',[region('r900002',['a']),region('r900002',['b'])]),
    node('source-tex',[region('r900002',[node('sqrt',[region('r900003',['x'])])])]),
    node('matrix',[region('r900002',['x'])],{columns:2,rows:1}),
    node('sum',[{...region('r900002',['a']),slot:'upper'},{...region('r900003',['b']),slot:'upper'}],{operatorLayout:true})];
  for(const item of invalidItems){const value=plain(basic);value.root.items=[item];assert.throws(()=>decodeFormulaFile(JSON.stringify(envelope(value))),/invalid|unsupported/);}
  for(const cursor of [{region:'r99999999',offset:0,anchor:0},{region:basic.root.id,offset:1,anchor:0},{region:basic.root.id,offset:0,anchor:-1},{region:basic.root.id,offset:0.5,anchor:0}])
    assert.throws(()=>decodeFormulaFile(JSON.stringify(envelope({...basic,cursor}))),/invalid|unsupported/);
  assert.throws(()=>decodeFormulaFile(JSON.stringify(envelope({...fraction,pendingFont:'not-a-font'}))),/invalid|unsupported/);
  const layout=blank();assert.equal(layout.initializeFormula('numcases'),true);
  const nested=plain(fraction);nested.root.items[0].regions[0].items=[saved(layout).root.items[0]];
  assert.throws(()=>decodeFormulaFile(JSON.stringify(envelope(nested))),/invalid|unsupported/,'Do not silently flatten illegal nested equation environments to source');
});

test('unsafe keys and deeply nested JSON are rejected before model restoration',()=>{
  for(const key of ['__proto__','constructor','prototype']){
    const value=envelope(saved(blank()));value.extra=JSON.parse('{"'+key+'":{"polluted":true}}');
    assert.throws(()=>decodeFormulaFile(JSON.stringify(value)),/unsafe|nested/);
  }
  let deep={};for(let i=0;i<250;i++)deep={child:deep};
  const value=envelope(saved(blank()));value.extra=deep;
  assert.throws(()=>decodeFormulaFile(JSON.stringify(value)),/unsafe|nested/);
  assert.equal({}.polluted,undefined);
});

test('file limit counts UTF-8 bytes and saving invalid state never mutates the model',()=>{
  const model=parsed('a+b'),text=encodeFormulaFile(model,{display:false,numbered:false});
  assert.equal(decodeFormulaFile(text.padEnd(maxFormulaFileBytes,' ')).model.snapshot(),model.snapshot());
  assert.throws(()=>decodeFormulaFile(text.padEnd(maxFormulaFileBytes+1,' ')),/size limit/);
  const multibyte='汉'.repeat(Math.floor(maxFormulaFileBytes/3)+1);
  assert.ok(multibyte.length<maxFormulaFileBytes);
  assert.throws(()=>decodeFormulaFile(multibyte),/size limit/);
  for(const options of [null,{}, {display:0,numbered:false},{display:true,numbered:'false'}])assert.throws(()=>encodeFormulaFile(model,options),/booleans/);
  model.root.items.push('invalid multi-character item');
  const before=model.snapshot();
  assert.throws(()=>encodeFormulaFile(model,{display:false,numbered:false}),/invalid|unsupported/);
  assert.equal(model.snapshot(),before);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {buildSync}=require('esbuild');
const compiled=buildSync({stdin:{contents:`export {convertMath} from './src/tex-convert';export {EditorModel} from './src/editor-model';export * from './src/mathjax-extension-policy';`,resolveDir:__dirname},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const loaded={exports:{}};new Function('module','exports','require',compiled)(loaded,loaded.exports,require);
const api=loaded.exports;
let mathjax;
test.before(async()=>{
  mathjax=await require('mathjax').init({loader:{paths:{mathjax:pathToFileURL(path.dirname(require.resolve('mathjax/package.json'))).href},load:['input/tex',...api.mathJaxExtensionLoads]},
    tex:{packages:{'[+]':api.mathJaxTexPackages,'[-]':api.mathJaxDisabledTexPackages},tags:'ams'}});
});
const mml=source=>{mathjax.texReset(0);const value=mathjax.tex2mml(source,{display:true});assert.doesNotMatch(value,/<merror\b/,source);return value.replace(/\sdata-latex(?:-[\w-]+)?="[^"]*"/g,'').replace(/>\s+</g,'><').trim();};
const blank=()=>{const model=new api.EditorModel();model.root.items=[];model.index();model.setCursor(model.root.id,0);return model;};

test('numbered and subnumbered cases retain their native editable rows and exact MathJax presentation',()=>{
  for(const name of ['numcases','subnumcases']){
    const source=`\\begin{${name}}{f(x)=}\\sqrt{x}&x>0\\\\-x&x<0\\\\0&x=0\\end{${name}}`;
    const model=api.convertMath(source),node=model.root.items[0],body=node.regions[1].items[0];
    assert.equal(node.type,name);assert.equal(body.type,'numbered-cases-body');assert.equal(body.rows,3);assert.equal(body.columns,2);
    assert.equal(body.regions.length,6);assert.equal(body.regions[0].items[0].type,'sqrt');
    assert.equal(mml(model.exportLatex()),mml(source));
    const restored=blank();restored.restore(model.snapshot());assert.equal(restored.exportLatex(),model.exportLatex());
  }
});

test('numbered cases use the same row insertion and deletion operations without losing other contents',()=>{
  const model=api.convertMath(String.raw`\begin{numcases}{f=}a&b\\c&d\end{numcases}`);
  const body=model.root.items[0].regions[1].items[0],before=model.snapshot(),original=body.regions.map(region=>region.id);
  model.setCursor(body.regions[2].id,0);const editing=model.snapshot();assert.equal(model.editTable(body.id,body.regions[2].id,'rowBefore'),true);
  assert.equal(body.rows,3);assert.equal(body.regions[0].id,original[0]);assert.equal(body.regions[4].id,original[2]);
  assert.equal(model.exportLatex(),String.raw`\begin{numcases}{f=}a&b\\&\\c&d\end{numcases}`);
  assert.equal(model.editTable(body.id,body.regions[2].id,'deleteRow'),true);
  assert.equal(body.rows,2);assert.equal(model.exportLatex(),String.raw`\begin{numcases}{f=}a&b\\c&d\end{numcases}`);
  model.undo();assert.equal(model.root.items[0].regions[1].items[0].rows,3);model.undo();assert.equal(model.snapshot(),editing);
  assert.ok(before);
});

test('inserting numbered cases initializes editable cells and switching numbering preserves identities',()=>{
  const model=blank();model.insert('q+');model.insertStructure('numcases');const node=model.root.items[2],body=node.regions[1].items[0];
  assert.equal(body.rows,2);assert.equal(body.regions.length,4);
  model.insert('f=');model.setCursor(body.regions[0].id,0);model.insert('x');
  const originalIds=body.regions.map(region=>region.id),before=model.snapshot();
  assert.equal(model.switchVariant(node.id,'subnumcases'),true);assert.equal(node.type,'subnumcases');
  assert.deepEqual(body.regions.map(region=>region.id),originalIds);assert.deepEqual(node.regions[0].items,['f','=']);assert.deepEqual(body.regions[0].items,['x']);
  model.undo();assert.equal(model.snapshot(),before);
});

test('numbered case conditions preserve text spaces and inline math through native clipboard and row insertion',()=>{
  const condition=String.raw`if $x\le0$ 中文`,source=String.raw`\begin{numcases}{f=}x&`+condition+String.raw`\\0&otherwise\end{numcases}`;
  const model=api.convertMath(source),body=model.root.items[0].regions[1].items[0],text=body.regions[1].items[0];
  assert.equal(text.type,'case-text');assert.equal(text.regions[0].items.join(''),condition);assert.equal(model.exportLatex(),source);
  model.setCursor(text.regions[0].id,text.regions[0].items.length,0);assert.equal(model.rawInput,true);
  const fragment=blank();fragment.restore(model.selectionSnapshot());assert.equal(fragment.root.items[0].type,'case-text');
  const destination=blank();destination.replaceFragment(fragment.root.items);assert.equal(destination.exportLatex(),'\\textnormal{'+condition+'}');
  model.setCursor(body.regions[0].id,0);assert.equal(model.editTable(body.id,body.regions[0].id,'rowAfter'),true);
  const inserted=body.regions[3].items[0];assert.equal(inserted.type,'case-text');model.setCursor(inserted.regions[0].id,0);
  assert.equal(model.rawInput,true);model.replaceInput(...model.range,'another $x^2$');assert.equal(inserted.regions[0].items.join(''),'another $x^2$');
});

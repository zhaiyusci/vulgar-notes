const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const Module=require('node:module');
const path=require('node:path');
const loaded=new Module(path.join(process.cwd(),'boldsymbol-input-test.cjs'),module);loaded.paths=module.paths;
loaded._compile(buildSync({entryPoints:['src/editor-model.ts'],bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text,loaded.id);
const {EditorModel,symbols}=loaded.exports;
const blank=()=>{const model=new EditorModel();model.root.items=[];model.index();model.setCursor(model.root.id,0);return model;};
const input=(model,source,streamed)=>{if(streamed)for(const char of source)model.replaceInput(...model.range,char);else model.replaceInput(...model.range,source);};

test('typed boldsymbol Greek commands build a native bold sigma with an ordinary alpha subscript',()=>{
  for(const streamed of [false,true]){
    const model=blank();input(model,String.raw`\boldsymbol \sigma _\alpha`,streamed);
    // The last control word is still a completion candidate until the user
    // confirms it, just like any other command typed without a delimiter.
    assert.equal(model.pendingCommand().name,'alpha');assert.equal(model.commitCommand(),true);
    const subscript=model.root.items[0];assert.equal(subscript.type,'subscript');
    assert.equal(subscript.regions[0].items[0].type,'symbol-sigma--boldsymbol');
    assert.equal(subscript.regions[1].items[0].type,'symbol-alpha');
    assert.equal(model.exportLatex(),'{\\boldsymbol{\\sigma}}_{\\alpha }');
    assert.equal(model.pendingFont,undefined);assert.equal(model.cursor.region,subscript.regions[1].id);
    assert.equal(model.exportLatex().includes('\\mathbf'),false);
  }
});

test('typed boldsymbol formats only the next letter and leaves following characters in the same flow',()=>{
  for(const streamed of [false,true]){
    const model=blank();input(model,String.raw`\boldsymbol xyz`,streamed);
    assert.equal(model.root.items[0].type,'symbol-letter-x--boldsymbol');assert.deepEqual(model.root.items.slice(1),['y','z']);
    assert.equal(model.cursor.region,model.root.id);assert.equal(model.cursor.offset,3);assert.equal(model.pendingFont,undefined);
    assert.equal(model.exportLatex(),'\\boldsymbol{x}yz');
    const roman=blank();input(roman,String.raw`\mathbf x`,streamed);
    assert.equal(roman.root.items[0].type,'symbol-letter-x--symbf');assert.equal(roman.exportLatex(),'\\mathbf{x}');
    assert.notEqual(model.root.items[0].type,roman.root.items[0].type,'Boldsymbol is not an alias for mathbf');
  }
});

test('typed boldsymbol atoms and their scripts survive native save and clipboard round trips',()=>{
  const model=blank();input(model,String.raw`\boldsymbol \sigma _\alpha `,false);
  const expected=model.exportLatex(),restored=new EditorModel();restored.restore(model.snapshot());
  assert.equal(restored.exportLatex(),expected);assert.equal(restored.root.items[0].regions[0].items[0].type,'symbol-sigma--boldsymbol');
  model.setCursor(model.root.id,1,0);assert.equal(model.selectionLatex(),expected);
  const selected=new EditorModel();selected.restore(model.selectionSnapshot());
  const destination=blank();destination.replaceFragment(selected.root.items);assert.equal(destination.exportLatex(),expected);
  assert.equal(destination.root.items[0].regions[0].items[0].type,'symbol-sigma--boldsymbol');
  assert.equal(destination.root.items[0].regions[1].items[0].type,'symbol-alpha');
  assert.notEqual(destination.root.items[0].id,model.root.items[0].id);
  destination.undo();assert.equal(destination.exportLatex(),'');destination.redo();assert.equal(destination.exportLatex(),expected);
  const atom=symbols.find(definition=>definition.type==='symbol-sigma--boldsymbol');assert.equal(atom.hidden,true);assert.equal(atom.commandCandidate,false);
});

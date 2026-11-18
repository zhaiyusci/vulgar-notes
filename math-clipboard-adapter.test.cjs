const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');

const mathBuild=build({stdin:{contents:"export * from './src/math-clipboard';export {EditorModel} from './src/editor-model';",resolveDir:__dirname},bundle:true,write:false,platform:'node',format:'cjs',metafile:true});
const bridgeBuild=build({stdin:{contents:"export {documentMathClipboard} from './src/document-math-clipboard';export {readNativeClipboard,nativeClipboardHtml} from './src/native-clipboard';",resolveDir:__dirname},bundle:true,write:false,platform:'node',format:'cjs'});
function load(buildResult,DOMParser){const module={exports:{}};new Function('module','exports','require','DOMParser',buildResult.outputFiles[0].text)(module,module.exports,require,DOMParser);return module.exports;}
const mime='application/x-vulgar-notes-fragment+json';
const transfer=(initial={})=>{const values=new Map(Object.entries(initial));return {values,getData:type=>values.get(type)??'',setData:(type,value)=>values.set(type,value)};};
const blank=api=>{const model=new api.EditorModel();model.root.items=[];model.index();model.setCursor(model.root.id,0);return model;};
const formula=snapshot=>({type:'inline_equation',snapshot,texExpression:'untrusted text fallback',children:[{text:''}]});
const paragraph=(...children)=>({type:'p',children});

test('formula clipboard bundles without document, bibliography, Plate or browser globals',async()=>{
  const result=await mathBuild,inputs=Object.keys(result.metafile.inputs);
  assert.equal(inputs.some(file=>/src\/(?:plate-|bibtex|bibliography-|references|native-clipboard|document-)/.test(file.replaceAll('\\','/'))),false);
  assert.equal(inputs.some(file=>/node_modules\/(?:@platejs\/|platejs\/|slate(?:-react|-history)?\/)/.test(file.replaceAll('\\','/'))),false);
  const api=load(result),model=blank(api);model.insertStructure('frac');model.insert('α');model.insertStructure('sqrt');model.insert('中');
  const snapshot=model.snapshot(),latex=model.exportLatex(),data=transfer();
  assert.equal(api.mathClipboard.write(data,snapshot,latex),true);assert.equal(data.getData('text/plain'),latex);
  assert.deepEqual(api.mathClipboard.read(data),{snapshot});
  const bridge=load(await bridgeBuild);assert.deepEqual(bridge.readNativeClipboard(data),{version:1,kind:'math',snapshot});
  data.values.delete(mime);assert.deepEqual(api.mathClipboard.read(data),{snapshot},'portable HTML marker works without parsing document HTML');
});

test('math clipboard writes readable text before optional structured formats and never claims a failed cut',async()=>{
  const api=load(await mathBuild),model=blank(api);model.insertSourceTex(String.raw`\future{a&b}<中>`);
  const attempted=[];
  assert.equal(api.mathClipboard.write({setData(type){attempted.push(type);throw Error('blocked');}},model.snapshot(),model.exportLatex()),false);
  assert.deepEqual(attempted,['text/plain']);
  const data=transfer(),writer={setData(type,value){if(type!=='text/plain')throw Error('optional format blocked');data.setData(type,value);}};
  assert.equal(api.mathClipboard.write(writer,model.snapshot(),model.exportLatex()),true);assert.equal(data.getData('text/plain'),model.exportLatex());
  const invalid=transfer();assert.equal(api.mathClipboard.write(invalid,'{}','readable source'),true);assert.equal(invalid.getData(mime),'');assert.equal(invalid.getData('text/html'),'');
});

test('math snapshots reject unsafe JSON and do not silently use an older HTML payload',async()=>{
  const api=load(await mathBuild),model=blank(api);model.insert('x');const good=transfer();api.mathClipboard.write(good,model.snapshot(),'x');
  for(const direct of ['{bad JSON',JSON.stringify({version:1,kind:'math',snapshot:'{}'}),'{"version":1,"kind":"math","snapshot":"{}","__proto__":{"polluted":true}}']){
    const data=transfer({[mime]:direct,'text/html':good.getData('text/html')});assert.equal(api.mathClipboard.read(data),undefined);
  }
  assert.equal(api.mathClipboard.read({getData(){throw Error('blocked');}}),undefined);assert.equal({}.polluted,undefined);
});

test('HTML source reads only a single explicit TeX annotation and does not interpret Markdown',async t=>{
  const {Window}=await import('happy-dom'),window=new Window();t.after(()=>window.happyDOM.abort());
  const api=load(await mathBuild,window.DOMParser);
  const annotated='<math><semantics><mi>wrong glyph</mi><annotation encoding="application/x-tex">\\frac{α}{中}</annotation></semantics></math>';
  assert.deepEqual(api.mathClipboard.read(transfer({'text/html':annotated,'text/plain':'wrong fallback'})),{source:String.raw`\frac{α}{中}`});
  assert.deepEqual(api.mathClipboard.read(transfer({'text/html':'<span data-vulgar-tex="a&amp;b" data-vulgar-display="true">rendered</span>'})),{source:'a&b'});
  assert.equal(api.mathClipboard.read(transfer({'text/html':'prose '+annotated})),undefined);
  assert.equal(api.mathClipboard.read(transfer({'text/html':annotated+annotated})),undefined);
  assert.equal(api.mathClipboard.read(transfer({'text/html':'<math><mi>x</mi></math>'})),undefined);
  assert.equal(api.mathClipboard.read(transfer({'text/plain':'# title **bold**'})),undefined);
});

test('document bridge validates the entire document before admitting its single formula',async()=>{
  const math=load(await mathBuild),bridge=load(await bridgeBuild),model=blank(math);model.insertStructure('sqrt');model.insert('x');
  const snapshot=model.snapshot(),payload={version:1,kind:'document',value:[paragraph({text:''},formula(snapshot),{text:''})]};
  const direct=transfer({[mime]:JSON.stringify(payload)});
  assert.equal(math.mathClipboard.read(direct),undefined,'standalone math does not know the document schema');
  assert.deepEqual(bridge.documentMathClipboard.read(direct),{snapshot});
  const html=transfer({'text/html':bridge.nativeClipboardHtml(payload,'formula')});assert.deepEqual(bridge.documentMathClipboard.read(html),{snapshot});
  for(const value of [
    {...payload,bibliographyLibraries:[{}]},
    {...payload,value:[paragraph({text:'surrounding prose'},formula(snapshot))]},
    {...payload,value:[paragraph(formula(snapshot),formula(snapshot))]},
    {...payload,value:[{type:'blockquote',children:[paragraph(formula(snapshot))]}]},
  ])assert.equal(bridge.documentMathClipboard.read(transfer({[mime]:JSON.stringify(value)})),undefined);
  const sourceOnly={version:1,kind:'document',value:[paragraph({type:'inline_equation',texExpression:String.raw`\futurecmd{a}`,children:[{text:''}]})]};
  assert.deepEqual(bridge.documentMathClipboard.read(transfer({[mime]:JSON.stringify(sourceOnly)})),{source:String.raw`\futurecmd{a}`});
});

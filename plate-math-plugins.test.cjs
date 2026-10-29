const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');

test('independent MathJax nodes preserve the Plate equation data and editing contract',async t=>{
 const {Window}=await import('happy-dom');const window=new Window({url:'http://localhost/'});
 window.document.write('<!doctype html><html><body></body></html>');
 for(const key of ['window','document','navigator','Node','Element','HTMLElement','Document','DocumentFragment','DOMParser','NodeFilter','Range'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
 t.after(()=>window.happyDOM.abort());
 const built=await build({stdin:{contents:"export {createSlateEditor,KEYS} from 'platejs';export * from './src/plate-math-plugins';",resolveDir:__dirname,loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,define:{'process.env.NODE_ENV':'"production"'}});
 const module={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(require,module,module.exports);
 const {createSlateEditor,KEYS,BaseEquationPlugin,BaseInlineEquationPlugin,insertEquation,insertInlineEquation}=module.exports;
 const create=value=>createSlateEditor({plugins:[BaseEquationPlugin,BaseInlineEquationPlugin],value:value??[{type:'p',children:[{text:''}]}]});
 await t.test('block and inline equations remain void nodes with the established keys and bound insertion transforms',()=>{
  const editor=create();editor.tf.select({path:[0,0],offset:0});
  editor.getTransforms(BaseInlineEquationPlugin).insert.inlineEquation('x^2',{select:true});
  const inline=editor.children[0].children.find(node=>node.type===KEYS.inlineEquation);
  assert.ok(inline);assert.equal(inline.texExpression,'x^2');assert.equal(editor.api.isInline(inline),true);assert.equal(editor.api.isVoid(inline),true);
  editor.getTransforms(BaseEquationPlugin).insert.equation({at:[1],select:true});
  const block=editor.children.find(node=>node.type===KEYS.equation);
  assert.ok(block);assert.equal(block.texExpression,'');assert.equal(editor.api.isInline(block),false);assert.equal(editor.api.isVoid(block),true);
  assert.deepEqual(inline.children,[{text:''}]);assert.deepEqual(block.children,[{text:''}]);
 });
 await t.test('selected prose becomes inline source without dropping its neighbours and explicit insertion options remain effective',()=>{
  const editor=create([{type:'p',children:[{text:'before x^2 after'}]}]);
  editor.tf.select({anchor:{path:[0,0],offset:7},focus:{path:[0,0],offset:10}});insertInlineEquation(editor,undefined,{select:true});
  const inline=editor.children[0].children.find(node=>node.type===KEYS.inlineEquation);
  assert.equal(inline.texExpression,'x^2');assert.equal(editor.api.string([]),'before  after');
  insertEquation(editor,{at:[1]});assert.equal(editor.children[1].type,KEYS.equation);
  assert.equal(editor.children[1].texExpression,'');
 });
 await t.test('legacy scalar sources normalize without altering formula identity, labels, snapshots or display choices',()=>{
  const cases=[[12,'12'],[true,'true'],[false,'false'],[null,''],[undefined,''],[{},''],['\\sigma_{\\alpha}','\\sigma_{\\alpha}']];
  for(const [source,expected]of cases){
   const properties={id:'legacy-formula',texExpression:source,snapshot:'existing-native-tree',numbered:false,texLabel:'eq:legacy',display:true,children:[{text:''}]};
   const editor=create([{type:'p',children:[{text:'a'},{...properties,type:KEYS.inlineEquation},{text:'b'}]},{...properties,id:'block-legacy',type:KEYS.equation}]);
   editor.tf.normalize({force:true});
   for(const formula of [editor.children[0].children.find(node=>node.type===KEYS.inlineEquation),editor.children[1]]){
    assert.equal(formula.texExpression,expected);assert.equal(formula.snapshot,properties.snapshot);
    assert.equal(formula.numbered,false);assert.equal(formula.texLabel,'eq:legacy');assert.equal(formula.display,true);
   }
   assert.equal(editor.children[0].children.find(node=>node.type===KEYS.inlineEquation).id,'legacy-formula');
   assert.equal(editor.children[1].id,'block-legacy');assert.equal(editor.api.string([0]),'ab');
  }
 });
 await t.test('native HTML equation attributes deserialize into source-bearing block and inline nodes',()=>{
  const editor=create();
  const value=editor.api.html.deserialize({element:'<div class="slate-equation" data-slate-tex-expression="x^2"></div><p>before <span class="slate-inline_equation" data-slate-tex-expression="\\alpha">ignored rendered glyph</span> after</p>'});
  const block=value.find(node=>node.type===KEYS.equation),paragraph=value.find(node=>node.type==='p');
  assert.ok(block,JSON.stringify(value));assert.equal(block.texExpression,'x^2');
  const inline=paragraph.children.find(node=>node.type===KEYS.inlineEquation);assert.ok(inline,JSON.stringify(value));assert.equal(inline.texExpression,'\\alpha');
  assert.equal(paragraph.children[0].text,'before ');assert.equal(paragraph.children.at(-1).text,' after');
 });
 await t.test('typing dollar delimiters stays literal and does not enable low-frequency Markdown rules',()=>{
  const editor=create();editor.tf.select({path:[0,0],offset:0});
  for(const text of ['$','x','$'])editor.tf.insertText(text);
  assert.equal(editor.api.string([]),'$x$');assert.equal(editor.children[0].children.some(node=>node.type===KEYS.inlineEquation),false);
 });
});

test('the complete production graph uses independent math nodes without Plate math or KaTeX styles',async()=>{
 const result=await build({absWorkingDir:__dirname,entryPoints:{'editor-ui':'src/app.tsx'},bundle:true,platform:'browser',target:'es2022',conditions:['production'],format:'esm',splitting:true,outdir:'diagnostics/mathjax-only-bundle-check',write:false,metafile:true,minify:true,define:{'process.env.NODE_ENV':'"production"'},alias:{path:'path-browserify'},loader:{'.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl'}});
 const inputs=Object.keys(result.metafile.inputs).map(path=>path.replaceAll('\\','/'));
 assert.ok(inputs.includes('src/plate-math-element.tsx'),'the real MathJax mount must be part of this production build');
 assert.ok(inputs.includes('src/plate-math-plugins.ts'),'the real editor kits must use the independent equation nodes');
 assert.deepEqual(inputs.filter(path=>/(?:^|\/)node_modules\/@platejs\/math\//.test(path)),[],'document equations must not import the alternative renderer');
 const styles=result.outputFiles.filter(file=>file.path.endsWith('.css')).map(file=>file.text).join('\n');
 assert.doesNotMatch(styles,/KaTeX_|\.katex(?:[-\s.{])/,'production CSS must not carry unused KaTeX faces or layout rules');
});

test('the equation kits and insertion facade do not import KaTeX code or styles',async()=>{
 const result=await build({stdin:{contents:"export * from './src/plate-math-plugins';export * from './src/components/editor/plugins/math-kit';export * from './src/components/editor/plugins/math-base-kit';",resolveDir:__dirname,loader:'ts'},bundle:true,platform:'browser',write:false,metafile:true,loader:{'.css':'empty'}});
 assert.deepEqual(Object.keys(result.metafile.inputs).filter(path=>/(?:^|[\\/])(?:katex|@platejs[\\/]math)[\\/]/.test(path)),[]);
});

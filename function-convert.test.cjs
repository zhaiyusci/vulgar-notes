const test=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const {buildSync}=require('esbuild');
const compiled=buildSync({stdin:{contents:`export {convertMath} from './src/tex-convert'; export {mathFunctions} from './src/math-functions'; export {EditorModel,catalog} from './src/editor-model';`,resolveDir:__dirname},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const loaded={exports:{}};new Function('module','exports','require',compiled)(loaded,loaded.exports,require);
const {convertMath,mathFunctions,EditorModel,catalog}=loaded.exports;
const optionalExpressions='sin sinh arcsin asin cos cosh arccos acos tan tanh arctan atan csc csch arccsc acsc sec sech arcsec asec cot coth arccot acot log ln'.split(' ');
const automaticOnly='exp det Pr tr Tr erf'.split(' ');
const namedAliases={sine:'sin',hypsine:'sinh',arcsine:'arcsin',asine:'asin',cosine:'cos',hypcosine:'cosh',arccosine:'arccos',acosine:'acos',tangent:'tan',hyptangent:'tanh',arctangent:'arctan',atangent:'atan',cosecant:'csc',hypcosecant:'csch',arccosecant:'arccsc',acosecant:'acsc',secant:'sec',hypsecant:'sech',arcsecant:'arcsec',asecant:'asec',cotangent:'cot',hypcotangent:'coth',arccotangent:'arccot',acotangent:'acot',exponential:'exp',logarithm:'log',naturallogarithm:'ln',determinant:'det',Probability:'Pr'};
let mathjax;
test.before(async()=>{
  // Input-only MathJax uses the exact installed physics implementation without
  // fonts, browser state or a network request. File URLs are needed on Windows.
  const root=pathToFileURL(path.dirname(require.resolve('mathjax/node-main.cjs'))+'/').href.replace(/\/$/,'');
  mathjax=await require('mathjax').init({loader:{paths:{mathjax:root},load:['input/tex','[tex]/physics']},tex:{packages:{'[+]':['physics']}},startup:{typeset:false}});
});
const nodes=model=>{const result=[];const visit=region=>{for(const item of region.items)if(typeof item!=='string'){result.push(item);item.regions.forEach(visit);}};visit(model.root);return result;};
const nativeFunction=(model,name)=>nodes(model).find(node=>node.type==='function-'+name||node.type==='function-'+name+'-exponent');
const mml=async source=>{
  mathjax.startup.document.inputJax[0].parseOptions.tags.reset(0);
  const result=await mathjax.tex2mmlPromise(source,{display:false});
  assert.doesNotMatch(result,/<merror\b/,source);return result;
};
function presentation(source){
  // TeX may add an explicit one-token argument group around a script without
  // changing its contents. Compare tokens, stretching and script/fraction
  // structure separately; do not confuse different source metadata with errors.
  const tokens=[...source.matchAll(/<(mi|mn|mo|mtext)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map(([,type,attributes,text])=>({
    type,text:text.trim(),stretchy:/\bstretchy="false"/.test(attributes)?false:undefined,
    texclass:/\bdata-mjx-texclass="([^"]+)"/.exec(attributes)?.[1],
  }));
  const structures=[...source.matchAll(/<(mfrac|msup|msub|msubsup|mover|munder|munderover)\b/g)].map(match=>match[1]);
  return {tokens,structures};
}
const canonicalMathML=source=>source.replace(/\sdata-latex(?:-[\w-]+)?="[^"]*"/g,'').replace(/>\s+</g,'><').trim();
async function samePresentation(source,model){
  const before=await mml(source),after=await mml(model.exportLatex());
  assert.deepEqual(presentation(after),presentation(before),source+' -> '+model.exportLatex());
  return {before,after};
}

test('function grammar metadata agrees with the enabled MathJax physics command map',()=>{
  for(const name of optionalExpressions){
    const definition=mathFunctions.find(entry=>entry.name===name);assert.ok(definition,name);
    assert.equal(definition.command,name);assert.equal(definition.automaticParentheses,true,name);assert.equal(definition.optionalExponent,true,name);
  }
  for(const name of automaticOnly){
    const definition=mathFunctions.find(entry=>entry.name===name);assert.ok(definition,name);
    assert.equal(definition.automaticParentheses,true,name);assert.equal(!!definition.optionalExponent,false,name);
  }
  assert.ok(mathFunctions.find(entry=>entry.name==='Tr').aliases.includes('Trace'));
  assert.ok(mathFunctions.find(entry=>entry.name==='tr').aliases.includes('trace'));
  for(const name of ['rank',...Object.keys(namedAliases)]){
    const definition=mathFunctions.find(entry=>entry.name===name);assert.ok(definition,name);
    assert.equal(!!definition.automaticParentheses,false,name);assert.equal(!!definition.optionalExponent,false,name);
  }
});

test('bare Tr, Trace, tr and trace convert to native functions without losing their case',async()=>{
  for(const [command,name] of [['Tr','Tr'],['Trace','Tr'],['tr','tr'],['trace','tr']]){
    for(const suffix of ['',String.raw` x`,String.raw`_{b}^{2} x`]){
      const source='\\'+command+suffix,model=convertMath(source),fn=nativeFunction(model,name);
      assert.ok(fn,source);assert.equal(fn.operatorLayout,true);assert.equal(fn.atom,undefined);
      assert.equal(catalog.find(entry=>entry.type===fn.type).category,'函数名称');
      assert.equal(nodes(model).some(node=>node.type==='source-tex'),false,source);
      await samePresentation(source,model);
    }
  }
});

test('function scripts remain on an OP function rather than wrapping it in an Ord base group',async()=>{
  for(const name of ['Tr','tr','sin','exp','rank']){
    const source='\\'+name+String.raw`_{b}^{2} x`,model=convertMath(source),fn=nativeFunction(model,name);
    assert.ok(fn,source);assert.deepEqual(fn.regions.map(region=>region.slot),['lower','upper']);
    assert.equal(model.root.items[0],fn);assert.equal(nodes(model).some(node=>['power','subscript','sup'].includes(node.type)),false);
    const {after}=await samePresentation(source,model);
    assert.match(after,/<msubsup\b[^>]*>\s*<mi\b[^>]*>/,source);
    assert.match(after,/&#x2061;/,source+' retains function application spacing');
  }
});

test('known operatorname forms retain their wrapper and never acquire automatic parentheses',async()=>{
  for(const name of ['Tr','tr','sin','rank','arcsinh','sgn']){
    const source='\\operatorname{'+name+String.raw`}(\frac{a}{b})`,model=convertMath(source);
    assert.ok(nodes(model).some(node=>node.type==='function-operatorname-'+name),source);
    assert.equal(nodes(model).some(node=>node.type==='source-tex'),false,source);
    assert.match(model.exportLatex(),new RegExp('^\\\\operatorname\\{'+name+'\\}'));
    const {after}=await samePresentation(source,model);
    assert.match(after,/<mo\b[^>]*stretchy="false"[^>]*>\(<\/mo>/,source);
  }
});

test('all physics Expression functions preserve automatic parentheses around a fraction',async()=>{
  for(const name of [...optionalExpressions,...automaticOnly]){
    const source='\\'+name+String.raw`(\frac{a}{b})+y`,model=convertMath(source),fn=nativeFunction(model,name);
    assert.ok(fn,source);assert.deepEqual(fn.regions,[]);
    assert.ok(nodes(model).some(node=>node.type==='physics-auto-parens'),source+' has an editable automatic fence');
    assert.ok(nodes(model).some(node=>node.type==='frac'),source+' keeps the argument editable');
    const {before,after}=await samePresentation(source,model);
    assert.equal(canonicalMathML(after),canonicalMathML(before),source+' preserves the physics fence atom class');
    assert.doesNotMatch(after,/<mo\b[^>]*stretchy="false"[^>]*>\(<\/mo>/,source);
  }
});

test('all optional-exponent Expressions preserve the exponent and automatic parentheses together',async()=>{
  for(const name of optionalExpressions){
    const source='\\'+name+String.raw`[2](\frac{a}{b})+y`,model=convertMath(source),fn=nativeFunction(model,name);
    assert.ok(fn,source);assert.deepEqual(fn.regions.map(region=>region.slot),['upper']);
    assert.ok(nodes(model).some(node=>node.type==='physics-auto-parens'),source);
    assert.ok(nodes(model).some(node=>node.type==='frac'),source);
    const {before,after}=await samePresentation(source,model);
    assert.equal(canonicalMathML(after),canonicalMathML(before),source+' preserves optional-exponent and fence grammar');
    assert.doesNotMatch(after,/<mo\b[^>]*stretchy="false"[^>]*>\(<\/mo>/,source);
    const restored=new EditorModel();restored.restore(model.snapshot());assert.equal(restored.exportLatex(),model.exportLatex());
  }
});

test('functions that do not consume optional exponents retain following square brackets literally',async()=>{
  for(const name of [...automaticOnly,'rank','sine']){
    const source='\\'+name+String.raw`[2](\frac{a}{b})`,model=convertMath(source),fn=nativeFunction(model,name);
    assert.ok(fn,source);assert.deepEqual(fn.regions,[]);
    const {after}=await samePresentation(source,model);
    assert.match(after,/<mo\b[^>]*stretchy="false"[^>]*>\[<\/mo>/,source);
    assert.match(after,/<mo\b[^>]*stretchy="false"[^>]*>\(<\/mo>/,source);
  }
});

test('an optional function exponent also stays native when no parenthesis follows',async()=>{
  for(const name of optionalExpressions){
    const source='\\'+name+'[2] x',model=convertMath(source),fn=nativeFunction(model,name);
    assert.ok(fn,source);assert.deepEqual(fn.regions.map(region=>region.slot),['upper']);
    assert.equal(nodes(model).some(node=>node.type==='physics-auto-parens'),false);
    await samePresentation(source,model);
  }
});

test('clearing an imported optional exponent removes its hidden variant and preserves the argument',async()=>{
  const model=convertMath('\\sin[2](x)'),fn=nativeFunction(model,'sin');
  assert.ok(fn);assert.equal(fn.type,'function-sin-exponent');
  const upper=fn.regions.find(region=>region.slot==='upper');assert.ok(upper);
  model.setCursor(upper.id,upper.items.length);model.remove(-1);
  const cleared=nativeFunction(model,'sin');assert.equal(cleared.type,'function-sin');assert.deepEqual(cleared.regions,[]);
  assert.equal(model.cursor.region,model.root.id);
  assert.ok(nodes(model).some(node=>node.type==='physics-auto-parens'));
  await samePresentation('\\sin(x)',model);
  model.undo();assert.equal(nativeFunction(model,'sin').type,'function-sin-exponent');
  await samePresentation('\\sin[2](x)',model);
});

test('scripts after automatically sized parentheses apply to the argument, not the preceding function',async()=>{
  for(const prefix of ['\\Tr','\\sin[2]']){
    const source=prefix+'(x)_{b}^{3}+y',model=convertMath(source);
    const fn=nativeFunction(model,prefix.includes('Tr')?'Tr':'sin');assert.ok(fn,source);
    assert.deepEqual(fn.regions.map(region=>region.slot),prefix.includes('[2]')?['upper']:[]);
    const scripted=nodes(model).find(node=>node.type==='sup');assert.ok(scripted,source);
    assert.equal(scripted.regions[0].items[0].type,'physics-auto-parens');
    const {before,after}=await samePresentation(source,model);
    assert.equal(canonicalMathML(after),canonicalMathML(before),source);
  }
});

test('editing or moving a physics automatic fence retains its visible sizing when the original trigger is gone',async()=>{
  const model=convertMath(String.raw`\sin[2](\frac{a}{b})`),fn=nativeFunction(model,'sin');
  const upper=fn.regions.find(region=>region.slot==='upper');model.setCursor(upper.id,upper.items.length);model.remove(-1);
  model.setCursor(model.root.id,1);model.replaceInput(...model.range,'^');model.insert('3');
  assert.equal(model.exportLatex(),String.raw`\sin^{3} \left(\frac{a}{b}\right)`);
  const result=await mml(model.exportLatex());assert.doesNotMatch(result,/<mo\b[^>]*stretchy="false"[^>]*>\(<\/mo>/);
  const fence=model.root.items[1],destination=new EditorModel();destination.root.items=[];destination.index();destination.setCursor(destination.root.id,0);
  destination.replaceFragment([fence]);assert.equal(destination.exportLatex(),String.raw`\left(\frac{a}{b}\right)`);
});

test('all long physics NamedFn spellings stay native and keep ordinary parentheses',async()=>{
  for(const [name,label] of Object.entries(namedAliases)){
    const source='\\'+name+String.raw`(\frac{a}{b})`,model=convertMath(source);
    assert.ok(nativeFunction(model,name),source);
    assert.equal(nodes(model).some(node=>node.type==='source-tex'),false,source);
    const {after}=await samePresentation(source,model);
    assert.match(after,new RegExp('<mi\\b[^>]*>'+label+'<\\/mi>'),source);
    assert.match(after,/<mo\b[^>]*stretchy="false"[^>]*>\(<\/mo>/,source);
  }
});

test('explicit ordinary scripts do not accidentally trigger later automatic parentheses',async()=>{
  for(const name of ['sin','log','Tr']){
    const source='\\'+name+String.raw`^{2}(\frac{a}{b})`,model=convertMath(source);
    assert.ok(nativeFunction(model,name),source);
    const {after}=await samePresentation(source,model);
    assert.match(after,/<mo\b[^>]*stretchy="false"[^>]*>\(<\/mo>/,source);
  }
});

test('function recognition consumes complete case-sensitive control words only',()=>{
  for(const source of [String.raw`\Trx{a}`,String.raw`\TRACE{x}`,String.raw`\traceable{x}`]){
    const model=convertMath(source);assert.equal(model.exportLatex(),source);
    assert.equal(nodes(model).some(node=>node.type.startsWith('function-')),false);
    assert.ok(nodes(model).some(node=>node.type==='source-tex'));
  }
});

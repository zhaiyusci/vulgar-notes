const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const Module=require('node:module');
const path=require('node:path');
const bundled=buildSync({stdin:{contents:"export {convertMath} from './src/tex-convert';export {EditorModel} from './src/editor-model';",sourcefile:'tex-convert-test.ts',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text;
const loaded=new Module(path.join(process.cwd(),'tex-convert-test.cjs'),module);loaded.paths=module.paths;loaded._compile(bundled,loaded.id);
const {convertMath,EditorModel}=loaded.exports;
const allNodes=model=>{const result=[];const visit=region=>{for(const item of region.items)if(typeof item!=='string'){result.push(item);if(item.type!=='source-tex')item.regions.forEach(visit);}};visit(model.root);return result;};
const raw=model=>allNodes(model).filter(node=>node.type==='source-tex').map(node=>node.regions[0].items.join(''));
const types=model=>allNodes(model).map(node=>node.type);
const verify=source=>{const model=convertMath(source);assert.ok(model);const restored=new EditorModel();restored.restore(model.snapshot());assert.equal(restored.exportLatex(),model.exportLatex());return model;};

test('fully supported TeX keeps the strict native conversion path',()=>{
  const model=verify('\\frac{\\sqrt[3]{x+1}}{a+\\frac{b}{c}}+x_i^2');
  assert.deepEqual(raw(model),[]);
  assert.equal(model.exportLatex(),'\\frac{\\sqrt[3]{x+1}}{a+\\frac{b}{c}}+{x}_{i}^{2}');
  assert.ok(types(model).includes('nthroot'));assert.equal(types(model).filter(type=>type==='frac').length,2);
});

test('unknown command preserves its remaining region, while enclosing known structures still edit',()=>{
  const source='\\frac{a+\\futurecmd{x}+b^2}{\\sqrt{y}}+z';
  const model=verify(source);assert.equal(model.exportLatex(),source);
  assert.deepEqual(raw(model),['\\futurecmd{x}+b^2']);
  assert.equal(model.root.items[0].type,'frac');assert.ok(types(model).includes('sqrt'));
  assert.deepEqual(model.root.items[0].regions[0].items.slice(0,2),['a','+']);
});

test('unknown scope or token-inspecting macros never allow their tail to be rewritten',()=>{
  for(const source of ['\\foo x^2+\\frac{a}{b}','\\foo{a} x^2','\\foo[2]{a}\r\nx_i','\\def\\x#1{#1}x^2','\\char64^2']){
    const model=verify(source);assert.deepEqual(raw(model),[source]);assert.equal(model.exportLatex(),source);
  }
  const model=verify('\\sqrt{x}+\\foo x^2');assert.ok(types(model).includes('sqrt'));assert.deepEqual(raw(model),['\\foo x^2']);
});

test('known but unsupported command forms remain local and preserve trailing command whitespace',()=>{
  const model=verify('\\mathbf{x+\\alpha}+\\frac{a}{b}+\\sin^2 x');
  assert.deepEqual(raw(model),['\\mathbf{x+\\alpha}']);
  assert.ok(types(model).includes('frac'));assert.ok(types(model).includes('function-sin'));
  assert.equal(model.exportLatex(),'\\mathbf{x+\\alpha}+\\frac{a}{b}+\\sin^{2} x');
  const source='\\operatorname{Tr}_{\\mathrm{b}} x+\\sqrt{y}',operator=verify(source);
  assert.deepEqual(raw(operator),[]);assert.ok(types(operator).includes('sqrt'));assert.ok(types(operator).includes('function-operatorname-Tr'));
  assert.equal(operator.exportLatex(),source);
});

test('font conversion is per letter and a script still applies to the complete font group',()=>{
  const model=verify('\\mathrm{eq}_i+\\mathbf{q}_i+\\mathcal{J}');
  assert.deepEqual(raw(model),[]);
  const first=model.root.items[0];assert.equal(first.type,'subscript');assert.equal(first.regions[0].items.length,2);
  assert.equal(first.regions[0].items[0].type,'symbol-letter-e--symup');assert.equal(first.regions[0].items[1].type,'symbol-letter-q--symup');
  assert.equal(model.exportLatex(),'{\\mathrm{e}\\mathrm{q}}_{i}+{\\mathbf{q}}_{i}+\\mathcal{J}');
  for(const source of ['\\mathcal{\\alpha}+\\frac{a}{b}','\\mathbf{x+\\alpha}+\\sqrt{y}']){
    const mixed=verify(source);assert.equal(raw(mixed).length,1);assert.ok(types(mixed).some(type=>type==='frac'||type==='sqrt'));assert.equal(mixed.exportLatex(),source);
  }
  assert.equal(verify('a+\\mathrm{}+b').exportLatex(),'a+\\mathrm{}+b');
});

test('plain sigma and its Greek subscript are directly editable, without a source node',()=>{
  for(const source of ['\\sigma_{\\alpha}','\\sigma_\\alpha']){
    const model=verify(source),subscript=model.root.items[0];assert.deepEqual(raw(model),[]);
    assert.equal(subscript.type,'subscript');assert.equal(subscript.regions[0].items[0].type,'symbol-sigma');assert.equal(subscript.regions[1].items[0].type,'symbol-alpha');
    assert.equal(model.exportLatex(),'{\\sigma }_{\\alpha }');
  }
});

test('boldsymbol sigma keeps its bold command while exposing its ordinary subscript',()=>{
  for(const source of ['\\boldsymbol{\\sigma}_{\\alpha}','\\boldsymbol{\\sigma}_\\alpha']){
    const model=verify(source),subscript=model.root.items[0];assert.deepEqual(raw(model),[]);
    assert.equal(subscript.type,'subscript');assert.equal(subscript.regions[0].items[0].type,'symbol-sigma--boldsymbol');assert.equal(subscript.regions[1].items[0].type,'symbol-alpha');
    assert.equal(model.exportLatex(),'{\\boldsymbol{\\sigma}}_{\\alpha }');
    assert.equal(model.exportLatex().includes('\\mathbf'),false,'Boldsymbol must not silently change to mathbf');
  }
});

test('boldsymbol preserves the original command for Latin, Greek and digits individually',()=>{
  const model=verify('\\boldsymbol{xA\\sigma\\Gamma1}');assert.deepEqual(raw(model),[]);
  assert.deepEqual(model.root.items.map(item=>item.type),['symbol-letter-x--boldsymbol','symbol-letter-A--boldsymbol','symbol-sigma--boldsymbol','symbol-Gamma--boldsymbol','symbol-letter-1--boldsymbol']);
  assert.equal(model.exportLatex(),'\\boldsymbol{x}\\boldsymbol{A}\\boldsymbol{\\sigma}\\boldsymbol{\\Gamma}\\boldsymbol{1}');
  for(const marker of ['\\mathbf','\\mathbfit','\\symbf'])assert.equal(model.exportLatex().includes(marker),false,'Do not infer a replacement font command');
});

test('a boldsymbol group and its script have distinct font scopes and keep the whole base',()=>{
  const model=verify('\\boldsymbol{x\\sigma}_{\\alpha_i}'),outer=model.root.items[0];assert.deepEqual(raw(model),[]);
  assert.equal(outer.type,'subscript');assert.deepEqual(outer.regions[0].items.map(item=>item.type),['symbol-letter-x--boldsymbol','symbol-sigma--boldsymbol']);
  const inner=outer.regions[1].items[0];assert.equal(inner.type,'subscript');assert.equal(inner.regions[0].items[0].type,'symbol-alpha');assert.deepEqual(inner.regions[1].items,['i']);
  assert.equal(model.exportLatex(),'{\\boldsymbol{x}\\boldsymbol{\\sigma}}_{{\\alpha }_{i}}');
  const denominator=verify('\\frac{\\boldsymbol{\\sigma}_{\\alpha}}{\\hat{\\boldsymbol{x}}}');assert.deepEqual(raw(denominator),[]);
  assert.equal(denominator.root.items[0].regions[1].items[0].type,'hat');assert.equal(denominator.root.items[0].regions[1].items[0].regions[0].items[0].type,'symbol-letter-x--boldsymbol');
});

test('boldsymbol contents with their own script or nested font are not mistaken for a trailing script',()=>{
  for(const source of ['\\boldsymbol{\\sigma_\\alpha}+\\frac{a}{b}','\\boldsymbol{\\mathrm{x}}+\\sqrt{y}','\\boldsymbol{x+\\alpha}+\\frac{a}{b}']){
    const model=verify(source);assert.equal(raw(model).length,1);assert.equal(model.exportLatex(),source);assert.ok(types(model).some(type=>type==='frac'||type==='sqrt'));
  }
  const inside=verify('\\boldsymbol{\\sigma_\\alpha}'),outside=verify('\\boldsymbol{\\sigma}_\\alpha');
  assert.equal(inside.root.items[0].type,'source-tex');assert.equal(outside.root.items[0].type,'subscript');
});

test('textnormal decodes safe text escapes while unsupported text syntax stays intact',()=>{
  const model=verify('\\textnormal{a\\_b \\% c}+\\ce{2 H2 + O2 -> 2 H2O}+\\pu{1.2 kg m/s^2}');
  assert.deepEqual(raw(model),[]);assert.ok(types(model).includes('text-normal'));assert.ok(types(model).includes('chem-ce'));assert.ok(types(model).includes('chem-pu'));
  assert.equal(model.exportLatex(),'\\textnormal{a\\_b \\% c}+\\ce{2 H2 + O2 -> 2 H2O}+\\pu{1.2 kg m/s^2}');
  for(const source of ['\\text{--}+\\frac{a}{b}','\\textnormal{a_b}+\\sqrt{x}','\\textnormal{$x$}+\\frac{a}{b}']){
    const mixed=verify(source);assert.equal(raw(mixed).length,1);assert.equal(mixed.exportLatex(),source);
  }
});

test('the reported textnormal double hyphen converts into editable descriptive text',()=>{
  for(const source of ['\\textnormal{--}','n=3\\textnormal{--}5']){
    const model=verify(source);assert.deepEqual(raw(model),[]);
    const text=allNodes(model).find(node=>node.type==='text-normal');assert.ok(text);
    assert.deepEqual(text.regions[0].items,['-','-']);assert.equal(model.exportLatex(),source);
    model.setCursor(text.regions[0].id,2,0);model.replace(...model.range,'to');
    assert.equal(model.exportLatex(),source.replace('\\textnormal{--}','\\textnormal{to}'));
  }
});

test('physics only consumes explicit braced arguments and never steals a following operator',()=>{
  const valid=verify('\\dv{x}{t}+\\ketbra{\\varphi_i}{\\varphi_j}');
  assert.deepEqual(raw(valid),[]);assert.ok(types(valid).includes('physics-dv'));assert.ok(types(valid).includes('physics-ketbra'));
  for(const source of ['\\dd x+\\sqrt{y}']){
    const model=verify(source);assert.equal(model.exportLatex(),source);assert.equal(raw(model).length,1,source);
    assert.equal(types(model).includes('physics-dv'),false);assert.equal(types(model).includes('physics-pdv'),false);
  }
  for(const source of ['\\dv{x}+\\frac{a}{b}','\\pdv{x}+y','\\ketbra{x}+y','\\dv[2]{x}{t}+\\frac{a}{b}','\\dv*{x}{t}+\\sqrt{y}']){
    const model=verify(source);assert.equal(model.exportLatex(),source);assert.equal(raw(model).length,0,source);
    assert.equal(model.root.items[1],'+','The following operator remains in its original sequence');
  }
});

test('annotation argument roles stay correct when their bodies need mixed conversion',()=>{
  const model=verify('\\overset{a}{\\mathbf{x+\\alpha}}+\\cancelto{0}{\\text{x}}+\\prescript{A}{Z}{\\mathcal{J}}');
  assert.equal(model.root.items[0].type,'overset');assert.equal(model.root.items[0].regions[0].items[0].type,'source-tex');assert.deepEqual(model.root.items[0].regions[1].items,['a']);
  assert.equal(model.root.items[2].type,'cancelto');assert.deepEqual(model.root.items[2].regions[1].items,['0']);
  assert.equal(model.root.items[4].type,'prescript');assert.equal(model.root.items[4].regions[0].items[0].type,'symbol-letter-J--symcal');
});

test('standalone TeX groups retain their boundary without multiplying script groups on reconversion',()=>{
  assert.equal(verify('{a+b}c').exportLatex(),'{a+b}c');
  for(const source of ['{ab}^2','{{ab}}^2','\\mathrm{eq}_i','{\\mathcal{J}}^2']){
    const canonical=verify(source).exportLatex();assert.equal(verify(canonical).exportLatex(),canonical,source);
  }
  const infix=verify('\\frac{x\\over y}{z}');assert.deepEqual(raw(infix),['x\\over y']);assert.equal(infix.exportLatex(),'\\frac{x\\over y}{z}');
});

test('postfix primes belong to their base and combine safely with an opposite script',()=>{
  const model=verify('\\sum_{\\alpha\'\'=1}^{n}x_i+\\mathbf{q}\'');
  assert.deepEqual(raw(model),[]);assert.equal(types(model).filter(type=>type==='symbol-prime').length,3);
  const sum=model.root.items[0];assert.equal(sum.type,'sum');assert.equal(sum.operatorLayout,true);
  const alphaPower=sum.regions.find(region=>region.slot==='lower').items[0];assert.equal(alphaPower.type,'power');assert.equal(alphaPower.regions[1].items.length,2);
  for(const source of ["x^2'",'x_i_j','x^2^3'])assert.equal(verify(source).exportLatex(),source);
});

test('function and operator scripts retain their TeX class and placement',()=>{
  for(const [source,expected] of [['\\sin^2 x+\\sqrt{y}','\\sin^{2} x+\\sqrt{y}'],['\\operatorname{Tr}_{b} x','\\operatorname{Tr}_{b} x']]){
    const model=verify(source);assert.equal(model.exportLatex(),expected);assert.equal(raw(model).length,0);
  }
  const preserved='\\sum\\displaylimits_i^n x';assert.equal(verify(preserved).exportLatex(),preserved);assert.equal(raw(verify(preserved)).length,1);
  const native=verify('\\sum\\limits_i^n x+\\int\\nolimits_0^1 y');assert.deepEqual(raw(native),[]);
  assert.equal(native.exportLatex(),'\\sum\\limits_{i}^{n} x+\\int\\nolimits_{0}^{1} y');
});

test('comments and verbatim contents preserve their line and token boundaries',()=>{
  const source='a% keep ^ and _ untouched\r\nb+\\sqrt{x}',model=verify(source);
  assert.equal(model.exportLatex(),source);assert.deepEqual(raw(model),['% keep ^ and _ untouched\r\n']);assert.ok(types(model).includes('sqrt'));
  const verbatim=verify('\\verb|x^2_{foo}|+\\sqrt{y}');assert.deepEqual(raw(verbatim),['\\verb|x^2_{foo}|']);assert.ok(types(verbatim).includes('sqrt'));assert.equal(verbatim.exportLatex(),'\\verb|x^2_{foo}|+\\sqrt{y}');
});

test('environments and automatic fences convert their editable cells recursively',()=>{
  const source='\\begin{aligned}\\hat{H}_{\\mathrm{s}}&=\\frac{a}{\\sqrt{b}}\\\\x_i&=\\operatorname{Tr}_{b}y\\end{aligned}+\\left(\\mathcal{J}+z\\right)';
  const model=verify(source),aligned=model.root.items[0];assert.equal(aligned.type,'aligned');assert.equal(aligned.rows,2);assert.equal(aligned.columns,2);assert.equal(aligned.regions.length,4);
  assert.ok(types(model).includes('frac'));assert.ok(types(model).includes('sqrt'));assert.ok(types(model).includes('parens'));assert.deepEqual(raw(model),[]);
  const unsupported=verify('\\begin{unknown}a&b\\end{unknown}+\\sqrt{x}');assert.deepEqual(raw(unsupported),['\\begin{unknown}a&b\\end{unknown}']);assert.ok(types(unsupported).includes('sqrt'));
});

test('malformed source always remains saveable and retains its unsupported remainder',()=>{
  for(const source of ['\\frac{a}{','\\sqrt[3','a+\\','x^{','\\begin{aligned}a&b','a+{x','a+$x$']){
    const model=verify(source);assert.ok(raw(model).length,source);assert.equal(model.exportLatex(),source);
  }
});

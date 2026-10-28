const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const vm=require('node:vm');
const module_={exports:{}};
vm.runInNewContext(buildSync({entryPoints:['src/tex-import.ts'],bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text,{module:module_,exports:module_.exports});
const {importMath,normalizeMathSource}=module_.exports;
const exported=source=>{const model=importMath(source);assert.ok(model,'Expected supported TeX: '+source);return model.exportLatex();};
const shape=item=>typeof item==='string'?item:{type:item.type,regions:item.regions.map(region=>Array.from(region.items,shape)),...(item.operatorLayout?{operatorLayout:true}:{}),...(item.atom?{atom:true}:{})};

test('complete TeX paste consumes one token per unbraced script, independently of typing rules',()=>{
  assert.equal(exported('x^2+y'),'{x}^{2}+y');
  assert.equal(exported('e^N_bead'),'{e}_{b}^{N}ead');
  assert.equal(exported('e^{N_{bead}}'),'{e}^{{N}_{bead}}');
  assert.equal(exported('x_i^2'),'{x}_{i}^{2}');
  assert.equal(exported('x^2_i'),'{x}_{i}^{2}');
  assert.equal(exported('{ab}^{12}'),'{ab}^{12}');
});

test('annotation commands map TeX argument roles instead of visual slot order',()=>{
  const cases=[
    ['\\overset{a}{b}','overset',['b','a']],
    ['\\underset{a}{b}','underset',['b','a']],
    ['\\cancelto{0}{x}','cancelto',['x','0']],
    ['\\prescript{A}{Z}{X}','prescript',['X','A','Z']]
  ];
  for(const [source,type,args] of cases){
    const model=importMath(source);assert.ok(model);
    assert.equal(model.root.items[0].type,type);
    assert.deepEqual(Array.from(model.root.items[0].regions,r=>r.items.join('')),args);
    assert.equal(model.exportLatex(),source);
  }
});

test('explicit fraction, root and accent syntax round trips without an argument swap',()=>{
  for(const source of [
    '\\frac{a}{b}','\\dfrac{a+b}{c}','\\tfrac{a}{b}',
    '\\binom{n}{k}','\\dbinom{n}{k}','\\tbinom{n}{k}',
    '\\cfrac{a}{b}','\\cfrac[l]{a}{b}','\\cfrac[r]{a}{b}',
    '\\splitfrac{a}{b}','\\splitdfrac{a}{b}',
    '\\sqrt{x+1}','\\sqrt[3]{x+1}','\\hat{x}','\\vec{x}',
    '\\frac{\\sqrt[3]{x+1}}{a+\\frac{b}{c}}+\\sin x^2',
    '\\overset{\\hat{x}}{\\frac{a}{b}}',
    '\\prescript{}{Z}{X}'
  ]){
    const canonical=exported(source);
    assert.equal(exported(canonical),canonical,'Canonical source changed: '+source);
  }
});

test('bare macro arguments are single TeX tokens, not recursively consumed commands',()=>{
  assert.equal(exported('\\frac12'),'\\frac{1}{2}');
  assert.equal(exported('\\sqrt x'),'\\sqrt{x}');
  assert.equal(exported('\\hat\\alpha'),'\\hat{\\alpha }');
  assert.equal(exported('x^\\alpha'),'{x}^{\\alpha }');
  for(const source of ['\\frac\\sqrt{x}{y}','\\hat\\frac{a}{b}','x^\\frac12','x^\\sqrt y'])assert.equal(importMath(source),null,source);
});

test('large operators retain operator classification and default limit placement',()=>{
  for(const [source,expected] of [
    ['\\sum_{i=0}^N x_i','\\sum_{i=0}^{N} {x}_{i}'],
    ['\\sum\\limits_{i=0}^N x_i','\\sum\\limits_{i=0}^{N} {x}_{i}'],
    ['\\int\\nolimits_0^1 x','\\int\\nolimits_{0}^{1} x'],
    ['\\lim_{x\\rightarrow0} f(x)','\\lim_{x\\rightarrow 0} f(x)']
  ]){
    const model=importMath(source);assert.ok(model,source);
    assert.equal(model.root.items[0].operatorLayout,true);
    assert.equal(model.exportLatex(),expected);
    assert.equal(exported(expected),expected);
  }
});

test('escaped math literals survive without becoming comments, groups, or alignment',()=>{
  for(const source of ['a\\%+b','\\{x\\}','\\#\\$\\&\\_','a\\ b']){
    const canonical=exported(source);
    assert.equal(exported(canonical),canonical,source);
  }
  const unicode=importMath('𝛼+𝑥');assert.ok(unicode);
  assert.equal(unicode.root.items.length,3);
  assert.equal(unicode.exportLatex(),'𝛼+𝑥');
});

test('unsupported syntax aborts the entire conversion, including deeply nested occurrences',()=>{
  for(const source of [
    '\\unknown{x}','\\constructor{x}','\\toString{x}',
    '\\frac{x}','\\frac{x}{y', 'x^{','x^','x__2','x^^2','x^2^3','x_i_j',
    'a%comment\nb','a&b','a#b','a~b',"x'",'\\,x','x\\!y','\\\\',
    '$x$','$$x$$','\\(x\\)','\\[x\\]',
    '\\frac{a}{\\unknown{x}}+b','\\sqrt{a+\\hat{\\unknown{x}}}',
    '\\begin{matrix}a&b\\end{matrix}',
    '\\mathbf{ab}','\\symbf{\\alpha}','\\textnormal{hello world}','\\ce{H2O}','\\dv{x}{t}',
    '\\left(x\\right)','\\operatorname{rank}x','\\sqrt*{x}','\\cfrac[c]{a}{b}',
    '\\genfrac{(}{)}{0pt}{}{n}{k}',
    '\\overbrace{x}^{n}','\\underbrace{x}_{n}','\\xrightarrow[b]{a}',
    '\\sum\\displaylimits_i x', '\\sin^2 x','\\leq_i',
    '\\div{x}','{a+b}','a+{b+c}','\\frac{{a+b}}{c}',
    '{\\alpha}x','{a}{b}^2'
  ])assert.equal(importMath(source),null,'Must preserve complete source: '+source);
});

test('refused conversion never leaks a partial model and does not affect later conversions',()=>{
  const expected=exported('\\frac{a}{b}+x^2');
  for(const source of ['a+\\unknown{x}+b','\\frac{a}{\\unknown{x}}','a\\frac{b}{c}^2^3']){
    assert.equal(importMath(source),null);
    assert.equal(exported('\\frac{a}{b}+x^2'),expected);
  }
});

test('supported nested structures keep their tree through canonical TeX round trips',()=>{
  const source='\\prescript{A}{Z}{X}+\\overset{a}{\\frac{\\sqrt[3]{x}}{y_i}}+\\sum_{n=0}^{N}{x}^{n}';
  const first=importMath(source);assert.ok(first);
  const second=importMath(first.exportLatex());assert.ok(second);
  assert.deepEqual(Array.from(first.root.items,shape),Array.from(second.root.items,shape));
});

test('math framing is removed only when matched and keeps inner whitespace intact',()=>{
  for(const [source,body,display] of [
    [' x^2 ',' x^2 ',false],['$ x^2 $',' x^2 ',false],['  $$ x^2 $$\n',' x^2 ',true],
    ['\\( x^2 \\)',' x^2 ',false],['\\[ x^2 \\]',' x^2 ',true],['$x\\$$','x\\$',false],['$$$$','',true]
  ]){
    const normalized=normalizeMathSource(source);assert.ok(normalized,source);
    assert.equal(normalized.source,body);assert.equal(normalized.display,display);
  }
  for(const source of ['$x','x$','$$x$','$x$$','$x$y$','$x\\$','\\(x\\]','\\[x\\)','\\)x','x\\]','\\(x\\)+\\(y\\)','\\[x\\]+\\[y\\]'])assert.equal(normalizeMathSource(source),null,source);
});

test('deep unsupported input stops safely instead of overflowing recursion',()=>{
  assert.equal(importMath('\\sqrt{'.repeat(200)+'x'+'}'.repeat(200)),null);
  assert.equal(exported(''),'');
});

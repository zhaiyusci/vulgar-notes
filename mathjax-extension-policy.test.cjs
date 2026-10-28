const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const Module=require('node:module');
const vm=require('node:vm');
const {buildSync}=require('esbuild');
const loaded=new Module(path.join(process.cwd(),'mathjax-extension-policy-test.cjs'),module);loaded.paths=module.paths;
loaded._compile(buildSync({stdin:{contents:"export * from './src/mathjax-extension-policy';export {installUnicodeFonts} from './src/mathjax-unicode-fonts';",loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text,loaded.id);
const policy=loaded.exports;
const sandbox={window:{localStorage:{getItem(){return null;}}},document:{documentElement:{dataset:{},classList:{toggle(){}}}}};
vm.runInNewContext(buildSync({entryPoints:['src/mathjax-config.ts'],bundle:true,write:false,format:'iife',platform:'browser'}).outputFiles[0].text,sandbox);
const app=sandbox.window.MathJax,plain=value=>JSON.parse(JSON.stringify(value)),packageName=value=>typeof value==='string'?value:value[0];

test('all installed MathJax extensions have an explicit coverage or exclusion decision',()=>{
  const installed=fs.readdirSync('node_modules/mathjax/input/tex/extensions').filter(file=>file.endsWith('.js')).map(file=>file.slice(0,-3)).sort();
  assert.equal(installed.length,41,'Review the policy when the bundled MathJax extension set changes');
  assert.deepEqual(policy.mathJaxExtensionPolicy.map(entry=>entry.name).sort(),installed);
  assert.equal(new Set(policy.mathJaxExtensionPolicy.map(entry=>entry.name)).size,installed.length);
  assert.ok(policy.mathJaxExtensionPolicy.every(entry=>entry.reason.length>20));
  assert.equal(policy.mathJaxExtensionPolicy.filter(entry=>entry.state==='enabled').length,22);
  assert.equal(policy.mathJaxExtensionPolicy.filter(entry=>entry.state==='bundled').length,5);
  assert.equal(policy.mathJaxExtensionPolicy.filter(entry=>entry.state==='excluded').length,14);
  for(const name of ['action','amscd','bussproofs','begingroup'])assert.match(policy.mathJaxExtensionPolicy.find(entry=>entry.name===name).reason,/user excluded/i);
});

test('the actual configuration loads all selected packages and prevents autoload policy bypass',()=>{
  const enabled=policy.mathJaxExtensionPolicy.filter(entry=>entry.state==='enabled').map(entry=>entry.name).sort();
  assert.deepEqual(Array.from(app.loader.load).map(name=>name.slice('[tex]/'.length)).sort(),enabled);
  assert.deepEqual(Array.from(app.tex.packages['[+]']).map(packageName).sort(),enabled);
  assert.deepEqual(Array.from(app.tex.packages['[-]']).sort(),policy.mathJaxExtensionPolicy.filter(entry=>entry.state==='excluded').map(entry=>entry.name).sort());
  assert.equal(app.tex.require.defaultAllow,false);assert.equal(app.tex.require.allow.unknown_future_extension,undefined);
  for(const entry of policy.mathJaxExtensionPolicy)assert.equal(app.tex.require.allow[entry.name],entry.state!=='excluded',entry.name);
  assert.deepEqual(plain(app.tex.packages['[+]'].find(entry=>packageName(entry)==='physics')),['physics',2]);
  assert.equal(packageName(app.tex.packages['[+]'].at(-1)),'bboldx');
});

test('the complete selected package set starts locally and preserves conflicting notation',async t=>{
  const url=folder=>pathToFileURL(path.resolve(folder)).href;
  const runtime=await require('mathjax').init({
    loader:{paths:{mathjax:url('node_modules/mathjax'),fonts:url('node_modules/@mathjax'),'mathjax-bboldx-extension':url('node_modules/@mathjax/mathjax-bboldx-font-extension')},load:['input/tex','output/chtml',...Array.from(app.loader.load)]},
    tex:plain(app.tex),
    startup:{typeset:false,output:'chtml',ready(){policy.installUnicodeFonts(globalThis.MathJax._);globalThis.MathJax.startup.defaultReady();}}
  });
  assert.ok(runtime,'All selected components must load from the installed packages without network assets');
  const configured=runtime.startup.document.inputJax[0].parseOptions.options.packages.map(packageName);
  for(const entry of policy.mathJaxExtensionPolicy)assert.equal(configured.includes(entry.name),entry.state!=='excluded',entry.name);
  const mml=source=>{const output=runtime.tex2mml(source);assert.doesNotMatch(output,/<merror\b/,source+'\n'+output);return output;};
  const samples={
    bbox:String.raw`\bbox[red]{x}`,
    boldsymbol:String.raw`\boldsymbol{\sigma}`,
    braket:String.raw`\Braket{a|b}`,
    cancel:String.raw`\cancel{x}`,
    cases:String.raw`\begin{numcases}{f(x)=}x&positive\\-x&negative\end{numcases}`,
    centernot:String.raw`\centernot{=}`,
    color:String.raw`\textcolor{red}{x}`,
    colortbl:String.raw`\begin{array}{cc}\rowcolor{red}a&b\end{array}`,
    empheq:String.raw`\begin{empheq}[left=\empheqlbrace]{align}a&=b\\c&=d\end{empheq}`,
    enclose:String.raw`\enclose{circle}{x}`,
    extpfeil:String.raw`\xtwoheadrightarrow{a}`,
    gensymb:String.raw`\degree+\ohm+\micro`,
    html:String.raw`\class{vn-test}{x}`,
    mathtools:String.raw`\prescript{a}{b}{x}`,
    mhchem:String.raw`\ce{H2O}`,
    textcomp:String.raw`\textnormal{\textendash\textemdash}`,
    unicode:String.raw`\unicode{x03B1}`,
    units:String.raw`\unitfrac{m}{s}`,
    upgreek:String.raw`\upalpha`,
    verb:String.raw`\verb|x_^|`,
    physics:String.raw`\dv{x}{t}`,
    bboldx:String.raw`\bbalpha`
  };
  assert.deepEqual(Object.keys(samples).sort(),policy.mathJaxExtensionPolicy.filter(entry=>entry.state==='enabled').map(entry=>entry.name).sort());
  for(const [name,source] of Object.entries(samples))await t.test(name,()=>{mml(source);});
  await t.test('physics wins shared lowercase names while capitalized braket forms remain available',async()=>{
    const physics=mml(String.raw`\braket{a}{b}`);assert.match(physics,/data-latex="\\middle\\vert"/,'The second argument belongs inside the physics inner product');
    assert.match(mml(String.raw`\Braket{a|b}`),/data-braketbar="true"/);mml(String.raw`\Bra{a}+\Ket{b}+\Set{x|x>0}`);
    const reloaded=await runtime.tex2mmlPromise(String.raw`\require{physics}\braket{a}{b}`);assert.doesNotMatch(reloaded,/<merror\b/);assert.match(reloaded,/data-latex="\\middle\\vert"/,'Explicit require must not change the selected precedence');
    assert.match(mml(String.raw`\ketbra{a}{b}`),/data-latex="\\left\\vert"/,'Keep physics automatic sizing for shared ketbra');
  });
  await t.test('unit packages and text symbols retain distinct atom semantics',()=>{
    const units=mml(String.raw`\degree+\textdegree+\units{m}+\unitfrac{m}{s}`);
    assert.match(units,/<mi[^>]*class="MathML-Unit"/);assert.match(units,/<mtext[^>]*data-latex="\\textdegree"/);assert.match(units,/<mfrac bevelled="true"/);
  });
  await t.test('the selected BBoldX alphabet and upright Greek remain unchanged',()=>{
    assert.match(mml(String.raw`\mathbb{R}`),/data-mjx-variant="-bboldx"/);assert.match(mml(String.raw`\bbalpha`),/data-mjx-variant="-bboldx"/);
    assert.match(mml(String.raw`\upalpha`),/mathvariant="normal"/);
  });
  await t.test('native cases tag numbering retains subcase letters and the following counter',()=>{
    runtime.texReset(0);
    const sub=mml(String.raw`\begin{subnumcases}{f=}a&first\\b&second\label{last-sub}\end{subnumcases}`);
    assert.match(sub,/>1a<\/mtext>/);assert.match(sub,/>1b<\/mtext>/);
    assert.equal(runtime.startup.document.inputJax[0].parseOptions.tags.allLabels['last-sub'].tag,'1b');
    assert.match(mml(String.raw`\begin{equation}x=0\end{equation}`),/>2<\/mtext>/);
  });
  await t.test('excluded packages cannot be reenabled by document require commands',async()=>{
    for(const name of policy.mathJaxDisabledTexPackages){const output=await runtime.tex2mmlPromise('\\require{'+name+'}x');assert.match(output,/<merror\b/,name);assert.match(output,/not allowed to be loaded/,name);}
    const unknown=await runtime.tex2mmlPromise(String.raw`\require{unknown_future_extension}x`);assert.match(unknown,/not allowed to be loaded/);
  });
  await t.test('undefined commands still produce real parser errors',()=>{
    assert.match(runtime.tex2mml(String.raw`\futureundefined{x}`),/<merror\b/);
  });
});

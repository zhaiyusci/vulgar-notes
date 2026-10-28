const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {spawnSync}=require('node:child_process');
const {buildSync}=require('esbuild');
const compiled=new Module(path.resolve('.mathjax-latex-packages-test.cjs'),module);compiled.paths=module.paths;
compiled._compile(buildSync({stdin:{contents:"export * from './src/mathjax-latex-packages';export {unicodeMathPreamble} from './src/letter-preamble';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,path.resolve('.mathjax-latex-packages-test.cjs'));
const api=compiled.exports;

test('export adaptations use proven units, fraction and upright Greek semantics',()=>{
  assert.equal(api.adaptMathJaxLatex(String.raw`\units[2]{m}+\unitfrac{m}{s}+\nicefrac{a}{b}`),String.raw`\unit[2]{m}+\unitfrac{m}{s}+\nicefrac[\mathrm]{a}{b}`);
  assert.equal(api.adaptMathJaxLatex(String.raw`\nicefrac[\mathit]{a}{b}`),String.raw`\nicefrac[\mathit]{a}{b}`);
  assert.equal(api.adaptMathJaxLatex(String.raw`\upalpha+\upvarrho+\upvarsigma+\upomicron+\Upgamma`),String.raw`\mathrm{\alpha}+\mathrm{\varrho}+\mathrm{\varsigma}+\mathrm{\omicron}+\mathrm{\Gamma}`);
});
test('text, verbatim, comments and user-defined scopes are preserved',()=>{
  assert.equal(api.adaptMathJaxLatex(String.raw`\textnormal{\upalpha}\upbeta`),String.raw`\textnormal{\upalpha}\mathrm{\beta}`);
  assert.equal(api.adaptMathJaxLatex(String.raw`\verb|\units{m}|+\upalpha`),String.raw`\verb|\units{m}|+\mathrm{\alpha}`);
  const definition=String.raw`\newcommand{\example}{\units{m}}\units[2]{m}`;assert.equal(api.adaptMathJaxLatex(definition),definition);
  const opaque=String.raw`\unknown{\upalpha}+\units{m}`;assert.equal(api.adaptMathJaxLatex(opaque),opaque);
  assert.equal(api.adaptMathJaxLatex('% \\units{m}\n\\upalpha'),'% \\units{m}\n\\mathrm{\\alpha}');
});
test('optional real TeX packages are detected and ordered before extarrows and unicode-math',()=>{
  const sources=[String.raw`\begin{numcases}{f(x)=}x&x>0\end{numcases}`,String.raw`\begin{empheq}{align}x&=y\end{empheq}`,String.raw`\centernot{=}`,String.raw`\rowcolor{red}\cellcolor{blue}`,String.raw`\micro+\upalpha+\units{m}+\nicefrac{a}{b}`,String.raw`\xtwoheadrightarrow{x}`];
  const requirements=api.analyzeMathJaxLatex(sources);assert.deepEqual(requirements.packages,['textcomp','gensymb','xcolor','colortbl','cases','empheq','centernot','units','extpfeil']);assert.deepEqual(requirements.issues,[]);
  assert.equal(api.optionalMathPackages(sources),requirements.preamble);assert.equal(requirements.packages.includes('upgreek'),false,'upright Greek is exported through the selected unicode-math alphabet');assert.equal(api.optionalMathPackages(['x+y']),'');
});
test('MathJax-only commands are reported specifically without fake same-name packages or rejecting unknown macros',()=>{
  const result=api.analyzeMathJaxLatex([String.raw`\bbox[red]{x}+\enclose{circle}{y}+\unicode{x221E}`]);
  assert.deepEqual(result.issues.map(issue=>issue.command),['bbox','enclose','unicode']);assert.ok(result.issues.every(issue=>issue.reason&&issue.suggestion));assert.equal(result.preamble,'');
  assert.deepEqual(api.analyzeMathJaxLatex([String.raw`\custom{x}`]).issues,[]);assert.deepEqual(api.analyzeMathJaxLatex([String.raw`\verb|\bbox{a}| % \enclose{box}{x}`]).issues,[]);
  assert.deepEqual(api.analyzeMathJaxLatex([String.raw`\newcommand{\bbox}[1]{\boxed{#1}}\bbox{x}`]).issues,[],'a user-provided real TeX definition is not a MathJax-only primitive');
  assert.deepEqual(api.analyzeMathJaxLatex([String.raw`\textnormal{\textendash}\textnormal{\textemdash}`]).packages,['textcomp']);
});
test('the generated optional preamble and adaptations compile with actual TeX Live when available',t=>{
  if(spawnSync('lualatex',['--version'],{encoding:'utf8'}).status!==0){t.skip('LuaLaTeX is not installed on this runner');return;}
  const body=String.raw`
$\centernot{\equiv}\quad20\degree\quad\celsius\quad\micro\quad\ohm\quad\perthousand$

$\units[2]{m}\quad\unitfrac[3]{m}{s}\quad\nicefrac{a}{b}\quad\upalpha+\upvarrho+\upvarsigma+\upomicron+\Upgamma$

\begin{numcases}{f(x)=}x & if positive\\-x & otherwise\end{numcases}
\begin{empheq}[box=\fbox]{align}x&=y\end{empheq}
$\begin{array}{cc}\rowcolor{red!10}a&b\\c&\cellcolor{blue!10}d\end{array}$
$\xtwoheadrightarrow[a]{b}\quad\xtofrom{x}$
`;
  const requirements=api.analyzeMathJaxLatex([body]);assert.deepEqual(requirements.issues,[]);
  const source='\\documentclass{article}\n\\usepackage{mathtools}\n\\usepackage{amssymb}\n'+requirements.preamble+'\\usepackage{extarrows}\n\\usepackage{cancel}\n'+api.unicodeMathPreamble+'\\setmathfont{NewCMMath-Regular.otf}\n\\usepackage{physics}\n\\begin{document}\n'+api.adaptMathJaxLatex(body)+'\n\\end{document}\n';
  const parent=path.resolve('tmp/mathjax-latex-packages-tests');fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'compile-')),cache=path.join(parent,'tex-cache');fs.mkdirSync(cache,{recursive:true});fs.writeFileSync(path.join(directory,'sample.tex'),source);
  const compile=spawnSync('lualatex',['-interaction=nonstopmode','-halt-on-error','sample.tex'],{cwd:directory,encoding:'utf8',timeout:120000,env:{...process.env,TEXMFVAR:cache,TEXMFCACHE:cache,TEXMFCONFIG:path.join(cache,'config')}});
  assert.equal(compile.status,0,(compile.stdout+compile.stderr).slice(-5000));assert.ok(fs.existsSync(path.join(directory,'sample.pdf')));
});

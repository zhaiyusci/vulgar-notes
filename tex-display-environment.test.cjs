const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {buildSync}=require('esbuild');

const bundle=buildSync({stdin:{contents:"export * from './src/tex-display-environment';export {latexDocument} from './src/latex-document';export {convertMath} from './src/tex-convert';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const moduleObject={exports:{}};new Function('require','module','exports',bundle)(require,moduleObject,moduleObject.exports);const api=moduleObject.exports;

test('complete environments that enter display math are recognized without wrapping inner structures',()=>{
  const names=['equation','equation*','align','align*','alignat','alignat*','flalign','flalign*','gather','gather*','multline','multline*','eqnarray','eqnarray*','xalignat','xalignat*','xxalignat','displaymath','numcases','subnumcases','empheq'];
  for(const name of names)assert.equal(api.standaloneMathEnvironment(`\\begin{${name}}x\\end{${name}}`),true,name);
  for(const name of ['aligned','alignedat','gathered','lgathered','rgathered','multlined','cases','dcases','matrix','pmatrix','split','array','spreadlines','indentalign','math'])assert.equal(api.standaloneMathEnvironment(`\\begin{${name}}x\\end{${name}}`),false,name);
  assert.equal(api.standaloneMathEnvironmentBounds(String.raw`\begin{equation*}x\end{equation*}`).numbered,false);
  assert.equal(api.standaloneMathEnvironmentBounds(String.raw`\begin{numcases}{f=}x&x>0\end{numcases}`).numbered,true);
  assert.equal(api.standaloneMathEnvironmentBounds(String.raw`\begin{empheq}{align*}x&=y\end{empheq}`).numbered,undefined);
});

test('original offsets retain comments, nested environments, escapes and label insertion positions',()=>{
  const source='% before \\end{align}\n \\begin{align}\n x&=\\textnormal{\\{a\\%b\\}}+\\begin{aligned}a&=b\\\\c&=d\\end{aligned} % \\end{align}\n\\end{align}\n% after\n';
  const bounds=api.standaloneMathEnvironmentBounds(source);assert.ok(bounds);assert.equal(bounds.name,'align');
  assert.equal(source.slice(bounds.start,bounds.bodyStart),String.raw`\begin{align}`);
  assert.equal(source.slice(bounds.bodyEnd,bounds.end),String.raw`\end{align}`);
  const labelled=source.slice(0,bounds.bodyEnd)+'\\label{eq:aligned}\n'+source.slice(bounds.bodyEnd);
  assert.equal(api.standaloneMathEnvironment(labelled),true);assert.ok(labelled.indexOf('\\label{eq:aligned}')<labelled.lastIndexOf('\\end{align}'));
  assert.equal(api.standaloneMathEnvironment('% before\r\\begin{equation}x% body\r\\end{equation}% after'),true,'TeX comments also end at a carriage return');
  const commentedTags='\\begin{equat% } ignored\nion}x\\end{equat% { ignored\r\nion}';
  assert.equal(api.standaloneMathEnvironment(commentedTags),true,'comments in literal environment-name arguments follow TeX tokenization');
});

test('prefixes, tails, multiple environments, malformed nesting and verbatim syntax are not guessed',()=>{
  const environment=String.raw`\begin{equation}x\end{equation}`;
  for(const source of ['x+'+environment,environment+'+x',environment+environment,'{'+environment+'}','\\('+environment+'\\)','$'+environment+'$',String.raw`\begin{equation}{x\end{equation}`,String.raw`\begin{align}\begin{aligned}x\end{align}\end{aligned}`,String.raw`\begin{equation}x\end{align}`,String.raw`\begin{equation}\verb|\end{equation}|\end{equation}`,String.raw`\begin{equation}\catcode\%=12 x\end{equation}`])assert.equal(api.standaloneMathEnvironment(source),false,source);
});

const casesSource=name=>String.raw`\begin{numcases}{`+name+String.raw`(x)=}
x & x>0\\
-x & x\le0
\end{numcases}`;
const formula=(id,source,display,extra={})=>({type:'inline_equation',id,texExpression:source,display,numbered:true,texLabel:'eq:'+id,...extra,children:[{text:''}]});
const paragraph=children=>({type:'p',children});

test('the real document exporter keeps standalone numcases outside inline and equation wrappers',()=>{
  for(const display of [false,true])for(const snapshot of [false,true]){
    const source=casesSource('f'),extra=snapshot?{snapshot:api.convertMath(source).snapshot()}:{},node=formula('cases-'+display+'-'+snapshot,source,display,extra),before=JSON.stringify(node);
    const latex=api.latexDocument([paragraph([{text:'Before. '},node,{text:' After.'}])]);
    const body=latex.slice(latex.indexOf('\\begin{document}')+'\\begin{document}'.length,latex.lastIndexOf('\\end{document}'));
    assert.equal((body.match(/\\begin\{numcases\}/g)||[]).length,1);
    assert.doesNotMatch(body,/\\begin\{equation\*?\}|\\end\{equation\*?\}|\\\(|\\\)/,'the self-contained display must not be wrapped a second time');
    assert.match(body,new RegExp('\\\\label\\{eq:cases-'+display+'-'+snapshot+'\\}'));
    assert.ok(body.indexOf('\\label{')>body.indexOf('\\begin{numcases}'));assert.ok(body.indexOf('\\label{')<body.indexOf('\\end{numcases}'));
    assert.equal(JSON.stringify(node),before,'export does not mutate display flags, snapshots or source');
  }
});

test('real complete exported documents compile standalone cases from both formula layouts with TeX Live',t=>{
  if(spawnSync('lualatex',['--version'],{encoding:'utf8'}).status!==0){t.skip('LuaLaTeX is not installed on this runner');return;}
  const parent=path.resolve('tmp/tex-display-environment-tests');fs.mkdirSync(parent,{recursive:true});const cache=path.resolve('tmp/mathjax-latex-packages-tests/tex-cache');fs.mkdirSync(cache,{recursive:true});
  for(const display of [false,true]){
    const value=[paragraph([{text:'Before cases. '},formula(display?'display-cases':'inline-cases',casesSource(display?'g':'f'),display),{text:' After cases.'}])],latex=api.latexDocument(value);
    assert.match(latex,/\\usepackage\{cases\}/);
    const directory=fs.mkdtempSync(path.join(parent,display?'display-':'inline-'));fs.writeFileSync(path.join(directory,'sample.tex'),latex);
    const result=spawnSync('lualatex',['-interaction=nonstopmode','-halt-on-error','sample.tex'],{cwd:directory,encoding:'utf8',timeout:120000,env:{...process.env,TEXMFVAR:cache,TEXMFCACHE:cache,TEXMFCONFIG:path.join(cache,'config')}});
    assert.equal(result.status,0,(result.stdout+result.stderr).slice(-6000));assert.ok(fs.existsSync(path.join(directory,'sample.pdf')));
  }
});

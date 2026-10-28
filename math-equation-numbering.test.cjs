const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const Module=require('node:module');
const {buildSync}=require('esbuild');
const loaded=new Module(path.join(process.cwd(),'math-equation-numbering-test.cjs'),module);loaded.paths=module.paths;
loaded._compile(buildSync({stdin:{contents:"export * from './src/math-equation-numbering';export * from './src/mathjax-extension-policy';export {referenceTargets} from './src/references';",loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text,loaded.id);
const {equationNumbering}=loaded.exports;
const expected=(count,referenceOffset=0,referenceSuffix='')=>({count,referenceOffset,referenceSuffix});
const cases=(name,rows,lhs='f=')=>'\\begin{'+name+'}{'+lhs+'}'+rows+'\\end{'+name+'}';

test('numbered cases consume one number per row and the document label targets the last row',()=>{
  assert.deepEqual(equationNumbering(cases('numcases',String.raw`a&positive\\b&negative\\c&zero`)),expected(3,2));
  assert.deepEqual(equationNumbering(cases('numcases',String.raw`a&positive\\b&negative\\`)),expected(2,1));
  assert.deepEqual(equationNumbering(cases('numcases',String.raw`a&positive\\b&negative\\\label{last}`)),expected(3,2));
  assert.deepEqual(equationNumbering(cases('subnumcases',String.raw`a&positive\\b&negative\\c&zero`)),expected(1,0,'c'));
  assert.deepEqual(equationNumbering(cases('subnumcases',String.raw`a&positive`)),expected(1,0,'a'));
});

test('comments, braces, escaped symbols and nested grids do not add outer rows',()=>{
  const source=cases('numcases',String.raw`\begin{matrix}a&b\\c&d\end{matrix}&first\\\frac{a\{b}{c\}d}&second`);
  assert.deepEqual(equationNumbering(source),expected(2,1));
  const comment=cases('numcases','a&positive% \\\\ \\end{numcases}\n\\\\b&negative');
  assert.deepEqual(equationNumbering('% leading\n'+comment+'% tail\n'),expected(2,1));
  assert.deepEqual(equationNumbering(cases('numcases',String.raw`\text{a\\b}&one\\c&two`)),expected(2,1));
});

test('only complete explicit environments are inferred; manual numbering is outside scope',()=>{
  for(const source of [
    'x+1',String.raw`\begin{numcases}{f=}a\\b`,
    String.raw`\begin{numcases}{f=}a\\b\end{subnumcases}`,
    String.raw`x+\begin{numcases}{f=}a\\b\end{numcases}`,
    cases('numcases',String.raw`a\\b`)+'+x',cases('numcases',String.raw`a\tag{A}\\b`),
    cases('numcases',String.raw`a\notag\\b`),cases('numcases',String.raw`a\nonumber\\b`),
    cases('numcases',String.raw`a\\[2pt]b`),cases('numcases',String.raw`a\\*b`),
    cases('numcases',String.raw`a\\b`,String.raw`\setcounter{equation}{10}`),
    cases('numcases',String.raw`\newcommand{\row}{a\\b}\row`),
    cases('numcases',String.raw`\begin{matrix}a&b\end{pmatrix}\\c`)
  ])assert.deepEqual(equationNumbering(source),expected(1),source);
  const cached=equationNumbering(cases('numcases',String.raw`a\\b`));
  assert.equal(equationNumbering(cases('numcases',String.raw`a\\b`)),cached);
  assert.equal(Object.isFrozen(cached),true);
});

test('label offsets refer to the original final row before terminal separators and comments',()=>{
  for(const separator of ['\\\\']){
    const source='% before\r\n'+cases('numcases','a&one\\\\b&two'+separator+'% row-end\r\n')+'% after\r\n';
    const offset=loaded.exports.equationLabelInsertionOffset(source);assert.notEqual(offset,null);
    assert.equal(source.slice(offset,offset+separator.length),separator);
    assert.deepEqual(equationNumbering(source),expected(2,1));
  }
  const source=cases('subnumcases',String.raw`a&one\\b&two`);
  assert.equal(loaded.exports.equationLabelInsertionOffset(source),source.indexOf('\\end{subnumcases}'));
  assert.equal(loaded.exports.equationLabelInsertionOffset('x+y'),null);
  assert.equal(loaded.exports.equationLabelInsertionOffset(cases('numcases',String.raw`a\tag{A}\\b`)),null);
});

test('export normalization removes only one redundant final plain cases terminator',()=>{
  for(const name of ['numcases','subnumcases']){
    const source=cases(name,'a&one\\\\b&two\\\\% keep this comment\r\n   '),original=source;
    const offset=loaded.exports.equationLabelInsertionOffset(source);
    const normalized=loaded.exports.normalizeEquationTrailingRowSeparator(source);
    assert.equal(normalized,source.slice(0,offset)+source.slice(offset+2));
    assert.equal(source,original,'The editable/source document remains unchanged');
    assert.deepEqual(equationNumbering(normalized),equationNumbering(source));
    assert.match(normalized,/% keep this comment\r\n   \\end/);
  }
  for(const source of [
    String.raw`\begin{align}a&=b\\\end{align}`,cases('numcases',String.raw`a\\b`),
    cases('numcases',String.raw`a\\b\cr`),cases('numcases',String.raw`a\\b\\[2pt]`),
    cases('numcases',String.raw`a\tag{A}\\`),cases('numcases',String.raw`a\\\\`)
  ])assert.equal(loaded.exports.normalizeEquationTrailingRowSeparator(source),source);
});

test('standard display environments distinguish row numbering, single numbering and starred forms',()=>{
  for(const name of ['align','gather','alignat','flalign','eqnarray']){
    const body=(name==='alignat'?'{1}':'')+String.raw`a&=b\\c&=d`;
    assert.deepEqual(equationNumbering('\\begin{'+name+'}'+body+'\\end{'+name+'}'),expected(2,1),name);
    assert.deepEqual(equationNumbering('\\begin{'+name+'*}'+body+'\\end{'+name+'*}'),expected(0),name+'*');
  }
  for(const name of ['equation','multline']){
    assert.deepEqual(equationNumbering('\\begin{'+name+'}a+b\\c+d\\end{'+name+'}'),expected(1));
    assert.deepEqual(equationNumbering('\\begin{'+name+'*}a+b\\c+d\\end{'+name+'*}'),expected(0));
  }
  assert.deepEqual(equationNumbering(String.raw`\begin{empheq}[left=\empheqlbrace]{align}a&=b\\c&=d\end{empheq}`),expected(2,1));
  assert.deepEqual(equationNumbering(String.raw`\begin{empheq}{gather*}a+b\\c+d\end{empheq}`),expected(0));
  assert.deepEqual(equationNumbering(String.raw`\begin{empheq}{unknown}a\\b\end{empheq}`),expected(1));
});

test('real document reference targets agree with the final cases row and do not reuse numbers',()=>{
  const formula=(id,source)=>({type:'equation',id,texExpression:source,numbered:true,texLabel:'eq:'+id,children:[{text:''}]});
  for(const [name,last,next] of [['numcases','2','3'],['subnumcases','1b','2']]){
    const document=[formula('cases',cases(name,String.raw`a&positive\\b&negative`)),formula('normal','x+1')];
    const targets=loaded.exports.referenceTargets(document).filter(target=>target.kind==='equation');
    assert.deepEqual(targets.map(target=>[target.key,target.number]),[['eq:cases',last],['eq:normal',next]],name);
  }
  for(const source of [String.raw`\begin{align*}a&=b\\c&=d\end{align*}`,String.raw`\begin{empheq}{align*}a&=b\\c&=d\end{empheq}`]){
    const targets=loaded.exports.referenceTargets([formula('starred',source),formula('normal','x')]).filter(target=>target.kind==='equation');
    assert.deepEqual(targets.map(target=>[target.key,target.number]),[['eq:normal','1']]);
  }
});

test('actual MathJax counters and labels match numbered cases before the next equation',async()=>{
  const url=folder=>pathToFileURL(path.resolve(folder)).href;
  const api=loaded.exports;
  const runtime=await require('mathjax').init({
    loader:{paths:{mathjax:url('node_modules/mathjax')},load:['input/tex',...api.mathJaxExtensionLoads.filter(name=>name!=='[tex]/bboldx')]},
    tex:{packages:{'[+]':api.mathJaxTexPackages.filter(item=>(typeof item==='string'?item:item[0])!=='bboldx'),'[-]':api.mathJaxDisabledTexPackages},tags:'cases'},startup:{typeset:false}
  });
  const tags=source=>{
    const output=runtime.tex2mml(source,{display:true});assert.doesNotMatch(output,/<merror\b/,source+'\n'+output);
    return Array.from(output.matchAll(/<mtd id="mjx-eqn:[^"]*">([\s\S]*?)<\/mtd>/g),match=>
      Array.from(match[1].matchAll(/<mtext[^>]*>([^<]*)<\/mtext>/g),text=>text[1]).join('').replace(/^\(|\)$/g,''));
  };
  for(const [name,body] of [
    ['numcases',String.raw`a&positive\\b&negative\\c&zero`],
    ['numcases',String.raw`a&positive\\b&negative\\`],
    ['subnumcases',String.raw`a&positive\\b&negative\\c&zero`]
  ]){
    const source=cases(name,body),info=equationNumbering(source);runtime.texReset(7);
    const offset=loaded.exports.equationLabelInsertionOffset(source);assert.notEqual(offset,null);
    const numbered=tags(source.slice(0,offset)+String.raw`\label{last}`+source.slice(offset));
    const reference=String(8+info.referenceOffset)+info.referenceSuffix;
    assert.equal(numbered.at(-1),reference,source);
    const label=runtime.startup.document.inputJax[0].parseOptions.tags.allLabels.last;
    assert.equal(label.tag,reference,'Document label must agree with the final environment row');
    assert.deepEqual(tags(String.raw`\begin{equation}z=0\end{equation}`),[String(8+info.count)],'The following equation must not reuse any cases number');
  }
  for(const [name,prefix,body] of [
    ['align','',String.raw`a&=b\\c&=d`],['gather','',String.raw`a+b\\c+d`],
    ['alignat','{1}',String.raw`a&=b\\c&=d`],['flalign','',String.raw`a&=b&&\\c&=d&&`],
    ['eqnarray','',String.raw`a&=&b\\c&=&d`],['multline','',String.raw`a+b\\c+d`]
  ]){
    const source='\\begin{'+name+'}'+prefix+body+'\\end{'+name+'}';runtime.texReset(0);
    assert.equal(tags(source).length,equationNumbering(source).count,name);
    assert.deepEqual(tags(String.raw`\begin{equation}z=0\end{equation}`),[String(equationNumbering(source).count+1)]);
    const star='\\begin{'+name+'*}'+prefix+body+'\\end{'+name+'*}';runtime.texReset(0);
    assert.deepEqual(tags(star),[],name+'*');assert.deepEqual(tags(String.raw`\begin{equation}z=0\end{equation}`),['1']);
  }
});

test('TeX Live aux labels agree with the inferred final row and subsequent equation numbers',{timeout:30000},t=>{
  const available=spawnSync('pdflatex',['--version'],{encoding:'utf8',windowsHide:true});
  if(available.status!==0){t.skip('This verification requires the installed TeX Live pdflatex');return;}
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vulgar-equation-numbering-'));
  t.after(()=>{
    if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('vulgar-equation-numbering-'))throw Error('Unexpected test directory');
    fs.rmSync(directory,{recursive:true,force:true});
  });
  const labelled=(original,key)=>{
    const source=loaded.exports.normalizeEquationTrailingRowSeparator(original);
    const offset=loaded.exports.equationLabelInsertionOffset(source);assert.notEqual(offset,null);
    return source.slice(0,offset)+'\\label{'+key+'}'+source.slice(offset);
  };
  const num=labelled(cases('numcases',String.raw`a&positive\\b&negative\\`),'num');
  const sub=labelled(cases('subnumcases','c&positive\\\\d&negative\\\\e&zero\\\\% terminal marker\r\n'),'sub');
  const source=String.raw`\documentclass{article}
\usepackage{amsmath,cases}
\begin{document}
\begin{equation}e=0\label{before}\end{equation}
`+num+String.raw`
\begin{equation}g=0\label{after-num}\end{equation}
`+sub+String.raw`
\begin{equation}k=0\label{after-sub}\end{equation}
\end{document}
`;
  fs.writeFileSync(path.join(directory,'numbering.tex'),source);
  const result=spawnSync('pdflatex',['-interaction=nonstopmode','-halt-on-error','-no-shell-escape','numbering.tex'],{cwd:directory,encoding:'utf8',windowsHide:true,timeout:25000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  const aux=fs.readFileSync(path.join(directory,'numbering.aux'),'utf8');
  const label=name=>new RegExp('\\\\newlabel\\{'+name+'\\}\\{\\{([^}]*)\\}').exec(aux)?.[1];
  assert.equal(label('before'),'1');
  const numInfo=equationNumbering(num),numBase=2;
  assert.equal(label('num'),String(numBase+numInfo.referenceOffset)+numInfo.referenceSuffix);
  assert.equal(label('after-num'),String(numBase+numInfo.count));
  const subInfo=equationNumbering(sub),subBase=numBase+numInfo.count+1;
  assert.equal(label('sub'),String(subBase+subInfo.referenceOffset)+subInfo.referenceSuffix);
  assert.equal(label('after-sub'),String(subBase+subInfo.count));
});

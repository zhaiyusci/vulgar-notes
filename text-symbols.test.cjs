const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const vm=require('node:vm');
const Module=require('node:module');
const {buildSync}=require('esbuild');

const loaded=new Module(path.join(process.cwd(),'text-symbols-test.cjs'),module);loaded.paths=module.paths;
loaded._compile(buildSync({entryPoints:['src/text-symbols.ts'],bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text,loaded.id);
const {textSymbols,textSymbolValue,excludedTextSymbolCommands}=loaded.exports;
const configuration={window:{localStorage:{getItem(){return null;}}},document:{documentElement:{dataset:{},classList:{toggle(){}}}}};
vm.runInNewContext(buildSync({entryPoints:['src/mathjax-config.ts'],bundle:true,write:false,format:'iife',platform:'browser'}).outputFiles[0].text,configuration);
const app=configuration.window.MathJax;

function upstreamSymbols(){
  const source=fs.readFileSync('node_modules/mathjax/input/tex/extensions/textcomp.js','utf8'),entries=[];
  for(const match of source.matchAll(/([A-Za-z]+):\[g,("(?:\\.|[^"\\])*")(?:,d\.Variant\.([A-Z]+))?\]/g)){
    const literal=match[2].replace(/\\x([0-9a-fA-F]{2})/g,(_,hex)=>'\\u00'+hex).replace(/\\u\{([0-9a-fA-F]+)\}/g,(_,hex)=>String.fromCodePoint(parseInt(hex,16)));
    entries.push({command:match[1],value:JSON.parse(literal),variant:match[3]??null});
  }
  return entries;
}

test('the shared symbols cover every fixed textcomp literal and explicitly exclude font variants',()=>{
  const entries=upstreamSymbols();assert.equal(entries.length,117,'Review the table when the bundled MathJax package changes');
  const fixed=entries.filter(entry=>!entry.variant).map(({command,value})=>({command,value}));
  assert.deepEqual(textSymbols,fixed);assert.equal(textSymbols.length,105);
  assert.deepEqual(excludedTextSymbolCommands,entries.filter(entry=>entry.variant).map(entry=>entry.command));
  assert.equal(excludedTextSymbolCommands.length,12);
  assert.equal(new Set(textSymbols.map(entry=>entry.command)).size,textSymbols.length);
  for(const entry of textSymbols){assert.equal(textSymbolValue(entry.command),entry.value);assert.equal(Array.from(entry.value).length,1);}
  for(const command of excludedTextSymbolCommands)assert.equal(textSymbolValue(command),undefined);
  for(const command of ['ohm','degree','celsius','perthousand','micro'])assert.equal(textSymbolValue(command),undefined,'Do not imply that gensymb is enabled');
});

test('explicit dash commands are different Unicode symbols and ordinary hyphens are not rewritten',()=>{
  assert.equal(textSymbolValue('textendash'),'\u2013');assert.equal(textSymbolValue('textemdash'),'\u2014');
  assert.notEqual(textSymbolValue('textendash'),'--');assert.notEqual(textSymbolValue('textemdash'),'---');
  assert.equal(textSymbolValue('--'),undefined);assert.equal(textSymbolValue('textendashsuffix'),undefined);
  assert.equal(textSymbolValue('constructor'),undefined);assert.equal(textSymbolValue('__proto__'),undefined);
});

test('the actual application config enables textcomp once in math and text parsing',()=>{
  assert.equal(Array.from(app.loader.load).filter(name=>name==='[tex]/textcomp').length,1);
  assert.equal(Array.from(app.tex.packages['[+]']).filter(name=>name==='textcomp').length,1);
  assert.deepEqual(Array.from(app.tex.textmacros.packages['[+]']),['textcomp']);
});

function mtextValue(mml){
  const decode=value=>value.replace(/&#x([0-9a-f]+);/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16))).replace(/&#([0-9]+);/g,(_,decimal)=>String.fromCodePoint(Number(decimal))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
  assert.doesNotMatch(mml,/<merror\b/,'The actual MathJax parser must accept the command');
  const tokens=Array.from(mml.matchAll(/<mtext\b[^>]*>([\s\S]*?)<\/mtext>/g),match=>decode(match[1]));
  assert.ok(tokens.length,'Expected real MathJax text tokens');return tokens.join('');
}

test('actual bundled MathJax resolves all fixed symbols both inside textnormal and directly',async()=>{
  // Exercise the actual configured packages without loading unrelated font
  // extensions or fetching assets. This uses MathJax's parser, not a mock.
  const required=new Set(['textmacros','textcomp']);
  const runtime=await require('mathjax').init({
    loader:{paths:{mathjax:pathToFileURL(path.resolve('node_modules/mathjax')).href},load:['input/tex','[tex]/textcomp']},
    tex:{packages:['base','ams',...Array.from(app.tex.packages['[+]']).filter(name=>required.has(name))],textmacros:JSON.parse(JSON.stringify(app.tex.textmacros))},
    startup:{typeset:false}
  });
  assert.ok(runtime);
  for(const {command,value} of textSymbols){
    for(const source of ['\\'+command,'\\textnormal{\\'+command+'}'])assert.equal(mtextValue(runtime.tex2mml(source)),value,source);
  }
  assert.equal(mtextValue(runtime.tex2mml('\\textnormal{--}')),'--','Do not convert ordinary double hyphens into an en dash');
  assert.equal(mtextValue(runtime.tex2mml('\\textnormal{a \\textdegree b}')),'a \u00b0b','Control-word terminating whitespace is not text');
  assert.equal(mtextValue(runtime.tex2mml('\\textnormal{a \\textdegree{} b}')),'a \u00b0\u00a0b','MathJax retains whitespace after an explicit empty group as a visible nonbreaking space');
  assert.match(runtime.tex2mml('\\textnormal{\\textoneoldstyle}'),/data-mjx-variant="-tex-oldstyle"/,'Oldstyle carries font semantics that a literal-only table cannot preserve');
});

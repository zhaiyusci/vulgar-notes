const fs=require('node:fs');
const path=require('node:path');
const {build}=require('esbuild');

const vendorPackages=[
  ['mathjax','mathjax'],
  ['@mathjax/mathjax-newcm-font','mathjax-newcm'],
  ['@mathjax/mathjax-bboldx-font-extension','mathjax-bboldx'],
  ['@mathjax/mathjax-mhchem-font-extension','mathjax-mhchem'],
];
const sourceDirectories=new Set(['cjs','mjs','def','examples','tsconfig']);
const browserAsset=file=>!file.endsWith('.map')&&!sourceDirectories.has(path.basename(file))&&!/^node-main\./.test(path.basename(file));

function assertIndependentMathBundle(metafile){
  const forbidden=Object.keys(metafile.inputs).filter(file=>{
    const name=file.replaceAll('\\','/');
    return /(?:^|\/)node_modules\/(?:react(?:-dom)?|platejs|@platejs\/[^/]+|slate(?:-react|-history)?|citeproc)(?:\/|$)/.test(name)||
      /(?:^|\/)src\/(?:plate-|bibtex|bibliography-|references\.|document-|proofreading-|components\/)/.test(name);
  });
  if(forbidden.length)throw Error('Standalone formula build contains document-editor dependencies:\n'+forbidden.join('\n'));
}

/** Build this entry directly; the full application's dist directory is never used. */
async function buildMathEditor(workspace=path.resolve(__dirname,'..')){
  const root=fs.realpathSync(workspace),out=path.resolve(root,'math-editor-dist');
  // Every recursive removal below is restricted to this generated output directory.
  if(path.dirname(out)!==root||path.basename(out)!=='math-editor-dist')throw Error('Invalid standalone output path');
  const required=['src/standalone-math-editor.ts','src/standalone-math-editor.css','math-editor.html','src/mathjax-config.ts',
    'scripts/serve-math-editor.cjs','LICENSE','node_modules/mathjax/tex-chtml.js','node_modules/mathjax/LICENSE'];
  for(const filename of required)if(!fs.statSync(path.join(root,filename)).isFile())throw Error('Missing standalone input: '+filename);
  for(const [pkg]of vendorPackages)fs.accessSync(path.join(root,'node_modules',pkg));
  let html=fs.readFileSync(path.join(root,'math-editor.html'),'utf8');
  // Accept the pinned upstream entry in a source template, but ship only local scripts.
  html=html.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/mathjax@[^"'\s]+\/tex-chtml\.js/g,'vendor/mathjax/tex-chtml.js');
  for(const expected of ['standalone-math-editor.js','standalone-math-editor.css','mathjax-config.js','vendor/mathjax/tex-chtml.js']){
    if(!html.includes(expected))throw Error('Standalone HTML must reference '+expected);
  }
  if(/<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["']https?:\/\//i.test(html))throw Error('Standalone HTML still loads an external asset');

  const shared={absWorkingDir:root,bundle:true,write:false,platform:'browser',target:'es2022',minify:true,metafile:true,
    conditions:['production'],define:{'process.env.NODE_ENV':'"production"'},logLevel:'warning'};
  const [editor,mathjax]=await Promise.all([
    build({...shared,entryPoints:['src/standalone-math-editor.ts'],format:'esm',outfile:'standalone-math-editor.js'}),
    build({...shared,entryPoints:['src/mathjax-config.ts'],format:'iife',outfile:'mathjax-config.js'}),
  ]);
  assertIndependentMathBundle(editor.metafile);assertIndependentMathBundle(mathjax.metafile);
  const localMathJax=`
// Standalone package: resolve every runtime font and extension from local files.
MathJax.loader.paths.mathjax = new URL('./vendor/mathjax', document.baseURI).href;
MathJax.loader.paths['mathjax-newcm'] = new URL('./vendor/mathjax-newcm', document.baseURI).href;
MathJax.loader.paths['mathjax-bboldx-extension'] = new URL('./vendor/mathjax-bboldx', document.baseURI).href;
MathJax.loader.paths['mathjax-mhchem-extension'] = new URL('./vendor/mathjax-mhchem', document.baseURI).href;
MathJax.output.font = '[mathjax-newcm]';
MathJax.output.fontExtensions = [MathJax.loader.paths['mathjax-bboldx-extension']];
MathJax.chtml = {fontURL:MathJax.loader.paths['mathjax-newcm']+'/chtml/woff2',dynamicPrefix:'[mathjax-newcm]/chtml/dynamic'};
`;
  const script=editor.outputFiles.find(file=>file.path.endsWith('.js'));
  const config=mathjax.outputFiles.find(file=>file.path.endsWith('.js'));
  if(!script||!config)throw Error('Standalone compiler did not produce JavaScript');
  // Only replace a previous generated build after the source and dependency checks passed.
  // Keep the directory itself: on Windows a running local launcher can have
  // this as its working directory. Only its generated contents are replaced.
  fs.mkdirSync(out,{recursive:true});
  for(const name of fs.readdirSync(out)){
    const generated=path.resolve(out,name);
    if(path.dirname(generated)!==out)throw Error('Invalid standalone output entry');
    fs.rmSync(generated,{recursive:true,force:true});
  }
  fs.writeFileSync(path.join(out,'standalone-math-editor.js'),script.contents);
  fs.writeFileSync(path.join(out,'mathjax-config.js'),config.text+localMathJax);
  fs.copyFileSync(path.join(root,'src/standalone-math-editor.css'),path.join(out,'standalone-math-editor.css'));
  fs.writeFileSync(path.join(out,'index.html'),html);
  for(const [pkg,target]of vendorPackages)fs.cpSync(path.join(root,'node_modules',pkg),path.join(out,'vendor',target),{recursive:true,dereference:true,filter:browserAsset});
  fs.copyFileSync(path.join(root,'scripts/serve-math-editor.cjs'),path.join(out,'server.cjs'));
  fs.copyFileSync(path.join(root,'LICENSE'),path.join(out,'LICENSE'));
  fs.mkdirSync(path.join(out,'licenses'),{recursive:true});
  fs.copyFileSync(path.join(root,'node_modules/mathjax/LICENSE'),path.join(out,'licenses/MathJax-Apache-2.0.txt'));
  const packages=vendorPackages.map(([pkg,target])=>{
    const metadata=JSON.parse(fs.readFileSync(path.join(root,'node_modules',pkg,'package.json'),'utf8'));
    return {package:pkg,version:metadata.version,license:metadata.license,location:'vendor/'+target};
  });
  fs.writeFileSync(path.join(out,'build-metafile.json'),JSON.stringify({editor:editor.metafile,mathjax:mathjax.metafile},null,2));
  fs.writeFileSync(path.join(out,'package-manifest.json'),JSON.stringify({name:'Vulgar Notes Formula Editor',entry:'index.html',standalone:true,packages},null,2));
  fs.writeFileSync(path.join(out,'THIRD_PARTY_NOTICES.txt'),[
    'Vulgar Notes Formula Editor','Application source: https://github.com/zhaiyusci/vulgar-notes',
    'Application license: GPL-3.0-or-later (LICENSE).','',
    'This standalone package includes the following local MathJax runtime packages:',
    ...packages.map(item=>`${item.package} ${item.version} — ${item.license} (${item.location})`),'',
    'MathJax license text: licenses/MathJax-Apache-2.0.txt',
    'MathJax source: https://github.com/mathjax/MathJax',
    'MathJax font source: https://github.com/mathjax/MathJax-fonts','',
  ].join('\n'));
  fs.writeFileSync(path.join(out,'Start Math Editor.cmd'),[
    '@echo off','setlocal','title Vulgar Notes - Formula Editor','where node >nul 2>nul',
    'if errorlevel 1 (','  echo Node.js is required to run this local version.','  pause','  exit /b 1',')',
    'node "%~dp0server.cjs" --open','if errorlevel 1 pause','',
  ].join('\r\n'));
  fs.writeFileSync(path.join(out,'README.txt'),[
    'Vulgar Notes Formula Editor','',
    'Windows: double-click "Start Math Editor.cmd".',
    'This starts a local server and opens the default browser. Node.js must be installed.',
    'Keep the terminal window open while editing; press Ctrl+C or close it to stop the server.','',
    'Command line (does not open a browser): node server.cjs',
    'Command line with browser launch: node server.cjs --open',
    'The server uses 127.0.0.1 and an available port. Open the URL it prints.',
    'All MathJax scripts, extensions and fonts are included; no Internet connection is needed.',
    'Use the local server rather than opening index.html through file://.','',
    'This package contains the formula editor only. It does not load the document editor or bibliography editor.',
    'build-metafile.json records the source inputs used by its two JavaScript bundles.',
    'The server serves only the files in this folder and does not write formula or document files.','',
    'Source and build instructions: https://github.com/zhaiyusci/vulgar-notes',
    'Rebuild from source with: node scripts/build-math-editor.cjs','',
  ].join('\r\n'));
  console.log('Standalone formula editor prepared: '+out);
  return out;
}

if(require.main===module)buildMathEditor().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={buildMathEditor,assertIndependentMathBundle};

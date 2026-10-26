const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'desktop-dist');
// Only generated assets in this project's dedicated output directory are replaced.
if (path.dirname(out) !== root || path.basename(out) !== 'desktop-dist') throw Error('Invalid output path');
fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(out, {recursive: true});
fs.cpSync(path.join(root, 'dist'), out, {recursive: true, filter: file => !file.endsWith('.map')});
for (const name of ['plate.css', 'mathjax-config.js']) fs.copyFileSync(path.join(root, name), path.join(out, name));
let html = fs.readFileSync(path.join(root, 'mathjax4_editor_prototype_document_typeset.html'), 'utf8');
html = html.replace('https://cdn.jsdelivr.net/npm/mathjax@4.1.3/tex-chtml.js', 'vendor/mathjax/tex-chtml.js');
html = html.replace('<script src="mathjax-config.js"></script>', '<script src="mathjax-config.js"></script><script src="desktop-mathjax.js"></script>');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'desktop-mathjax.js'), `
MathJax.loader.paths['mathjax-newcm'] = new URL('./vendor/mathjax-newcm', document.baseURI).href;
MathJax.loader.paths['mathjax-bboldx-extension'] = new URL('./vendor/mathjax-bboldx', document.baseURI).href;
MathJax.loader.paths['mathjax-mhchem-extension'] = new URL('./vendor/mathjax-mhchem', document.baseURI).href;
MathJax.output.fontExtensions = [MathJax.loader.paths['mathjax-bboldx-extension']];
MathJax.chtml = {fontURL:MathJax.loader.paths['mathjax-newcm']+'/chtml/woff2',dynamicPrefix:'[mathjax-newcm]/chtml/dynamic'};
`);
for (const [pkg, target] of [['mathjax','mathjax'], ['@mathjax/mathjax-newcm-font','mathjax-newcm'], ['@mathjax/mathjax-bboldx-font-extension','mathjax-bboldx'], ['@mathjax/mathjax-mhchem-font-extension','mathjax-mhchem']]) {
  fs.cpSync(path.join(root, 'node_modules', pkg), path.join(out, 'vendor', target), {
    recursive:true, filter: file => !file.endsWith('.map') && !['cjs','mjs','def','examples','tsconfig'].includes(path.basename(file)),
  });
}
fs.cpSync(path.join(root, 'licenses'), path.join(out, 'licenses'), {recursive: true});
console.log('Desktop assets prepared in desktop-dist (local MathJax and fonts).');

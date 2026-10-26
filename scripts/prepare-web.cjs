const fs = require('node:fs');
const path = require('node:path');

const vendorPackages = [
  ['mathjax', 'mathjax'],
  ['@mathjax/mathjax-newcm-font', 'mathjax-newcm'],
  ['@mathjax/mathjax-bboldx-font-extension', 'mathjax-bboldx'],
  ['@mathjax/mathjax-mhchem-font-extension', 'mathjax-mhchem'],
];
const sourceDirectories = new Set(['cjs', 'mjs', 'def', 'examples', 'tsconfig']);
const browserAsset = file => !file.endsWith('.map') && !sourceDirectories.has(path.basename(file));

/** Relative asset URLs work at both / and a GitHub Pages project subdirectory. */
function prepareWebAssets(workspace = path.resolve(__dirname, '..')) {
  const root = path.resolve(workspace);
  const out = path.resolve(root, 'web-dist');
  // The only recursive removal is this fixed, generated workspace directory.
  if (path.dirname(out) !== root || path.basename(out) !== 'web-dist') throw Error('Invalid web output path');

  const template = path.join(root, 'mathjax4_editor_prototype_document_typeset.html');
  let html = fs.readFileSync(template, 'utf8');
  const mathjaxScript = /https:\/\/cdn\.jsdelivr\.net\/npm\/mathjax@[^"'\s]+\/tex-chtml\.js/g;
  if ([...html.matchAll(mathjaxScript)].length !== 1) throw Error('Expected one MathJax entry script');
  html = html.replace(mathjaxScript, 'vendor/mathjax/tex-chtml.js');
  const configScript = /<script\s+src=["']mathjax-config\.js["']\s*>\s*<\/script>/g;
  if ([...html.matchAll(configScript)].length !== 1) throw Error('Expected one MathJax configuration script');
  html = html.replace(configScript, '$&<script src="web-mathjax.js"></script>');

  // Fail before replacing a previously prepared site if the build is missing.
  for (const file of ['dist/editor-ui.js', 'dist/editor-ui.css', 'plate.css', 'mathjax-config.js', 'node_modules/mathjax/tex-chtml.js', 'node_modules/mathjax/LICENSE']) {
    if (!fs.statSync(path.join(root, file)).isFile()) throw Error('Missing web build input: ' + file);
  }
  for (const [pkg] of vendorPackages) fs.accessSync(path.join(root, 'node_modules', pkg));
  fs.accessSync(path.join(root, 'licenses'));

  fs.rmSync(out, {recursive: true, force: true});
  fs.mkdirSync(out, {recursive: true});
  fs.cpSync(path.join(root, 'dist'), out, {recursive: true, filter: browserAsset});
  for (const name of ['plate.css', 'mathjax-config.js']) fs.copyFileSync(path.join(root, name), path.join(out, name));
  fs.writeFileSync(path.join(out, 'index.html'), html);
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  fs.writeFileSync(path.join(out, 'web-mathjax.js'), `
MathJax.loader.paths['mathjax-newcm'] = new URL('./vendor/mathjax-newcm', document.baseURI).href;
MathJax.loader.paths['mathjax-bboldx-extension'] = new URL('./vendor/mathjax-bboldx', document.baseURI).href;
MathJax.loader.paths['mathjax-mhchem-extension'] = new URL('./vendor/mathjax-mhchem', document.baseURI).href;
MathJax.output.fontExtensions = [MathJax.loader.paths['mathjax-bboldx-extension']];
MathJax.chtml = {fontURL:MathJax.loader.paths['mathjax-newcm']+'/chtml/woff2',dynamicPrefix:'[mathjax-newcm]/chtml/dynamic'};
`);
  for (const [pkg, target] of vendorPackages) fs.cpSync(path.join(root, 'node_modules', pkg), path.join(out, 'vendor', target), {recursive: true, filter: browserAsset});
  fs.cpSync(path.join(root, 'licenses'), path.join(out, 'licenses'), {recursive: true, filter: browserAsset});
  fs.copyFileSync(path.join(root, 'node_modules/mathjax/LICENSE'), path.join(out, 'licenses/mathjax-Apache-2.0.txt'));
  console.log('Web assets prepared in web-dist (relative URLs, local MathJax and fonts).');
  return out;
}

if (require.main === module) prepareWebAssets();
module.exports = {prepareWebAssets};

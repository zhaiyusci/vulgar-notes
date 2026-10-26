const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {prepareWebAssets} = require('./scripts/prepare-web.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vulgar-web-package-'));
  t.after(() => {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('vulgar-web-package-')) throw Error('Invalid fixture cleanup path');
    fs.rmSync(root, {recursive: true, force: true});
  });
  const write = (name, contents = 'asset') => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, contents);
  };
  write('mathjax4_editor_prototype_document_typeset.html', '<!doctype html><link href="editor-ui.css"><link href="plate.css"><script src="mathjax-config.js"></script><script defer src="https://cdn.jsdelivr.net/npm/mathjax@4.1.3/tex-chtml.js"></script><script type="module" src="editor-ui.js"></script>');
  write('dist/editor-ui.js', 'import "./chunks/editor-ABC.js";');
  write('dist/chunks/editor-ABC.js');
  write('dist/editor-ui.js.map');
  write('dist/editor-ui.css');
  write('plate.css');
  write('mathjax-config.js');
  write('licenses/third-party.txt');
  write('node_modules/mathjax/tex-chtml.js');
  write('node_modules/mathjax/input/tex/extensions/mhchem.js');
  write('node_modules/mathjax/LICENSE', 'Apache license');
  for (const name of ['mathjax-newcm-font', 'mathjax-bboldx-font-extension', 'mathjax-mhchem-font-extension']) {
    write('node_modules/@mathjax/' + name + '/chtml.js');
    write('node_modules/@mathjax/' + name + '/chtml/dynamic/arrows.js');
    write('node_modules/@mathjax/' + name + '/chtml/woff2/math.woff2');
    write('node_modules/@mathjax/' + name + '/chtml.js.map');
    write('node_modules/@mathjax/' + name + '/cjs/source.js');
  }
  return {root, write};
}

test('web package resolves assets under a Pages subdirectory and retains local MathJax loaders/fonts', t => {
  const {root, write} = fixture(t);
  write('web-dist/stale.js');
  write('desktop-dist/keep.txt', 'desktop untouched');
  const out = prepareWebAssets(root);
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /cdn\.jsdelivr/);
  assert.equal(fs.existsSync(path.join(out, 'stale.js')), false);
  assert.equal(fs.readFileSync(path.join(root, 'desktop-dist/keep.txt'), 'utf8'), 'desktop untouched');
  const base = 'https://example.github.io/vulgar-notes/';
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const url = new URL(match[1], base);
    assert.equal(url.origin, 'https://example.github.io');
    assert.ok(url.pathname.startsWith('/vulgar-notes/'));
    assert.ok(fs.existsSync(path.join(out, url.pathname.slice('/vulgar-notes/'.length))), match[1]);
  }
  assert.ok(fs.existsSync(path.join(out, 'chunks/editor-ABC.js')));
  assert.ok(fs.existsSync(path.join(out, '.nojekyll')));
  assert.ok(fs.existsSync(path.join(out, 'licenses/third-party.txt')));
  assert.equal(fs.readFileSync(path.join(out, 'licenses/mathjax-Apache-2.0.txt'), 'utf8'), 'Apache license');
  assert.equal(fs.existsSync(path.join(out, 'editor-ui.js.map')), false);
  for (const name of ['mathjax-newcm', 'mathjax-bboldx', 'mathjax-mhchem']) {
    assert.ok(fs.existsSync(path.join(out, 'vendor', name, 'chtml/woff2/math.woff2')));
    assert.ok(fs.existsSync(path.join(out, 'vendor', name, 'chtml/dynamic/arrows.js')));
    assert.equal(fs.existsSync(path.join(out, 'vendor', name, 'chtml.js.map')), false);
    assert.equal(fs.existsSync(path.join(out, 'vendor', name, 'cjs')), false);
  }
  const context = {MathJax: {loader: {paths: {}}, output: {}}, document: {baseURI: base}, URL};
  vm.runInNewContext(fs.readFileSync(path.join(out, 'web-mathjax.js'), 'utf8'), context);
  for (const value of Object.values(context.MathJax.loader.paths)) assert.ok(value.startsWith(base + 'vendor/'));
  assert.equal(context.MathJax.chtml.fontURL, base + 'vendor/mathjax-newcm/chtml/woff2');
  assert.equal(context.MathJax.chtml.dynamicPrefix, '[mathjax-newcm]/chtml/dynamic');
  assert.equal(context.MathJax.output.fontExtensions[0], base + 'vendor/mathjax-bboldx');
});

test('missing build inputs cannot erase the previously prepared website', t => {
  const {root, write} = fixture(t);
  write('web-dist/keep.txt', 'previous website');
  fs.unlinkSync(path.join(root, 'dist/editor-ui.js'));
  assert.throws(() => prepareWebAssets(root));
  assert.equal(fs.readFileSync(path.join(root, 'web-dist/keep.txt'), 'utf8'), 'previous website');
});

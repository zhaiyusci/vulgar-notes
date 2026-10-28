// Native-document regression: actual lifecycle, platform, draft store and Plate host.
// Each reload receives a new isolated HappyDOM Window and a fresh module graph.
// This does not exercise MathJax layout, operating-system dialogs or user storage.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const {createHash} = require('node:crypto');
const {build} = require('esbuild');
const {IDBFactory} = require('fake-indexeddb');

const repo = __dirname;
const databaseName = 'vulgar-notes-document-drafts';
const storeName = 'entries';
const quota = 5 * 1024 * 1024;
const legacyKey = 'math-plate-document-v1:3320a53d-6421-4f51-aafe-323456789abc';
const legacySource = JSON.stringify({version: 1, value: [{type: 'p', children: [{text: 'Keep this other document recovery.'}]}]});
const proseMarker = ' [large document recovery edit]';
const paragraph = text => ({type: 'p', children: [{text}]});
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
const descendants = (items, prefix = []) => items.flatMap((node, index) => {
  const at = [...prefix, index];
  return [{node, path: at}, ...(Array.isArray(node.children) ? descendants(node.children, at) : [])];
});
const isFormula = node => ['equation', 'inline_equation'].includes(node.type);
const textOf = node => typeof node.text === 'string' ? node.text : (node.children || []).map(textOf).join('');
const digest = source => createHash('sha256').update(source).digest('hex');
const sameContent = (api, actual, expected, message) => {
  const left = api.documentContentKey(actual), right = api.documentContentKey(expected);
  if (left === right) return;
  let difference = 0;
  while (difference < left.length && difference < right.length && left[difference] === right[difference]) difference++;
  assert.equal(digest(left), digest(right), message + ': ' + JSON.stringify({difference, actual: left.slice(Math.max(0, difference - 80), difference + 160), expected: right.slice(Math.max(0, difference - 80), difference + 160)}));
};

function quotaStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(String(key)) ?? null; },
    setItem(key, value) {
      key = String(key); value = String(value);
      let size = key.length + value.length;
      for (const [oldKey, oldValue] of values) if (oldKey !== key) size += oldKey.length + oldValue.length;
      if (size > quota) throw new DOMException('The storage quota was exceeded.', 'QuotaExceededError');
      values.set(key, value);
    },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
  };
}

const bundle = build({
  stdin: {contents: `
export {PlateMathHost} from './src/plate-host';
export {EditorModel} from './src/editor-model';
export {importMath} from './src/tex-import';
export {parseDocumentEnvelope,documentContentKey,formulaNode,documentStorageKey} from './src/plate-document';
export {createFigure,floatCaption} from './src/document-floats';
export {parseBibLibraries} from './src/bibtex';
export {resolveReference} from './src/references';
export {draftStorage,initializeDocumentDraftStore,flushDocumentDraftStore} from './src/platform';
export {attachDocumentHost,runDocumentCommand,refreshDocumentState,getDocumentState,documentDraftKey,documentMetadataKey} from './src/document-lifecycle';
`, resolveDir: repo, loader: 'ts'},
  absWorkingDir: repo, bundle: true, write: false, platform: 'node', format: 'cjs',
  loader: {'.css': 'empty'}, define: {'process.env.NODE_ENV': '"production"'},
  plugins: [{name: 'large-document-minimal-kit', setup(builder) {
    // The same real content plugins used by document-structure.test.cjs.
    // Toolbar/dialog widgets are irrelevant to recovery and intentionally omitted.
    builder.onLoad({filter: /components[\\/]editor[\\/]editor-kit\.tsx$/}, () => ({contents: `
import React from 'react';
import {ParagraphPlugin,createPlatePlugin,PlateElement} from 'platejs/react';
import {TrailingBlockPlugin} from 'platejs';
import {ImagePlugin} from '@platejs/media/react';
import {TablePlugin,TableRowPlugin,TableCellPlugin,TableCellHeaderPlugin} from '@platejs/table/react';
import {MathKit} from './plugins/math-kit';import {MarkdownKit} from './plugins/markdown-kit';import {ReferenceKit} from './plugins/reference-kit';import {FootnoteKit} from './plugins/footnote-kit';import {FloatKit} from './plugins/float-kit';import {TocKit} from './plugins/toc-kit';import {MetadataKit} from './plugins/metadata-kit';
const component=tag=>props=><PlateElement {...props} as={tag}>{props.children}</PlateElement>;
export const EditorKit=[ParagraphPlugin,...Array.from({length:6},(_,i)=>createPlatePlugin({key:'h'+(i+1),node:{isElement:true,component:component('h'+(i+1))}})),ImagePlugin.withComponent(component('div')),TablePlugin.withComponent(component('table')),TableRowPlugin.withComponent(component('tr')),TableCellPlugin.withComponent(component('td')),TableCellHeaderPlugin.withComponent(component('th')),...MathKit,...ReferenceKit,...FloatKit,...TocKit,...MetadataKit,TrailingBlockPlugin,...MarkdownKit,...FootnoteKit];
`, loader: 'tsx', resolveDir: path.join(repo, 'src/components/editor')}));
  }}],
}).then(result => result.outputFiles[0].text);

let graph = 0;
async function page(factory, localStorage, documentId) {
  const {Window} = await import('happy-dom');
  const window = new Window({url: 'http://large-document.invalid/' + (documentId ? '?document=' + documentId : '')});
  Object.defineProperty(window, 'localStorage', {value: localStorage, configurable: true});
  Object.defineProperty(window, 'indexedDB', {value: factory, configurable: true});
  window.document.write('<!doctype html><html><body><div id="mount"></div><div id="error"></div></body></html>');
  for (const name of ['window', 'document', 'navigator', 'sessionStorage', 'localStorage', 'indexedDB', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Document', 'DocumentFragment', 'MutationObserver', 'ResizeObserver', 'DOMParser', 'Range', 'Event', 'CustomEvent', 'KeyboardEvent', 'ClipboardEvent', 'DOMRect', 'HTMLDivElement', 'HTMLSpanElement', 'NodeFilter', 'ShadowRoot']) {
    Object.defineProperty(globalThis, name, {value: name === 'window' ? window : window[name], configurable: true});
  }
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.innerWidth = window.innerWidth; globalThis.innerHeight = window.innerHeight;
  const filename = path.join(repo, `.large-document-graph-${++graph}.cjs`);
  const compiled = new Module(filename, module); compiled.paths = module.paths;
  compiled._compile(await bundle, filename);
  const api = compiled.exports;
  const errors = [], starts = [], rendering = [];
  window.addEventListener('vulgar-document-error', event => errors.push(event.detail));
  window.addEventListener('vulgar-document-start', event => starts.push(event.detail));
  window.addEventListener('vulgar-document-render-error', event => rendering.push(event.detail));
  await api.initializeDocumentDraftStore();
  let host, detach;
  return {
    window, api, errors, starts, rendering,
    mount() {
      host = new api.PlateMathHost(window.document.getElementById('mount'), new api.EditorModel(), {activate() {}, leave() {}, change() {api.refreshDocumentState();}});
      detach = api.attachDocumentHost(host); return host;
    },
    async close() {detach?.(); host?.destroy(); await api.flushDocumentDraftStore(); await window.happyDOM.abort();},
  };
}

async function openDatabase(factory) {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function stored(factory, key) {
  const db = await openDatabase(factory);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(key);
      transaction.oncomplete = () => resolve(request.result?.value ?? request.result ?? null);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  } finally {db.close();}
}

async function holdDraftWrites(factory) {
  const db = await openDatabase(factory);
  const transaction = db.transaction(storeName, 'readwrite');
  const store = transaction.objectStore(storeName);
  let held = true;
  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
  const keepAlive = () => {
    const request = store.get('test-transaction-barrier');
    request.onsuccess = () => {if (held) keepAlive();};
  };
  keepAlive();
  return async () => {held = false; await done; db.close();};
}

function syntheticDocument(api, mixedFormulas = false) {
  // A valid PNG prefix plus inert trailing payload produces a deterministic,
  // image-heavy fixture without committing megabytes of binary test assets.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==', 'base64');
  const image = 'data:image/png;base64,' + Buffer.concat([png, Buffer.alloc(450 * 1024)]).toString('base64');
  const formula = api.importMath('x^2+1'); assert.ok(formula);
  const unsupported = String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`;
  assert.equal(api.importMath(unsupported), null);
  const value = [paragraph('A large native document body.'), {
    type: 'p', children: [{text: 'An editable formula: '}, {...api.formulaNode(formula), id: 'large-structured'}, {text: ''}],
  }];
  for (let number = 1; number <= 10; number++) value.push({type: 'p', children: [{text: ''}, {
    type: 'inline_equation', display: true, id: 'large-source-' + number, texExpression: unsupported,
    numbered: true, texLabel: 'eq:large-' + number, children: [{text: ''}],
  }, {text: ''}]});
  if (mixedFormulas) {
    const samples = [String.raw`\sigma_{\alpha}`, String.raw`\boldsymbol{\sigma}_\alpha`, String.raw`\textnormal{--}`, String.raw`\frac{a}{\sqrt{b}}`, String.raw`\futurecmd{x}`];
    // Match a realistic mix of 104 formulas: 73 saved models and 31 source-only
    // records. All data is generated here, with no private paper dependency.
    for (let index = 0; index < 93; index++) {
      const tex = samples[index % samples.length], extra = {};
      if (index < 72) {
        const legacy = new api.EditorModel(); legacy.root.items = []; legacy.index();
        legacy.setCursor(legacy.root.id, 0); legacy.insertSourceTex(tex); extra.snapshot = legacy.snapshot();
      }
      value.push({type: 'p', children: [{text: 'Mixed formula ' + index + ': '}, {
        type: 'inline_equation', id: 'large-mixed-' + index, texExpression: tex, ...extra, children: [{text: ''}],
      }, {text: '.'}]});
    }
  }
  for (let number = 1; number <= 6; number++) {
    const figure = api.createFigure(image, 'Image payload ' + number);
    figure.id = 'large-figure-' + number; figure.texLabel = 'fig:large-' + number;
    api.floatCaption(figure).children = [{text: 'Caption ' + number}]; value.push(figure);
  }
  const keys = Array.from({length: 39}, (_, index) => 'large-ref-' + (index + 1));
  value.push({type: 'p', children: [{text: 'All references: '}, {type: 'tex_reference', command: 'cite', keys, children: [{text: ''}]}, {text: '.'}]});
  return JSON.stringify({version: 1, value, bibliographyStyle: 'acs', bibliographyLibraries: [{
    id: 'large-library', name: 'large.bib', source: keys.map((key, index) => `@article{${key},title={Reference ${index + 1}},author={Author, Alice},journal={Test Journal},year={2026}}`).join('\n'),
  }]}, null, 2);
}

function inventory(api, host) {
  const all = descendants(host.editor.children);
  return {
    figures: all.filter(({node}) => node.type === 'float' && node.kind === 'figure').map(({node}) => ({id: node.id, body: node.children.find(child => child.type === 'img').url, caption: textOf(node.children.find(child => child.type === 'float_caption'))})),
    formulas: all.filter(({node}) => isFormula(node)).map(({node}) => ({id: node.id, tex: node.texExpression, sourceOnly: !node.snapshot, display: node.display === true || node.type === 'equation'})),
    references: all.filter(({node}) => node.type === 'tex_reference').map(({node}) => ({command: node.command, keys: node.keys})),
    library: api.parseBibLibraries(host.getBibliographyLibraries()).map(entry => ({key: entry.key, title: entry.title})),
  };
}

async function roundtrip(t, makeSource) {
  const factory = new IDBFactory(), preferences = quotaStorage();
  preferences.setItem('unrelated-application-cache', 'x'.repeat(2 * 1024 * 1024));
  preferences.setItem(legacyKey, legacySource); preferences.setItem('editor.locale', 'en');
  const pages = [];
  t.after(async () => {for (const p of pages.reverse()) await p.close();});
  const home = await page(factory, preferences); pages.push(home);
  const source = makeSource(home.api), original = JSON.parse(source);
  assert.ok(source.length > 3 * 1024 * 1024, 'The native fixture must exceed the remaining localStorage quota.');
  assert.throws(() => preferences.setItem('math-plate-document-v1:old-open-path', source), {name: 'QuotaExceededError'}, 'The previous localStorage Open path must fail for this same input.');
  assert.equal(preferences.getItem(legacyKey), legacySource);
  home.window.showOpenFilePicker = async () => [{kind: 'file', name: 'large.vulgar', getFile: async () => new home.window.File([source], 'large.vulgar')}];
  // Keep IndexedDB commits pending: navigation must wait for the prepared draft
  // and baseline transaction, even if the in-memory Storage facade is updated.
  const release = await holdDraftWrites(factory);
  const opening = home.api.runDocumentCommand('open');
  try {await tick(); assert.equal(home.starts.length, 0, 'Open may not navigate before recovery commits.');}
  finally {await release();}
  await opening;
  assert.deepEqual(home.errors, []); assert.equal(home.starts.length, 1);
  const id = home.starts[0].documentId;
  const key = home.api.documentDraftKey(id), metadataKey = home.api.documentMetadataKey(id);
  assert.equal(await stored(factory, key), source);
  assert.equal(JSON.parse(await stored(factory, metadataKey)).baseline, source);
  assert.equal(preferences.getItem(key), null, 'Large document content never enters localStorage.');

  const first = await page(factory, preferences, id); pages.push(first);
  assert.equal(first.api.documentStorageKey, key);
  assert.equal(first.api.draftStorage().getItem(key), source, 'A fresh page hydrates IndexedDB before mounting.');
  const host = first.mount(); await tick();
  assert.deepEqual(first.rendering, []); assert.equal(host.hasUnsavedChanges(), false);
  const baseline = host.serializeDocument(), baselineInventory = inventory(first.api, host);
  assert.equal(baselineInventory.figures.length, 6); assert.equal(baselineInventory.library.length, 39);
  assert.equal(baselineInventory.formulas.filter(item => item.display).length, 10);
  const originalSourceOnly = descendants(original.value).filter(({node}) => isFormula(node) && !node.snapshot);
  for (const {node} of originalSourceOnly) {
    const restored = baselineInventory.formulas.find(item => item.id === node.id);
    assert.equal(restored.tex, node.texExpression, 'Source-only mathematical TeX must be retained verbatim.');
  }
  for (const {node} of descendants(host.editor.children).filter(({node}) => node.type === 'tex_reference')) {
    assert.equal(first.api.resolveReference(host.editor.children, node, host.getBibliographyLibraries(), host.getBibliographyStyle()).invalid, false);
  }
  await first.api.flushDocumentDraftStore();
  assert.equal(JSON.parse(await stored(factory, metadataKey)).pendingOpen, undefined);

  const body = descendants(host.editor.children).find(({node, path: at}) => typeof node.text === 'string' && node.text.length && host.editor.children[at[0]].type === 'p');
  assert.ok(body);
  host.editor.tf.select({path: body.path, offset: body.node.text.length});
  host.editor.tf.withNewBatch(() => host.editor.tf.insertText(proseMarker)); await tick();
  const editable = descendants(host.editor.children).find(({node}) => isFormula(node) && node.snapshot && host.models.has(node.id));
  assert.ok(editable, 'A structured formula is required for the real model edit.');
  const model = host.models.get(editable.node.id), previousTex = model.exportLatex();
  model.setCursor(model.root.id, model.root.items.length); model.replace(model.cursor.offset, model.cursor.offset, 'z');
  host.persist(); await tick();
  const changedTex = model.exportLatex(); assert.notEqual(changedTex, previousTex);
  const edited = host.serializeDocument();
  assert.equal(host.hasUnsavedChanges(), true); assert.notEqual(first.api.documentContentKey(edited), first.api.documentContentKey(baseline));
  await first.api.flushDocumentDraftStore();
  assert.deepEqual(first.rendering, []);
  sameContent(first.api, first.api.draftStorage().getItem(key), edited, 'The current page cache contains both prose and math edits.');
  sameContent(first.api, await stored(factory, key), edited, 'Both edits are committed before leaving the first page.');
  const editedInventory = inventory(first.api, host);
  assert.equal(editedInventory.figures.length, 6); assert.equal(editedInventory.library.length, 39);
  assert.deepEqual(editedInventory.figures, baselineInventory.figures);
  assert.deepEqual(editedInventory.references, baselineInventory.references);
  assert.deepEqual(editedInventory.formulas.filter(item => item.sourceOnly), baselineInventory.formulas.filter(item => item.sourceOnly));
  await first.close(); pages.splice(pages.indexOf(first), 1);

  const recovered = await page(factory, preferences, id); pages.push(recovered);
  const recoveredHost = recovered.mount(); await tick();
  sameContent(recovered.api, recoveredHost.serializeDocument(), edited, 'A new module graph restores the committed edited document.');
  assert.equal(recoveredHost.hasUnsavedChanges(), true, 'Recovered edits retain the original saved baseline.');
  assert.ok(textOf({children: recoveredHost.editor.children}).includes(proseMarker));
  assert.equal(recoveredHost.models.get(editable.node.id).exportLatex(), changedTex);
  assert.deepEqual(inventory(recovered.api, recoveredHost), editedInventory);
  let savedSource, streamClosed = false;
  recovered.window.showSaveFilePicker = async () => ({kind: 'file', name: 'saved-large.vulgar', createWritable: async () => ({
    write: async text => {savedSource = text;}, close: async () => {streamClosed = true;},
  })});
  await recovered.api.runDocumentCommand('saveAs');
  assert.deepEqual(recovered.errors, []); assert.equal(streamClosed, true); assert.equal(typeof savedSource, 'string');
  sameContent(recovered.api, savedSource, edited, 'The platform writes every edited byte to the actual save stream.');
  assert.equal(recoveredHost.hasUnsavedChanges(), false);
  recovered.api.parseDocumentEnvelope(savedSource);
  await recovered.api.flushDocumentDraftStore();
  await recovered.close(); pages.splice(pages.indexOf(recovered), 1);

  const saved = await page(factory, preferences, id); pages.push(saved);
  const savedHost = saved.mount(); await tick();
  assert.equal(savedHost.hasUnsavedChanges(), false); assert.deepEqual(inventory(saved.api, savedHost), editedInventory);
  sameContent(saved.api, savedHost.serializeDocument(), savedSource, 'The saved baseline survives a subsequent full-page reload.');
  assert.equal(saved.api.draftStorage().getItem(legacyKey), legacySource, 'Legacy recovery remains available after migration and every reopen.');
  assert.equal(preferences.getItem(legacyKey), legacySource, 'Migration never deletes the original recovery.');
  assert.equal(preferences.getItem('unrelated-application-cache'), 'x'.repeat(2 * 1024 * 1024));
  assert.equal(preferences.getItem(key), null); assert.deepEqual(saved.rendering, []);
}

test('large native files survive Open, page reload, prose/math edits, recovery and real platform Save', async t => {
  await t.test('deterministic image-heavy document, with a 5 MiB localStorage quota', async t => {
    await roundtrip(t, api => syntheticDocument(api));
  });
  await t.test('image-heavy document with 104 mixed native and source-only formulas', async t => {
    await roundtrip(t, api => syntheticDocument(api, true));
  });
});

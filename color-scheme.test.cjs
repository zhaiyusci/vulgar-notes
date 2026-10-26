const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {build} = require('esbuild');

const html = fs.readFileSync('mathjax4_editor_prototype_document_typeset.html', 'utf8');
const dialogMarkup = html.match(/<dialog id="preferencesDialog"[\s\S]*?<\/dialog>/)[0];
const code = build({
  stdin: {contents: "export * from './src/color-scheme';export {initPreferences} from './src/preferences';", resolveDir: process.cwd(), loader: 'ts'},
  bundle: true, write: false, format: 'iife', globalName: 'appearance',
  plugins: [{name: 'preferences-adapters', setup(build) {
    build.onResolve({filter: /^\.\/i18n$/}, () => ({path: 'i18n', namespace: 'preferences-test'}));
    build.onResolve({filter: /^@tauri-apps\/api\/core$/}, () => ({path: 'tauri', namespace: 'preferences-test'}));
    build.onLoad({filter: /.*/, namespace: 'preferences-test'}, ({path}) => ({contents: path === 'i18n'
      ? 'export const locale=globalThis.preferencesTest.locale;export const t=value=>value;'
      : 'export const isTauri=()=>globalThis.preferencesTest.desktop;', loader: 'js'}));
  }}],
}).then(result => result.outputFiles[0].text);
const headCode = build({entryPoints: ['src/mathjax-config.ts'], bundle: true, write: false, format: 'iife'}).then(result => result.outputFiles[0].text);

async function harness(t, {scheme, locale = 'zh-CN', desktop = false, initialize = true} = {}) {
  const {Window} = await import('happy-dom');
  const window = new Window({url: 'http://localhost/'});
  window.document.write('<!doctype html><button id="openPreferences">Preferences</button><main id="draft" contenteditable="true">Unchanged α + x²</main>' + dialogMarkup);
  const state = window.preferencesTest = {locale, desktop, reloads: []};
  if (scheme !== undefined) window.localStorage.setItem('editor.colorScheme', scheme);
  window.localStorage.setItem('private-document-draft', 'UNCHANGED_DOCUMENT');
  window.location.reload = () => state.reloads.push({scheme: window.localStorage.getItem('editor.colorScheme'), locale: window.localStorage.getItem('editor.locale')});
  window.eval(await code + '\nwindow.appearance=appearance;');
  const api = window.appearance;
  if (initialize) api.initPreferences();
  const document = window.document;
  const h = {window, document, state, api, root: document.documentElement,
    trigger: document.getElementById('openPreferences'), dialog: document.getElementById('preferencesDialog'),
    form: document.getElementById('preferencesForm'), select: document.getElementById('uiColorScheme'),
    language: document.getElementById('uiLocale'), error: document.getElementById('preferencesError')};
  h.open = () => h.trigger.click();
  h.change = value => {h.select.value = value; h.select.dispatchEvent(new window.Event('change', {bubbles: true}));};
  h.submit = action => h.form.dispatchEvent(new window.SubmitEvent('submit', {bubbles: true, cancelable: true, submitter: h.form.querySelector(`button[value="${action}"]`)}));
  t.after(() => window.happyDOM.abort());
  return h;
}

test('stored palette is validated and applied by the existing head script before editor initialization', async t => {
  for (const scheme of ['light', 'paper', 'slate', 'dark']) {
    const h = await harness(t, {scheme, initialize: false});
    assert.equal(h.root.hasAttribute('data-color-scheme'), false);
    h.window.eval(await headCode);
    assert.equal(h.root.dataset.colorScheme, scheme);
    assert.equal(h.root.classList.contains('dark'), scheme === 'dark');
    assert.ok(h.window.MathJax.tex.packages['[+]'].includes('physics'), 'appearance initialization preserves the MathJax configuration');
    assert.equal(h.state.reloads.length, 0);
  }
});

test('missing, invalid and inaccessible saved palettes use the existing light appearance', async t => {
  for (const scheme of [undefined, 'system', 'DARK', '__proto__', '{"scheme":"dark"}']) {
    const h = await harness(t, {scheme});
    assert.equal(h.root.dataset.colorScheme, 'light');
    assert.equal(h.root.classList.contains('dark'), false);
  }
  const h = await harness(t);
  assert.equal(h.api.readColorScheme({getItem() {throw Error('Storage denied');}}), 'light');
  Object.defineProperty(h.window, 'localStorage', {configurable: true, get() {throw Error('Storage denied');}});
  assert.equal(h.api.readColorScheme(), 'light');
  assert.equal(h.api.saveColorScheme('dark'), false);
});

test('preview immediately recolors the editor without modifying the draft or saved preference', async t => {
  const h = await harness(t, {scheme: 'paper'});
  h.open();
  assert.equal(h.dialog.open, true);
  assert.equal(h.select.value, 'paper');
  const body = h.document.getElementById('draft'), before = body.outerHTML;
  for (const scheme of ['slate', 'dark', 'light']) {
    h.change(scheme);
    assert.equal(h.root.dataset.colorScheme, scheme);
    assert.equal(h.root.classList.contains('dark'), scheme === 'dark');
    assert.equal(h.window.localStorage.getItem('editor.colorScheme'), 'paper');
    assert.equal(h.document.getElementById('draft'), body);
    assert.equal(body.outerHTML, before);
    assert.equal(h.window.localStorage.getItem('private-document-draft'), 'UNCHANGED_DOCUMENT');
  }
  assert.equal(h.state.reloads.length, 0);
});

test('saving only appearance persists an English identifier and does not reload the editor', async t => {
  const h = await harness(t);
  h.open(); h.change('dark'); h.submit('save');
  assert.equal(h.dialog.open, false);
  assert.equal(h.document.activeElement, h.trigger);
  assert.equal(h.window.localStorage.getItem(h.api.COLOR_SCHEME_KEY), 'dark');
  assert.equal(h.root.dataset.colorScheme, 'dark');
  assert.equal(h.state.reloads.length, 0);
  h.open(); h.change('paper'); h.submit('cancel');
  assert.equal(h.root.dataset.colorScheme, 'dark', 'a later Cancel restores the last saved palette');
  assert.equal(h.select.options.length, 4);
});

test('Cancel and native dialog dismissal restore the appearance from when preferences opened', async t => {
  const h = await harness(t, {scheme: 'paper'});
  h.open(); h.change('dark'); h.submit('cancel');
  assert.equal(h.dialog.open, false);
  assert.equal(h.root.dataset.colorScheme, 'paper');
  assert.equal(h.root.classList.contains('dark'), false);
  h.open(); h.change('slate');
  const canceled = h.dialog.dispatchEvent(new h.window.Event('cancel', {cancelable: true}));
  if (canceled) h.dialog.close(); // Native Escape closes after an uncanceled cancel event.
  assert.equal(h.dialog.open, false);
  assert.equal(h.root.dataset.colorScheme, 'paper');
  assert.equal(h.window.localStorage.getItem('editor.colorScheme'), 'paper');
  assert.equal(h.document.activeElement, h.trigger);
});

test('saving language and appearance stores both before the existing language reload', async t => {
  const h = await harness(t, {scheme: 'light'});
  h.open(); h.change('slate'); h.language.value = 'en'; h.submit('save');
  assert.deepEqual(h.state.reloads, [{scheme: 'slate', locale: 'en'}]);
  assert.equal(h.root.dataset.colorScheme, 'slate');
  assert.equal(h.window.localStorage.getItem('private-document-draft'), 'UNCHANGED_DOCUMENT');
  const resumed = await harness(t, {scheme: h.state.reloads[0].scheme, locale: 'en'});
  assert.equal(resumed.root.dataset.colorScheme, 'slate');
  resumed.open(); assert.equal(resumed.language.value, 'en');
});

test('a failed appearance save keeps preferences open, reports the failure and allows cancellation', async t => {
  const h = await harness(t, {scheme: 'paper'});
  h.open(); h.change('dark');
  const getItem = h.window.localStorage.getItem.bind(h.window.localStorage);
  Object.defineProperty(h.window, 'localStorage', {configurable: true, value: {getItem, setItem() {throw Error('Quota exceeded');}}});
  h.submit('save');
  assert.equal(h.dialog.open, true);
  assert.equal(h.error.hidden, false);
  assert.match(h.error.textContent, /could not be saved/);
  assert.equal(h.root.dataset.colorScheme, 'dark');
  assert.equal(h.state.reloads.length, 0);
  h.submit('cancel');
  assert.equal(h.root.dataset.colorScheme, 'paper');
  assert.equal(h.window.localStorage.getItem('editor.colorScheme'), 'paper');
});

test('a failed language save rolls back the saved palette and leaves the preview cancelable', async t => {
  const h = await harness(t, {scheme: 'slate'});
  const getItem = h.window.localStorage.getItem.bind(h.window.localStorage);
  const setItem = h.window.localStorage.setItem.bind(h.window.localStorage);
  Object.defineProperty(h.window, 'localStorage', {configurable: true, value: {getItem, setItem(key, value) {if (key === 'editor.locale') throw Error('Storage denied'); setItem(key, value);}}});
  h.open(); h.change('dark'); h.language.value = 'en'; h.submit('save');
  assert.equal(h.dialog.open, true);
  assert.equal(h.error.hidden, false);
  assert.equal(h.window.localStorage.getItem('editor.colorScheme'), 'slate');
  assert.equal(h.state.reloads.length, 0);
  h.submit('cancel');
  assert.equal(h.root.dataset.colorScheme, 'slate');
});

test('desktop and web retain their existing preference entries alongside the new scheme picker', async t => {
  const desktop = await harness(t, {desktop: true});
  assert.equal(desktop.document.getElementById('desktopDownloads').hidden, true);
  const web = await harness(t);
  assert.equal(web.document.getElementById('desktopDownloads').hidden, false);
  for (const h of [desktop, web]) {
    assert.equal(h.select.labels[0].dataset.i18n, 'Color scheme');
    assert.equal(h.language.labels[0].dataset.i18n, 'Interface language');
  }
});

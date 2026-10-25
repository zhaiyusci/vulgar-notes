const test = require('node:test');
const assert = require('node:assert/strict');
const {build} = require('esbuild');
const Module = require('node:module');
const path = require('node:path');

test('paragraph pointer sorting', async t => {
  const {Window} = await import('happy-dom');
  const window = new Window();
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement'])
    Object.defineProperty(globalThis, key, {value: key === 'window' ? window : window[key], configurable: true});
  const bundle = await build({stdin: {contents: `export {createPlateEditor} from 'platejs/react'; export * from './src/components/ui/paragraph-pointer-drag';`, resolveDir: process.cwd(), loader: 'ts'}, bundle: true, platform: 'node', format: 'cjs', write: false});
  const mod = new Module(path.resolve('.pointer-test.cjs'), module);
  mod.paths = module.paths;
  mod._compile(bundle.outputFiles[0].text, path.resolve('.pointer-test.cjs'));
  const {createPlateEditor, moveRootBlocks, startParagraphDrag} = mod.exports;
  const make = () => createPlateEditor({value: ['a','b','c','d'].map(id => ({id, type:'p', children:[{text:id}], snapshot:{formula:id}}))});
  const order = editor => editor.children.map(n => n.id);
  await t.test('move before first and to end; one undo preserves all node data', () => {
    const editor = make(), original = JSON.parse(JSON.stringify(editor.children));
    moveRootBlocks(editor, ['b'], 'a');
    assert.deepEqual(order(editor), ['b','a','c','d']);
    editor.tf.undo(); assert.deepEqual(editor.children, original);
    editor.tf.redo(); assert.deepEqual(order(editor), ['b','a','c','d']);
    moveRootBlocks(editor, ['b'], null); assert.deepEqual(order(editor), ['a','c','d','b']);
    editor.tf.undo(); assert.deepEqual(order(editor), ['b','a','c','d']);
  });
  await t.test('multiple selected paragraphs keep their order and undo together', () => {
    const editor = make(); moveRootBlocks(editor, ['b','d'], 'a');
    assert.deepEqual(order(editor), ['b','d','a','c']);
    editor.tf.undo(); assert.deepEqual(order(editor), ['a','b','c','d']);
  });
  function pointerSetup() {
    const editor = make();
    document.body.innerHTML = '<div id="preview"><div data-slate-editor><button>drag</button><div data-root-block-id="a"></div><div data-root-block-id="b"></div><div data-root-block-id="c"></div><div data-root-block-id="d"></div></div></div>';
    const handle = document.querySelector('button');
    handle.setPointerCapture = () => {}; handle.hasPointerCapture = () => false;
    document.querySelector('#preview').getBoundingClientRect = () => ({left:0,right:500,top:0,bottom:400});
    [...document.querySelectorAll('[data-root-block-id]')].forEach((el,i) => {el.getBoundingClientRect = () => ({left:20,right:480,top:i*50+10,bottom:i*50+50,width:460});});
    const send = (type,x,y) => window.dispatchEvent(new window.PointerEvent(type,{pointerId:1,clientX:x,clientY:y,bubbles:true,cancelable:true}));
    startParagraphDrag(editor,handle,1,25,80,['b']);
    return {editor,send};
  }
  await t.test('pointer move shows line; pointer up commits without any native drag/drop events', () => {
    const {editor,send} = pointerSetup(); send('pointermove',100,2);
    assert.equal(document.querySelector('[data-paragraph-drop-line]').style.display,'block');
    send('pointerup',100,2); assert.deepEqual(order(editor),['b','a','c','d']);
    assert.equal(document.querySelector('[data-paragraph-drop-line]'),null);
  });
  await t.test('Escape, pointer cancellation, outside release and click do not move blocks', () => {
    for (const mode of ['escape','cancel','outside','click']) {
      const {editor,send} = pointerSetup();
      if (mode !== 'click') send('pointermove',100,2);
      if (mode === 'escape') window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape'}));
      if (mode === 'cancel') send('pointercancel',100,2);
      send('pointerup', mode === 'outside' ? 700 : 25, mode === 'click' ? 80 : 2);
      assert.deepEqual(order(editor),['a','b','c','d'],mode);
      assert.equal(document.querySelector('[data-paragraph-drop-line]'),null);
    }
  });
});

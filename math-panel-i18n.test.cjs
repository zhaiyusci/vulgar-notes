const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');

const uiSource=build({entryPoints:['src/editor-ui.ts'],bundle:true,write:false,format:'iife',globalName:'mathUI'}).then(result=>result.outputFiles[0].text);
const localeSource=build({stdin:{contents:'export * from "./src/i18n";export {catalog,symbols} from "./src/editor-model";',resolveDir:__dirname,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'localeAPI'}).then(result=>result.outputFiles[0].text);
const han=/[\u3400-\u9fff]/u;

async function localeHarness(t,locale){
 const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
 window.localStorage.setItem('editor.locale',locale);
 window.eval(await localeSource+'\nwindow.localeAPI=localeAPI;');
 t.after(()=>window.happyDOM.abort());return window.localeAPI;
}

async function uiHarness(t,locale){
 const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
 window.localStorage.setItem('editor.locale',locale);
 window.document.write('<!doctype html><body><div id="preview"><div id="textFlow"><span class="inline-formula" id="formula" data-math-id="test-formula"></span></div><textarea id="mathInput" hidden></textarea></div><div id="mathPanel"><div id="insertToolbar"></div></div><div id="error"></div><div id="pendingFontHint"></div><div id="structureCount"></div><span data-count-category="化学与单位"></span><select id="formulaLayout"></select></body>');
 window.setTimeout=()=>0;window.requestAnimationFrame=()=>0;
 window.MathJax={typesetClear(){},async typesetPromise(){}};
 window.eval(await uiSource+'\nwindow.mathUI=mathUI;');
 let hooks,entry;
 window.mathUI.mountMathEditor((mount,initial,h)=>{
  hooks=h;initial.root.items=[];initial.index();initial.setCursor(initial.root.id,0);
  entry={element:window.document.getElementById('formula'),model:initial};
  return {entries:()=>[entry],syncMath(){},persist(){},exportLatex:()=>'',exportMarkdown:()=>'',isDisplay:()=>true,isNumbered:()=>true,readOnly:false};
 });
 const input=window.document.getElementById('mathInput');
 const type=text=>{
  input.dispatchEvent(new window.InputEvent('beforeinput',{inputType:'insertText',data:text}));
  input.setRangeText(text,input.selectionStart,input.selectionEnd,'end');
  input.dispatchEvent(new window.InputEvent('input',{inputType:'insertText',data:text}));
 };
 t.after(()=>window.happyDOM.abort());return {window,hooks,entry,input,type};
}

test('English math board labels, descriptions and accessible names do not retain Chinese UI text',async t=>{
 const h=await uiHarness(t,'en'),board=h.window.document.getElementById('insertToolbar');
 const chemical=board.querySelector('[data-group="化学与单位"]');
 assert.deepEqual(Array.from(chemical.querySelectorAll('.structure-label'),element=>element.textContent),['Chemical formulas and reactions','Quantities and units']);
 assert.deepEqual(Array.from(chemical.querySelectorAll('code'),element=>element.textContent),['\\ce{…}','\\pu{…}'],'command spellings remain literal');
 for(const element of [board,...board.querySelectorAll('*')]){
  for(const [attribute,text] of [['textContent',element.textContent],['title',element.getAttribute('title')],['aria-label',element.getAttribute('aria-label')]])
   assert.equal(han.test(text||''),false,attribute+' contains untranslated interface text: '+text);
 }
 assert.match(h.window.document.getElementById('structureCount').textContent,/Right-click for variants · \d+ categories/);
 assert.match(h.window.document.querySelector('[data-count-category]').textContent,/\d+ presets; hover for exact syntax/);
 h.window.mathjaxLoadFailed();assert.equal(h.window.document.getElementById('error').textContent,'MathJax failed to load. Check your network connection.');
});

test('Chinese locale retains chemistry descriptions and translated regional labels',async t=>{
 const h=await uiHarness(t,'zh-CN'),chemical=h.window.document.querySelector('[data-group="化学与单位"]');
 assert.deepEqual(Array.from(chemical.querySelectorAll('.structure-label'),element=>element.textContent),['化学式与反应式','物理量与单位']);
 assert.match(h.window.document.getElementById('structureCount').textContent,/右击按钮选择变体 · \d+ 个分类/);
 h.entry.model.insertStructure('frac');h.hooks.activate(h.entry.element,h.entry.model,'start');
 const node=h.entry.model.root.items[0];h.entry.model.setCursor(node.regions[0].id,0);h.hooks.change();
 assert.equal(h.input.getAttribute('aria-label'),'编辑 分子');
});

test('English region names, command candidates and numbering menus are localized without changing formula contents',async t=>{
 const h=await uiHarness(t,'en');h.entry.model.insertStructure('frac');h.hooks.activate(h.entry.element,h.entry.model,'start');
 const node=h.entry.model.root.items[0];h.entry.model.setCursor(node.regions[0].id,0);h.hooks.change();
 assert.equal(h.input.getAttribute('aria-label'),'Edit Numerator');
 h.type('\\ce');const before=h.entry.model.exportLatex();
 const menu=h.window.document.getElementById('commandMenu');assert.equal(menu.hidden,false);assert.match(menu.textContent,/\\ce/);assert.equal(han.test(menu.textContent),false);
 h.entry.element.dispatchEvent(new h.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:20,clientY:20}));
 assert.deepEqual(Array.from(h.window.document.querySelectorAll('#variantMenu [data-numbered]'),element=>element.textContent),['Numbered','Unnumbered']);
 assert.equal(h.entry.model.exportLatex(),before,'translated presentation must never rewrite entered TeX');
});

test('English matrix row operations and all registered argument labels are readable in English',async t=>{
 const api=await localeHarness(t,'en');
 for(const entry of api.catalog){
  for(const label of [...entry.labels,...(entry.scriptLabels||[])])assert.equal(han.test(api.mathRegionLabel(label)),false,'Untranslated argument: '+label);
 }
 assert.equal(api.mathRegionLabel('矩阵第12行第4列'),'Matrix row 12, column 4');
 assert.equal(api.mathRegionLabel('第12行表达式'),'Row 12: Expression');
 const h=await uiHarness(t,'en');h.entry.model.insertStructure('matrix');h.hooks.activate(h.entry.element,h.entry.model,'start');
 const matrix=h.entry.model.root.items[0],structure=h.window.document.createElement('span'),cell=h.window.document.createElement('span');
 structure.className='structure-node structure-'+matrix.id;cell.className='math-region region-'+matrix.regions[0].id;
 structure.append(cell);h.entry.element.append(structure);cell.dispatchEvent(new h.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:20,clientY:20}));
 const menu=h.window.document.getElementById('variantMenu');assert.equal(menu.hidden,false);assert.match(menu.textContent,/Matrix 2 × 2 · row 1, column 1/);
 assert.match(menu.textContent,/Insert row above/);assert.equal(han.test(menu.textContent),false);
});

test('localized interpolation uses stable IDs and leaves TeX braces, unknown tokens and shortcuts alone',async t=>{
 for(const locale of ['en','zh-CN']){
  const api=await localeHarness(t,locale);
  assert.equal(api.t('Chemical formulas and reactions'),locale==='en'?'Chemical formulas and reactions':'化学式与反应式');
  assert.equal(api.t('Row {row}: {part}',{row:3,part:api.t('Condition')}),locale==='en'?'Row 3: Condition':'第3行条件');
  assert.equal(api.t('\\ce{H2O}'),'\\ce{H2O}');assert.equal(api.t('Unknown {token}',{other:1}),'Unknown {token}');
  assert.equal(api.t('Bold (Ctrl+B)'),locale==='en'?'Bold (Ctrl+B)':'粗体 (Ctrl+B)');
 }
});

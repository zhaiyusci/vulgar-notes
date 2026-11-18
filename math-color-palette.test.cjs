const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const Module=require('node:module');
const {buildSync}=require('esbuild');
const {Window}=require('happy-dom');
const loaded=new Module(path.resolve('math-color-palette-api.cjs'),module);loaded.paths=module.paths;
loaded._compile(buildSync({entryPoints:['src/math-color-palette.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text,loaded.id);
const {palette}=loaded.exports;
const ui=buildSync({entryPoints:['src/math-color-control.ts'],bundle:true,write:false,format:'iife',globalName:'colorControl'}).outputFiles[0].text;

test('the palette contains the 19 xcolor base colors with explicit RGB values',()=>{
  const expected={black:'#000000',blue:'#0000FF',brown:'#BF8040',cyan:'#00FFFF',darkgray:'#404040',gray:'#808080',green:'#00FF00',lightgray:'#BFBFBF',lime:'#BFFF00',magenta:'#FF00FF',olive:'#808000',orange:'#FF8000',pink:'#FFBFBF',purple:'#BF0040',red:'#FF0000',teal:'#008080',violet:'#800080',white:'#FFFFFF',yellow:'#FFFF00'};
  assert.equal(palette.length,19);
  assert.deepEqual(palette,Object.entries(expected).map(([name,color])=>({name,color})));
});

function harness(t,locale='en'){
  const window=new Window({url:'http://localhost/'});window.localStorage.setItem('editor.locale',locale);
  window.document.body.innerHTML='<div id="mount"></div><div id="panel"></div>';
  window.eval(ui+'\nwindow.colorControl=colorControl;');
  const allowed=new Set(['text','background','border']),resettable=new Set(),calls=[];let focused=0;
  const control=window.colorControl.createMathColorControl({mount:window.document.getElementById('mount'),panel:window.document.getElementById('panel'),canApply:target=>allowed.has(target),canReset:target=>resettable.has(target),apply:(color,target)=>calls.push({color,target}),focus:()=>focused++});
  const query=selector=>window.document.querySelector(selector);
  const swatch=name=>query(`[data-color-name="${name}"]`);
  t.after(()=>{control.dispose();window.happyDOM.abort();});
  return {window,control,allowed,resettable,calls,query,swatch,focused:()=>focused};
}

test('the control only offers text color and passes the selected RGB',t=>{
  const h=harness(t);h.query('.math-color-button').click();
  assert.equal(h.window.document.querySelectorAll('[data-math-color]').length,19);
  assert.equal(h.swatch('blue').title,'blue · #0000FF');
  assert.equal(h.query('input[type=color]').value.toUpperCase(),'#0000FF');
  assert.equal(h.query('[data-color-target]'),null);
  assert.equal(h.query('.math-color-targets'),null);
  assert.equal(h.swatch('blue').getAttribute('aria-label'),h.swatch('blue').title);
  h.swatch('red').click();
  assert.deepEqual(h.calls,[{color:'#FF0000',target:'text'}]);assert.equal(h.focused(),1);
  assert.equal(h.query('.math-color-popup').hidden,true);
  h.query('.math-color-button').click();
  assert.equal(h.query('input[type=color]').value.toUpperCase(),'#FF0000');
  const custom=h.query('input[type=color]');custom.value='#123456';custom.dispatchEvent(new h.window.Event('change'));
  assert.deepEqual(h.calls[1],{color:'#123456',target:'text'});
  h.query('.math-color-button').click();
  assert.equal(custom.value,'#123456','The custom color is retained when reopening the picker');
});

test('text color availability controls the picker even if legacy box operations remain possible',t=>{
  const h=harness(t);h.query('.math-color-button').click();
  h.allowed.delete('text');h.control.update();
  assert.equal(h.query('.math-color-button').disabled,true);
  assert.equal(h.query('.math-color-popup').hidden,true);
  assert.ok([...h.window.document.querySelectorAll('[data-math-color]')].every(button=>button.disabled));
  assert.equal(h.query('input[type=color]').disabled,true);assert.equal(h.query('.math-color-reset').disabled,true);
  h.swatch('yellow').click();assert.deepEqual(h.calls,[]);
  h.allowed.add('text');h.resettable.add('text');h.control.update();
  h.query('.math-color-button').click();
  assert.ok([...h.window.document.querySelectorAll('[data-math-color]')].every(button=>!button.disabled));
  h.query('.math-color-reset').click();assert.deepEqual(h.calls,[{color:null,target:'text'}]);
  h.allowed.clear();h.control.update();assert.equal(h.query('.math-color-button').disabled,true);
});

test('Chinese UI retains the base color names',t=>{
  const h=harness(t,'zh-CN');h.query('.math-color-button').click();
  assert.equal(h.swatch('red').title,'red · #FF0000');
  assert.equal(h.swatch('black').title,'black · #000000');
  h.control.dispose();assert.equal(h.query('.math-color-popup'),null);assert.equal(h.query('.math-color-button'),null);
});

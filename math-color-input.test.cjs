const {mountMathEditor}=require('./test/math-editor-harness.cjs');
const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');

const compiled=build({entryPoints:['src/editor-ui.ts'],bundle:true,write:false,format:'iife',globalName:'mathUI'});
async function editor(t){
  const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
  window.document.write('<!doctype html><body><div id="preview"><div id="textFlow"><span id="formula"></span></div><textarea id="mathInput" hidden></textarea></div><div id="mathPanel"><div id="insertToolbar"></div></div><div id="error"></div><div id="pendingFontHint"></div><div id="structureCount"></div><select id="formulaLayout"></select></body>');
  window.setTimeout=()=>0;window.requestAnimationFrame=()=>0;
  window.eval((await compiled).outputFiles[0].text+'\nwindow.mathUI=mathUI;');
  let hooks,model,exits=0,exports=0;
  const instance=mountMathEditor(window,window.mathUI,(_mount,initial,h)=>{
    hooks=h;model=initial;model.root.items=[];model.index();model.setCursor(model.root.id,0);
    const entry={element:window.document.getElementById('formula'),model};
    return {entries:()=>[entry],syncMath(){},persist(){},exit(){exits++;},exportLatex(){exports++;return '';},exportMarkdown(){exports++;return '';},isDisplay:()=>false,isNumbered:()=>false,readOnly:false};
  });
  hooks.activate(window.document.getElementById('formula'),model,'end');
  const input=window.document.getElementById('mathInput');
  const key=(key,options={})=>{const event=new window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options});input.dispatchEvent(event);return event;};
  const insert=(text,isComposing=false)=>{
    input.dispatchEvent(new window.InputEvent('beforeinput',{inputType:'insertText',data:text,bubbles:true,cancelable:true,isComposing}));
    input.setRangeText(text,input.selectionStart,input.selectionEnd,'end');
    input.dispatchEvent(new window.InputEvent('input',{inputType:'insertText',data:text,bubbles:true,isComposing}));
  };
  const type=text=>{for(const character of text)insert(character);};
  const caret=(region,offset)=>{model.setCursor(region.id,offset);hooks.change();};
  const paste=text=>{const data=new window.DataTransfer();data.setData('text/plain',text);input.dispatchEvent(new window.ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));};
  const candidate=name=>{
    const menu=window.document.getElementById('commandMenu');assert.equal(menu.hidden,false);
    const options=[...menu.querySelectorAll('[data-command]')];assert.ok(options.some(option=>option.dataset.command===name),name);
    for(let index=0;index<options.length;index++){
      if(menu.querySelector('[aria-selected="true"]')?.dataset.command===name)break;
      key('ArrowDown');
    }
    assert.equal(menu.querySelector('[aria-selected="true"]')?.dataset.command,name);key('Tab');
  };
  const focused=()=>{assert.equal(window.document.activeElement,input);assert.equal(input.hidden,false);assert.equal(exits,0);};
  t.after(async()=>{assert.equal(exports,0,'Typing must not export a document.');instance.dispose();await window.happyDOM.abort();});
  return {window,input,model,hooks,key,insert,type,caret,paste,candidate,focused};
}
const types=editor=>[...editor.model.nodes.values()].map(node=>node.type);

test('typing a complete textcolor command converts inline at the final brace and retains focus',async t=>{
  const e=await editor(t);e.type(String.raw`\textcolor{red}{x`);
  assert.deepEqual(types(e),['source-tex']);assert.equal(e.model.projection(),String.raw`\textcolor{red}{x`);
  e.type('}');assert.deepEqual(types(e),['textcolor']);assert.equal(e.model.exportLatex(),String.raw`\textcolor{red}{x}`);
  assert.equal(e.model.rawInput,false);assert.equal(e.model.cursor.region,e.model.root.id);e.focused();
  e.type('+y');assert.equal(e.model.exportLatex(),String.raw`\textcolor{red}{x}+y`);e.focused();
});

test('a partial command candidate confirmed with Tab accepts its typed arguments and converts',async t=>{
  const e=await editor(t);e.type(String.raw`\textc`);e.candidate('textcolor');
  assert.equal(e.model.rawInput,true);assert.equal(e.model.projection(),String.raw`\textcolor`);e.focused();
  e.type('{red}{x}');assert.deepEqual(types(e),['textcolor']);assert.equal(e.model.exportLatex(),String.raw`\textcolor{red}{x}`);e.focused();
});

test('direct color input accepts the native optional RGB, rgb and grayscale models',async t=>{
  for(const source of [String.raw`\textcolor[RGB]{255,0,12}{x}`,String.raw`\textcolor[rgb]{.2,.3,.4}{y}`,String.raw`\textcolor[gray]{.5}{z}`])await t.test(source,async t=>{
    const e=await editor(t);e.type(source);assert.deepEqual(types(e),['textcolor']);assert.equal(e.model.exportLatex(),source);e.focused();
  });
});

test('a color declaration immediately includes the current region suffix and continues typing inside that color',async t=>{
  const e=await editor(t);e.type('a+b');e.caret(e.model.root,1);e.type(String.raw`\color{red}`);
  assert.equal(e.model.exportLatex(),String.raw`a\textcolor{red}{+b}`);assert.equal(e.model.cursor.offset,0);
  assert.equal(e.model.current,e.model.root.items[1].regions[0]);e.type('x');
  assert.equal(e.model.exportLatex(),String.raw`a\textcolor{red}{x+b}`);assert.equal(e.model.projection(),'x+b');e.focused();
});

test('color input inside a denominator does not color the numerator or text outside the fraction',async t=>{
  const e=await editor(t);e.paste(String.raw`\frac{a+b}{c+\sqrt{d}}+z`);
  const fraction=e.model.root.items[0],numerator=fraction.regions[0],denominator=fraction.regions[1],radical=denominator.items[2];
  e.caret(denominator,1);e.type(String.raw`\color{blue}x`);
  assert.equal(e.model.exportLatex(),String.raw`\frac{a+b}{c\textcolor{blue}{x+\sqrt{d}}}+z`);
  assert.equal(fraction.regions[0],numerator);assert.equal(e.model.current.items[2],radical);e.focused();
});

test('complete color boxes convert nested math without flattening their structure',async t=>{
  for(const source of [String.raw`\colorbox{yellow}{$\frac{x}{y}$}`,String.raw`\fcolorbox[RGB]{255,0,0}[gray]{.5}{$\frac{x}{\textcolor{blue}{y}}$}`])await t.test(source,async t=>{
    const e=await editor(t);e.type(source.slice(0,-1));assert.deepEqual(types(e),['source-tex']);e.type('}');
    assert.ok(types(e).includes('frac'));assert.ok(types(e).includes(source.startsWith('\\fcolorbox')?'fcolorbox':'colorbox'));
    assert.equal(types(e).includes('source-tex'),false);assert.equal(e.model.exportLatex(),source);e.focused();
  });
});

test('incomplete syntax, unknown models and non-math box contents retain all source',async t=>{
  for(const source of [String.raw`\textcolor{red}`,String.raw`\textcolor{red}{x`,String.raw`\textcolor[HTML]{FF0000}{x}`,String.raw`\textcolor[RGB]{999,0,0}{x}`,String.raw`\colorbox{red}{plain text}`])await t.test(source,async t=>{
    const e=await editor(t);e.type(source);assert.deepEqual(types(e),['source-tex']);assert.equal(e.model.exportLatex(),source);assert.equal(e.model.projection(),source);e.focused();
  });
});

test('typing color-like source in chemistry and descriptive text does not convert those raw regions',async t=>{
  for(const [prefix,type]of [[String.raw`\ce `,'chem-ce'],[String.raw`\textnormal `,'text-normal']])await t.test(type,async t=>{
    const e=await editor(t);e.type(prefix);const content=String.raw`\textcolor{red}{x}`;e.type(content);
    assert.deepEqual(types(e),[type]);assert.equal(e.model.projection(),content);assert.equal(e.model.rawInput,true);e.focused();
  });
});

test('undo of the closing brace restores the raw draft in one step and redo restores structural color',async t=>{
  const e=await editor(t);e.type(String.raw`\textcolor{red}{x`);const before=e.model.snapshot(),undos=e.model.undoStack.length;
  e.type('}');const completed=e.model.snapshot();assert.equal(e.model.undoStack.length,undos+1);assert.deepEqual(types(e),['textcolor']);
  e.key('z',{ctrlKey:true});assert.equal(e.model.snapshot(),before);assert.equal(e.input.value,String.raw`\textcolor{red}{x`);e.focused();
  e.key('y',{ctrlKey:true});assert.equal(e.model.snapshot(),completed);assert.deepEqual(types(e),['textcolor']);e.focused();
});

test('Tab and Enter explicitly confirm unbraced native color arguments without exiting editing',async t=>{
  for(const [source,key,expected]of [[String.raw`\textcolor{red}x`,'Enter',String.raw`\textcolor{red}{x}`],[String.raw`\textcolor{blue}\alpha`,'Tab',String.raw`\textcolor{blue}{\alpha }`]])await t.test(key,async t=>{
    const e=await editor(t);e.type(source);assert.deepEqual(types(e),['source-tex']);e.key(key);
    assert.equal(types(e).includes('textcolor'),true);assert.equal(types(e).includes('source-tex'),false);assert.equal(e.model.exportLatex(),expected);e.focused();
    e.type('+y');assert.equal(e.model.exportLatex(),expected+'+y');e.focused();
  });
});

test('one native input event may contain a complete color command and following ordinary math',async t=>{
  const e=await editor(t);e.insert(String.raw`\textcolor{red}{x}+y`);
  assert.equal(e.model.exportLatex(),String.raw`\textcolor{red}{x}+y`);assert.equal(types(e).includes('source-tex'),false);e.focused();
});

test('composition does not convert a partial command until the composition is committed',async t=>{
  const e=await editor(t);e.type(String.raw`\textcolor{red}{`);
  e.input.dispatchEvent(new e.window.CompositionEvent('compositionstart',{bubbles:true}));e.insert('x}',true);
  assert.deepEqual(types(e),['source-tex']);e.input.dispatchEvent(new e.window.CompositionEvent('compositionend',{data:'x}',bubbles:true}));
  assert.deepEqual(types(e),['textcolor']);assert.equal(e.model.exportLatex(),String.raw`\textcolor{red}{x}`);e.focused();
});

test('definecolor remains its existing source candidate rather than gaining an editable definition feature',async t=>{
  const e=await editor(t);e.type(String.raw`\definec`);e.candidate('definecolor');e.type('{custom}{rgb}{1,0,0}');
  assert.deepEqual(types(e),['source-tex']);assert.equal(e.model.exportLatex(),String.raw`\definecolor{custom}{rgb}{1,0,0}`);e.focused();
});

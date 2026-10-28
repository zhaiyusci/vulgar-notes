const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');

const mime='application/x-vulgar-notes-fragment+json';
const compiled=build({entryPoints:['src/editor-ui.ts'],bundle:true,write:false,format:'iife',globalName:'mathUI'});
async function editor(){
  const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
  window.document.write('<!doctype html><body><div id="preview"><div id="textFlow"><span id="formula"></span></div><textarea id="mathInput" hidden></textarea></div><div id="mathPanel"><div id="insertToolbar"></div></div><div id="error"></div><div id="pendingFontHint"></div><div id="structureCount"></div><select id="formulaLayout"></select></body>');
  window.setTimeout=()=>0;window.requestAnimationFrame=()=>0;
  window.eval((await compiled).outputFiles[0].text+'\nwindow.mathUI=mathUI;');
  let hooks,model,exports=0;
  window.mathUI.mountMathEditor((mount,initial,h)=>{
    hooks=h;model=initial;model.root.items=[];model.index();model.setCursor(model.root.id,0);
    const entry={element:window.document.getElementById('formula'),model};
    return {entries:()=>[entry],syncMath(){},persist(){},exportLatex(){exports++;return '';},exportMarkdown(){exports++;return '';},isDisplay:()=>false,isNumbered:()=>false,readOnly:false};
  });
  hooks.activate(window.document.getElementById('formula'),model,'end');
  const input=window.document.getElementById('mathInput');
  const select=(region=model.root.id,start=0,end=model.regions.get(region).items.length)=>{model.setCursor(region,end,start);hooks.change();};
  const clipboard=values=>{const data=new window.DataTransfer();for(const [type,value]of Object.entries(values??{}))data.setData(type,value);return data;};
  const event=(type,data)=>{const event=new window.ClipboardEvent(type,{clipboardData:data,bubbles:true,cancelable:true});input.dispatchEvent(event);return event;};
  const paste=(source)=>event('paste',typeof source==='string'?clipboard({'text/plain':source}):source);
  const type=text=>{input.dispatchEvent(new window.InputEvent('beforeinput',{inputType:'insertText',data:text}));input.setRangeText(text,input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new window.InputEvent('input',{inputType:'insertText',data:text}));};
  const close=async()=>{assert.equal(exports,0,'clipboard operations must never export the whole document');await window.happyDOM.abort();};
  return {window,input,model,hooks,select,clipboard,event,paste,type,close};
}
const ids=root=>{const result=[];const visit=region=>{result.push(region.id);for(const item of region.items)if(typeof item!=='string'){result.push(item.id);item.regions.forEach(visit);}};visit(root);return result;};
const shape=value=>JSON.parse(JSON.stringify(value,(key,item)=>['id','label'].includes(key)?undefined:item));

test('real formula copy and paste preserve selected nested structures with independent IDs and one undo',async()=>{
  const e=await editor();
  e.paste(String.raw`\frac{a+\sqrt{x}}{b}`);e.model.setCursor(e.model.root.id,e.model.root.items.length);e.model.insertSymbol('symbol-letter-A--symbf');
  e.model.insertStructure('matrix');e.model.insert('z');e.select();
  const source=shape(e.model.root.items),originalIds=ids(e.model.root),data=e.clipboard();
  assert.equal(e.event('copy',data).defaultPrevented,true);assert.ok(data.getData(mime));assert.match(data.getData('text/plain'),/\\mathbf\{A\}/);
  e.select(e.model.root.id,e.model.root.items.length,e.model.root.items.length);e.paste(data);
  const count=source.length;assert.deepEqual(shape(e.model.root.items.slice(count)),source);
  const allIds=ids(e.model.root);assert.equal(new Set(allIds).size,allIds.length);assert.equal(allIds.filter(id=>originalIds.includes(id)).length,originalIds.length);
  e.model.undo();assert.deepEqual(shape(e.model.root.items),source);e.model.redo();assert.deepEqual(shape(e.model.root.items.slice(count)),source);
  await e.close();
});

test('external TeX paste uses TeX script scope while interactive typing stays in the current sequence',async()=>{
  for(const [source,expected]of [['x^2+y','{x}^{2}+y'],['x_i^2','{x}_{i}^{2}'],['e^N_bead','{e}_{b}^{N}ead'],[String.raw`\overset{a}{b}`,String.raw`\overset{a}{b}`]]){
    const e=await editor();assert.equal(e.paste(source).defaultPrevented,true);assert.equal(e.model.exportLatex(),expected);
    assert.equal(e.model.cursor.region,e.model.root.id);assert.equal(e.model.cursor.offset,e.model.root.items.length);await e.close();
  }
  const e=await editor();e.type('e^N_bead');assert.equal(e.model.exportLatex(),'{e}^{{N}_{bead}}');await e.close();
});

test('unsupported TeX is one editable source component and survives native round trips byte for byte',async()=>{
  for(const source of [String.raw`\futurecmd{a}{b}`,String.raw`\futurecmd*[2]{f}{x}`,String.raw`\mathcal{\alpha}`]){
    const e=await editor();e.paste(source);assert.equal(e.model.root.items[0].type,'source-tex');assert.equal(e.model.exportLatex(),source);
    const region=e.model.root.items[0].regions[0];e.select(region.id,0,region.items.length);
    const data=e.clipboard();e.event('copy',data);assert.equal(data.getData('text/plain'),source);
    e.select(e.model.root.id,1,1);e.paste(data);assert.equal(e.model.root.items[1].type,'source-tex');assert.equal(e.model.exportLatex(),source+source);
    await e.close();
  }
});

test('an unsupported comment remains exact while surrounding math becomes editable',async()=>{
  const e=await editor(),comment='% keep the comment\r\n';e.paste('x'+comment+'+y');
  const raw=e.model.root.items.find(item=>item.type==='source-tex');assert.ok(raw);assert.equal(raw.regions[0].items.join(''),comment);
  assert.equal(e.model.root.items[0],'x');assert.equal(e.model.root.items.at(-1),'y');assert.equal(e.model.exportLatex(),'x'+comment+'+y');await e.close();
});

test('HTML native fallback and external MathML TeX annotations retain structure rather than display glyphs',async()=>{
  const e=await editor();e.paste(String.raw`\frac{\sqrt{x}}{y}`);e.select();const original=e.clipboard();e.event('copy',original);
  e.select(e.model.root.id,1,1);e.paste(e.clipboard({'text/html':original.getData('text/html'),'text/plain':'wrong fallback'}));assert.equal(e.model.root.items[1].type,'frac');
  e.select(e.model.root.id,2,2);e.paste(e.clipboard({'text/html':'<math><semantics><mi>wrong glyphs</mi><annotation encoding="application/x-tex">x^2+y</annotation></semantics></math>','text/plain':'wrong fallback'}));
  assert.equal(e.model.exportLatex(),String.raw`\frac{\sqrt{x}}{y}\frac{\sqrt{x}}{y}{x}^{2}+y`);
  await e.close();
});

test('body native formula snapshot enters math directly; corrupt native data safely uses external source',async()=>{
  const e=await editor();e.paste(String.raw`\frac{a}{b}`);const snapshot=e.model.snapshot();e.select(e.model.root.id,1,1);
  e.paste(e.clipboard({[mime]:JSON.stringify({version:1,kind:'document',value:[{type:'p',children:[{text:''},{type:'inline_equation',id:'copied-formula',texExpression:'wrong source',snapshot,children:[{text:''}]},{text:''}]}]})}));
  assert.equal(e.model.root.items[1].type,'frac');e.select();e.paste(e.clipboard({[mime]:'{bad JSON','text/plain':'x_i^2'}));assert.equal(e.model.exportLatex(),'{x}_{i}^{2}');await e.close();
});

test('descriptive and chemistry fields paste literal source without executing script keystrokes',async()=>{
  for(const type of ['text-normal','chem-ce','chem-pu']){
    const e=await editor();e.model.insertStructure(type);e.hooks.change();
    e.paste(String.raw`中文 x^2_3 \future{a}`);assert.equal(e.model.current.items.join(''),String.raw`中文 x^2_3 \future{a}`);assert.equal(e.model.current.items.every(item=>typeof item==='string'),true);await e.close();
  }
});

test('actual cut removes only after clipboard writing succeeds and is independently undoable',async()=>{
  const e=await editor();e.paste(String.raw`\sqrt{x}`);e.type('+a');e.select(e.model.root.id,0,1);
  const failing={getData:()=>'',setData(){throw Error('clipboard unavailable');}},failure=e.event('cut',failing);
  assert.equal(failure.defaultPrevented,true);assert.equal(e.model.exportLatex(),String.raw`\sqrt{x}+a`);
  const data=e.clipboard();assert.equal(e.event('cut',data).defaultPrevented,true);assert.equal(e.model.exportLatex(),'+a');assert.ok(data.getData(mime));
  e.model.undo();assert.equal(e.model.exportLatex(),String.raw`\sqrt{x}+a`);e.model.redo();assert.equal(e.model.exportLatex(),'+a');await e.close();
});

test('native selection offsets count Unicode characters and paste replaces only the selected range',async()=>{
  const e=await editor();e.paste('a😀b');
  e.input.setSelectionRange(1,3);const data=e.clipboard();e.event('copy',data);assert.equal(data.getData('text/plain'),'😀');
  e.input.setSelectionRange(0,1);e.paste(data);assert.equal(e.model.exportLatex(),'😀😀b');await e.close();
});

test('the visible LaTeX action opens the existing source and converts edits without retyping the formula',async()=>{
  const e=await editor(),original=String.raw`\futurecmd{a}{b}`;e.paste(original);
  e.window.document.getElementById('formulaSourceButton').click();
  const dialog=e.window.document.getElementById('formulaSourceDialog'),source=e.window.document.getElementById('formulaSourceInput');
  assert.equal(dialog.open,true);assert.equal(source.value,original,'the existing source must be visible, not an empty entry field');
  source.value=String.raw`\frac{a}{b}+\sqrt{x}`;dialog.querySelector('[data-choice="save"]').click();
  assert.equal(dialog.open,false);assert.equal(e.model.root.items[0].type,'frac');assert.equal(e.model.root.items[2].type,'sqrt');
  e.model.undo();assert.equal(e.model.exportLatex(),original);await e.close();
});

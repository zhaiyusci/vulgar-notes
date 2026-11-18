const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');

const bundled=build({stdin:{contents:"export {createMathEditor} from './src/math-editor';export {convertMath} from './src/tex-convert';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'mathSourceAPI'}).then(result=>result.outputFiles[0].text);
async function fixture(t,{hosted=true,replace=false}={}){
 const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'}),document=window.document;
 document.body.innerHTML='<div id="preview"><div id="content"><span id="formula" class="inline-formula" data-math-id="first"></span><span id="other" class="inline-formula" data-math-id="second"></span></div><textarea id="input" hidden></textarea></div><div id="panel"><div id="toolbar"></div><select id="layout"></select></div><p id="error"></p><p id="pendingFontHint"></p><span id="structureCount"></span>';
 window.requestAnimationFrame=()=>1;window.cancelAnimationFrame=()=>{};window.setTimeout=()=>1;window.clearTimeout=()=>{};
 window.eval(await bundled+'\nwindow.mathSourceAPI=mathSourceAPI;');
 const api=window.mathSourceAPI,elements=Object.fromEntries(['formula','preview','content','input','error','panel','toolbar','layout','pendingFontHint','structureCount'].map(id=>[id,document.getElementById(id)]));
 const contexts=[],replacements=[];let closed=0,readOnly=false,syncs=0;
 const sourceEditor=hosted?{label:'View LaTeX',open:context=>contexts.push(context),close:()=>closed++}:undefined;
 const first=api.convertMath('a'),second=api.convertMath('b');let entries=[{element:elements.formula,model:first},{element:document.getElementById('other'),model:second}];
 const math=api.createMathEditor({elements,initialModel:first,sourceEditor});
 const host={get readOnly(){return readOnly;},entries:()=>entries,syncMath(){syncs++;},getFormulaSource:owner=>entries.find(e=>e.element===owner)?.model.exportLatex(),isDisplay:()=>false,isNumbered:()=>false,setDisplay(){},setNumbered(){},insertFormula:()=>entries[0],enter(owner,edge){const entry=entries.find(e=>e.element===owner);if(entry)math.hooks.activate(owner,entry.model,edge);},exit(){math.hooks.leave();},removeEmpty(){}};
 if(replace)host.replaceFormulaSource=(owner,source)=>{const model=entries.find(e=>e.element===owner).model;replacements.push({owner,source});model.record();model.restore(api.convertMath(source).snapshot());math.hooks.change();};
 math.connect(host);math.hooks.activate(elements.formula,first,'end');
 t.after(async()=>{math.dispose();await window.happyDOM.abort();});
 return {window,document,api,elements,math,host,first,second,contexts,replacements,get closed(){return closed;},get syncs(){return syncs;},set readOnly(value){readOnly=value;},replaceEntries(value){entries=value;}};
}

test('hosted LaTeX editing has one public/menu entry point and creates no default UI',async t=>{
 const f=await fixture(t);assert.equal(f.document.querySelector('.formula-source-dialog,.formula-source-button'),null);
 f.math.openSource();assert.equal(f.contexts.length,1);assert.equal(f.contexts[0].source,'a');assert.equal(f.contexts[0].isCurrent(),true);
 f.elements.formula.dispatchEvent(new f.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:20,clientY:20}));
 const option=f.document.querySelector('[data-edit-formula-source]');assert.ok(option);assert.equal(option.textContent,'View LaTeX');option.click();
 assert.equal(f.contexts.length,2);assert.equal(f.contexts[0].isCurrent(),false);assert.equal(f.contexts[0].apply('lost'),false);assert.equal(f.contexts[1].source,'a');assert.equal(f.closed,1);
 assert.equal(f.document.querySelector('.formula-source-dialog,.formula-source-button'),null);
});

test('opening hosted source flushes composition before publishing source, and Apply remains undoable',async t=>{
 const f=await fixture(t),input=f.elements.input;
 input.dispatchEvent(new f.window.CompositionEvent('compositionstart',{bubbles:true}));input.value='a中文';input.dispatchEvent(new f.window.InputEvent('input',{bubbles:true,inputType:'insertCompositionText',isComposing:true,data:'中文'}));
 assert.equal(f.first.exportLatex(),'a');f.math.openSource();const context=f.contexts[0],composed=f.first.exportLatex();
 assert.equal(f.math.hooks.isComposing(),false);assert.equal(context.source,composed);assert.match(composed,/中文/);assert.equal(input.hidden,true);
 assert.equal(context.apply(String.raw`\frac{x}{y}`),true);assert.equal(f.first.root.items[0].type,'frac');assert.equal(context.isCurrent(),true,'A persistent host can apply again without reopening');
 f.first.undo();assert.equal(f.first.exportLatex(),composed);assert.equal(context.apply(String.raw`\textnormal{--}`),true);assert.equal(f.first.root.items[0].type,'text-normal');
});

test('host conversion is delegated while the fallback preserves unsupported source',async t=>{
 const f=await fixture(t,{replace:true});f.math.openSource();assert.equal(f.contexts[0].apply(String.raw`\sigma_{\alpha}`),true);
 assert.equal(f.replacements.length,1);assert.equal(f.replacements[0].owner,f.elements.formula);assert.equal(f.first.root.items[0].type,'subscript');
 const fallback=await fixture(t);fallback.math.openSource();const source=String.raw`\futurecmd{x}`;assert.equal(fallback.contexts[0].apply(source),true);assert.equal(fallback.first.exportLatex(),source);assert.equal(fallback.first.root.items[0].type,'source-tex');
});

test('readonly source sessions cannot apply and no new source UI opens',async t=>{
 const f=await fixture(t);f.math.openSource();const context=f.contexts[0];f.readOnly=true;
 assert.equal(context.isCurrent(),false);assert.equal(context.apply('changed'),false);assert.equal(f.first.exportLatex(),'a');f.math.openSource();assert.equal(f.contexts.length,1);
 context.cancel();assert.equal(f.closed,1);assert.equal(f.elements.input.hidden,true);
});

test('switching formulas invalidates the old source session without editing either wrong target',async t=>{
 const f=await fixture(t);f.math.openSource();const old=f.contexts[0],second=f.document.getElementById('other');
 f.math.openSource(second);assert.equal(f.contexts.length,2);assert.equal(f.contexts[1].source,'b');assert.equal(old.isCurrent(),false);assert.equal(old.apply('wrong'),false);old.cancel();assert.equal(f.contexts[1].isCurrent(),true);
 assert.equal(f.contexts[1].apply('c'),true);assert.equal(f.first.exportLatex(),'a');assert.equal(f.second.exportLatex(),'c');
 f.math.hooks.activate(f.elements.formula,f.first,'end');assert.equal(f.contexts[1].apply('wrong again'),false);assert.equal(f.first.exportLatex(),'a');assert.equal(f.closed,2);
});

test('removal and model replacement invalidate stale callbacks even before an activation notification',async t=>{
 const removed=await fixture(t);removed.math.openSource();const old=removed.contexts[0];removed.elements.formula.remove();assert.equal(old.isCurrent(),false);assert.equal(old.apply('wrong'),false);assert.equal(removed.first.exportLatex(),'a');
 const replaced=await fixture(t);replaced.math.openSource();const context=replaced.contexts[0],replacement=replaced.api.convertMath('new');replaced.replaceEntries([{element:replaced.elements.formula,model:replacement}]);
 assert.equal(context.isCurrent(),false);assert.equal(context.apply('wrong'),false);assert.equal(replaced.first.exportLatex(),'a');assert.equal(replacement.exportLatex(),'new');
 const alien=replaced.document.createElement('span');replaced.document.body.append(alien);replaced.math.openSource(alien);assert.equal(replaced.contexts.length,1);
});

test('dispose revokes hosted callbacks and closes the host without document writes',async t=>{
 const f=await fixture(t);f.math.openSource();const context=f.contexts[0],syncs=f.syncs;f.math.dispose();f.math.dispose();
 assert.equal(f.closed,1);assert.equal(f.syncs,syncs);assert.equal(context.isCurrent(),false);assert.equal(context.apply('wrong'),false);context.cancel();assert.equal(f.closed,1);assert.equal(f.first.exportLatex(),'a');
 f.math.openSource();assert.equal(f.contexts.length,1);assert.equal(f.document.querySelector('.formula-source-dialog,.formula-source-button,.variant-menu,.command-menu'),null);
});

test('the default source dialog remains available and returns focus after cancellation',async t=>{
 const f=await fixture(t,{hosted:false}),button=f.document.querySelector('.formula-source-button'),dialog=f.document.querySelector('.formula-source-dialog');assert.ok(button);assert.ok(dialog);
 button.click();assert.equal(dialog.open,true);assert.equal(dialog.querySelector('textarea').value,'a');dialog.querySelector('button').click();assert.equal(dialog.open,false);assert.equal(f.document.activeElement,f.elements.input);
 f.math.dispose();assert.equal(f.document.querySelector('.formula-source-dialog,.formula-source-button'),null);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {build}=require('esbuild');

const bundled=build({entryPoints:['src/math-editor.ts'],bundle:true,write:false,format:'cjs',metafile:true}).then(result=>({source:result.outputFiles[0].text,inputs:Object.keys(result.metafile.inputs)}));
const browser=build({entryPoints:['src/math-editor.ts'],bundle:true,write:false,format:'iife',globalName:'mathAPI'}).then(result=>result.outputFiles[0].text);

function elements(window){
 const root=window.document.createElement('section');
 root.innerHTML='<div data-math="preview"><div data-math="content"><span data-math="formula"></span></div><textarea data-math="input" hidden></textarea></div><div data-math="panel"><div data-math="toolbar"></div><select data-math="layout"></select></div><div data-math="error"></div><div data-math="pendingFontHint"></div><div data-math="structureCount"></div>';
 window.document.body.append(root);
 return Object.fromEntries(['formula','preview','content','input','error','panel','toolbar','layout','pendingFontHint','structureCount'].map(name=>[name,root.querySelector('[data-math="'+name+'"]')]));
}
async function fixture(t){
 const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
 const frames=new Map(),timers=new Map(),observers=[];let serial=0;
 window.requestAnimationFrame=fn=>{const id=++serial;frames.set(id,fn);return id;};window.cancelAnimationFrame=id=>frames.delete(id);
 window.setTimeout=(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;};window.clearTimeout=id=>timers.delete(id);
 window.ResizeObserver=class{constructor(fn){this.fn=fn;this.disconnected=false;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
 window.eval(await browser+'\nwindow.mathAPI=mathAPI;');
 t.after(()=>window.happyDOM.abort());return {window,api:window.mathAPI,frames,timers,observers};
}
function connect(h,ui){
 const model=h.initialModel;model.root.items=[];model.index();model.setCursor(model.root.id,0);
 let changes=0;
 h.connect({readOnly:false,entries:()=>[{element:ui.formula,model}],syncMath(){changes++;},isDisplay:()=>false,isNumbered:()=>false,setDisplay(){},setNumbered(){},insertFormula(){return {element:ui.formula,model};},enter(element,edge){h.hooks.activate(element,model,edge);},exit(){h.hooks.leave();},removeEmpty(){}});
 return {model,get changes(){return changes;}};
}
function type(window,input,text){input.dispatchEvent(new window.InputEvent('beforeinput',{inputType:'insertText',data:text}));input.value+=text;input.dispatchEvent(new window.InputEvent('input',{inputType:'insertText',data:text}));}

test('importing the math component requires no DOM and pulls in no document or bibliography editor',async()=>{
 const {source,inputs}=await bundled,module={exports:{}};
 vm.runInNewContext(source,{module,exports:module.exports});assert.equal(typeof module.exports.createMathEditor,'function');
 assert.equal(inputs.some(path=>/plate-host|plate-document|document-lifecycle|document-host|bibtex|bibliography|react[/\\]|src[/\\]platform\.ts/.test(path)),false,inputs.filter(path=>/plate|bib|react|platform/.test(path)).join('\n'));
});

test('two explicitly mounted math components keep input, palette and lifecycle independent',async t=>{
 const f=await fixture(t),aUI=elements(f.window),bUI=elements(f.window),draftA=[],draftB=[];
 const a=f.api.createMathEditor({elements:aUI,draft:{read:()=>null,write:value=>draftA.push(value)}}),b=f.api.createMathEditor({elements:bUI,draft:{read:()=>null,write:value=>draftB.push(value)}});
 const ad=connect(a,aUI),bd=connect(b,bUI);assert.notEqual(aUI.formula.id,bUI.formula.id);
 a.hooks.activate(aUI.formula,ad.model,'end');type(f.window,aUI.input,'a');assert.equal(ad.model.exportLatex(),'a');assert.equal(bd.model.exportLatex(),'');
 b.hooks.activate(bUI.formula,bd.model,'end');type(f.window,bUI.input,'b');assert.equal(ad.model.exportLatex(),'a');assert.equal(bd.model.exportLatex(),'b');
 const selectedA=aUI.toolbar.querySelector('[aria-pressed="true"]').dataset.category;
 bUI.toolbar.querySelector('[data-category="分式与根式"]').click();assert.equal(aUI.toolbar.querySelector('[aria-pressed="true"]').dataset.category,selectedA);
 const beforeA=ad.changes,beforeB=bd.changes,writeA=draftA.length;
 a.dispose();a.dispose();assert.equal(ad.changes,beforeA,'unmount must not commit or mutate the host');assert.equal(draftA.length,writeA);
 type(f.window,aUI.input,'lost');a.hooks.change();a.notifyLoadFailure();assert.equal(ad.model.exportLatex(),'a');assert.equal(ad.changes,beforeA);assert.equal(aUI.error.textContent,'');
 assert.equal(aUI.toolbar.childElementCount,0);assert.ok(bUI.toolbar.childElementCount>0);assert.equal(f.observers[0].disconnected,true);assert.equal(f.observers[1].disconnected,false);
 type(f.window,bUI.input,'2');assert.equal(bd.model.exportLatex(),'b2');assert.ok(bd.changes>beforeB);assert.ok(draftB.length>0);
 b.dispose();assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);assert.equal(f.window.document.querySelectorAll('.command-menu,.variant-menu,.formula-source-dialog,.formula-source-button,.math-font-hint').length,0);
});

test('disposal during MathJax work removes owned nodes and ignores a late render result',async t=>{
 const f=await fixture(t),ui=elements(f.window);let release;
 f.window.ready=true;f.window.MathJax={texReset(){},typesetClear(targets){if(targets.some(node=>node.classList.contains('math-render-stage'))&&released)throw Error('renderer cleanup failed');},async typesetPromise(targets){const stage=targets.find(node=>node.classList.contains('math-render-stage'));if(stage){await new Promise(resolve=>release=resolve);stage.textContent='Late renderer output';}}};
 let released=false;
 const component=f.api.createMathEditor({elements:ui}),host=connect(component,ui);host.model.insert('x');
 const rendering=component.render();for(let tries=0;tries<20&&!release;tries++)await new Promise(resolve=>setImmediate(resolve));
 assert.ok(release);const original=ui.formula.innerHTML,changes=host.changes;released=true;component.dispose();assert.equal(f.window.document.querySelector('.math-render-stage'),null);
 release();await rendering;assert.equal(ui.formula.innerHTML,original);assert.equal(ui.error.textContent,'');assert.equal(host.changes,changes);
 assert.equal(f.window.document.querySelectorAll('.command-menu,.variant-menu,.formula-source-dialog').length,0);
});

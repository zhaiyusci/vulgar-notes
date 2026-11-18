const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {build}=require('esbuild');

const compiled=build({entryPoints:['src/application-editor.ts'],bundle:true,write:false,format:'iife',globalName:'applicationEditor',plugins:[{name:'application-editor-host',setup(b){
 b.onResolve({filter:/^\.\/plate-host$/},()=>({path:'host',namespace:'application-test'}));
 b.onResolve({filter:/^\.\/platform$/},()=>({path:'platform',namespace:'application-test'}));
 b.onLoad({filter:/.*/,namespace:'application-test'},({path:name})=>({loader:'ts',contents:name==='platform'?
  "export const documentSessionId=()=>window.applicationTest.sessionId;export const draftStorage=()=>window.sessionStorage;":`
  export class PlateMathHost {
    readOnly=false;
    constructor(mount,initial,hooks){
      const s=window.applicationTest;s.events.push('host.construct');s.mount=mount;s.initial=initial;this.hooks=hooks;
      s.mathWasMounted=!!document.querySelector('.command-menu');
      if(s.constructorFailure)throw Error('host construction failed');
      mount.id='plateMount';mount.replaceChildren();
      this.content=document.createElement('div');this.content.id='textFlow';this.content.style.maxWidth='720pt';this.content.style.fontSize='20px';
      Object.defineProperty(this.content,'clientWidth',{get:()=>s.contentWidth});mount.append(this.content);
      const element=document.createElement('span');element.className='inline-formula';element.dataset.mathId='application-formula';this.content.append(element);
      initial.root.items=['x'];initial.index();initial.setCursor(initial.root.id,1);
      this.entry={element,model:initial};s.host=this;
    }
    entries(){return [this.entry];}
    syncMath(){window.applicationTest.events.push('host.sync');}
    isDisplay(){return true;}
    isNumbered(){return false;}
    destroy(){
      const s=window.applicationTest;s.events.push('host.destroy');s.captured=this.hooks.pendingMathSnapshot();s.composingOnDestroy=this.hooks.isComposing();
      if(s.destroyFailure)throw Error('host destruction failed');
      this.content.remove();
    }
  }` }));
 b.onLoad({filter:/src[\\/]math-editor\.ts$/},args=>{
  const source=fs.readFileSync(args.path,'utf8');
  const contents=source.replace("export {createMathEditor} from './editor-ui';",`
    import {createMathEditor as createRealMathEditor} from './editor-ui';
    export function createMathEditor(options){
      const s=window.applicationTest;s.events.push('math.create');s.elements=options.elements;
      const real=createRealMathEditor(options);s.mathInitial=real.initialModel;
      return {...real,hooks:{...real.hooks,change(){s.events.push('math.change');real.hooks.change();}},
        connect(host){s.events.push('math.connect');if(s.connectFailure)throw Error('math connection failed');real.connect(host);},
        dispose(){s.events.push('math.dispose');real.dispose();if(s.disposeFailure)throw Error('math disposal failed');},
      };
    }`);
  assert.notEqual(contents,source,'only observe the real math component public methods');
  return {contents,loader:'ts',resolveDir:path.dirname(args.path)};
 });
}}]}).then(result=>result.outputFiles[0].text);

async function harness(t,settings={}){
 const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
 window.document.write('<!doctype html><body><div id="preview"><div id="textFlow" style="font-size:32px"><span id="formula"></span></div><textarea id="mathInput" hidden></textarea></div><div id="mathPanel"><div id="insertToolbar"></div><div class="document-actions"><select id="formulaLayout"><option value="inline">Inline</option><option value="display">Display</option></select></div></div><p id="error"></p><p id="pendingFontHint"></p><span id="structureCount"></span></body>');
 Object.defineProperty(window.document.getElementById('textFlow'),'clientWidth',{value:1640});
 window.localStorage.setItem('editor.locale','en');
 const state=window.applicationTest={events:[],contentWidth:960,sessionId:'c31215d8-89de-4f77-8493-111111111111',...settings};
 const originalFailure=()=>{state.oldFailureCalled=true;};window.mathjaxLoadFailed=originalFailure;
 let frameNumber=0;const frames=new Map();
 window.requestAnimationFrame=callback=>{const id=++frameNumber;frames.set(id,callback);return id;};window.cancelAnimationFrame=id=>frames.delete(id);window.ready=false;
 const renders=[];
 window.MathJax={typesetClear(){},texReset(){},async typesetPromise(elements){for(const element of elements){
   if(!element.classList.contains('math-render-stage'))continue;
   renders.push({width:element.style.width,fontSize:element.style.fontSize,source:element.textContent});
   const output=window.document.createElement('mjx-container');output.textContent=element.textContent;element.replaceChildren(output);
  }}};
 window.eval(await compiled+'\nwindow.applicationEditor=applicationEditor;');
 let application;
 const mount=()=>application=window.applicationEditor.mountApplicationEditor(()=>state.events.push('document.change'));
 t.after(async()=>{try{application?.dispose();}catch{}await window.happyDOM.abort();});
 return {window,state,mount,renders,originalFailure,frames};
}

test('application composes math before its host and measures the mounted prose surface',async t=>{
 const h=await harness(t),app=h.mount();
 assert.deepEqual(h.state.events.slice(0,3),['math.create','host.construct','math.connect']);
 assert.equal(h.state.mathWasMounted,true);assert.equal(h.state.initial,h.state.mathInitial);
 assert.equal(h.state.mount.id,'plateMount');assert.equal(h.state.elements.content,app.host.content,'measurement follows Plate replacing its mount');
 assert.equal(app.host.content.style.maxWidth,'720pt');
 h.window.ready=true;await app.math.render();
 assert.equal(h.renders.length,1);assert.equal(h.renders[0].width,'960px');assert.equal(h.renders[0].fontSize,'20px','outer mount font must not set formula size');
 h.state.contentWidth=800;await app.math.render();
 assert.equal(h.renders.at(-1).width,'800px','the display formula follows the current prose width');
 h.state.events.length=0;app.host.hooks.change();
 assert.deepEqual(h.state.events,['math.change','host.sync','document.change']);
 assert.ok(h.window.sessionStorage.getItem('math-editor-state:'+h.state.sessionId));
 assert.equal(h.window.sessionStorage.getItem('math-editor-state'),null,'application recovery is scoped to the actual document');
});

test('disposing captures a pending composition before releasing math and restores the old loader callback',async t=>{
 const h=await harness(t),app=h.mount(),entry=app.host.entry,input=h.window.document.getElementById('mathInput');
 app.host.hooks.activate(entry.element,entry.model,'end');
 input.dispatchEvent(new h.window.CompositionEvent('compositionstart'));input.value='x文';input.dispatchEvent(new h.window.InputEvent('input',{isComposing:true}));
 assert.equal(app.math.hooks.isComposing(),true);assert.equal(entry.model.exportLatex(),'x','pending composition has not been published');
 h.state.events.length=0;app.dispose();
 assert.deepEqual(h.state.events,['host.destroy','math.dispose']);assert.equal(h.state.composingOnDestroy,true);
 assert.equal(h.state.captured.formulaId,'application-formula');assert.match(h.state.captured.snapshot,/文/);
 assert.equal(h.window.mathjaxLoadFailed,h.originalFailure);assert.equal(h.window.document.querySelector('.command-menu'),null);
 assert.equal(h.frames.size,0);app.dispose();assert.deepEqual(h.state.events,['host.destroy','math.dispose'],'dispose is idempotent');
});

test('host construction and math connection failures release math resources and restore callbacks',async t=>{
 for(const failure of ['constructorFailure','connectFailure']){
  const h=await harness(t,{[failure]:true});
  assert.throws(h.mount,failure==='constructorFailure'?/host construction failed/:/math connection failed/);
  assert.equal(h.state.events.filter(event=>event==='math.dispose').length,1);
  assert.equal(h.state.events.filter(event=>event==='host.destroy').length,failure==='connectFailure'?1:0);
  assert.equal(h.window.document.querySelector('.command-menu'),null);assert.equal(h.window.document.querySelector('.math-font-hint'),null);
  assert.equal(h.window.mathjaxLoadFailed,h.originalFailure);
 }
});

test('host destruction failure still releases math, while a newer loader callback is retained',async t=>{
 const h=await harness(t,{destroyFailure:true}),app=h.mount(),replacement=()=>{};
 h.window.mathjaxLoadFailed=replacement;
 assert.throws(()=>app.dispose(),/host destruction failed/);
 assert.deepEqual(h.state.events.slice(-2),['host.destroy','math.dispose']);assert.equal(h.window.mathjaxLoadFailed,replacement);
 assert.equal(h.window.document.querySelector('.command-menu'),null);app.dispose();
});

test('cleanup failures restore loader callbacks without masking the original mount error',async t=>{
 for(const failure of ['constructorFailure','connectFailure']){
  const h=await harness(t,{[failure]:true,disposeFailure:true,destroyFailure:true});
  assert.throws(h.mount,failure==='constructorFailure'?/host construction failed/:/math connection failed/);
  assert.equal(h.window.mathjaxLoadFailed,h.originalFailure);assert.equal(h.state.events.filter(event=>event==='math.dispose').length,1);
 }
 const h=await harness(t,{disposeFailure:true}),app=h.mount();
 assert.throws(()=>app.dispose(),/math disposal failed/);assert.equal(h.window.mathjaxLoadFailed,h.originalFailure);
 assert.equal(h.window.document.querySelector('.command-menu'),null);
});

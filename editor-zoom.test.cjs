const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {build}=require('esbuild');
const Module=require('node:module');
const path=require('node:path');
const compiled=build({entryPoints:['src/editor-zoom.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).then(result=>{const mod=new Module(path.resolve('.zoom-test.cjs'),module);mod.paths=module.paths;mod._compile(result.outputFiles[0].text,path.resolve('.zoom-test.cjs'));return mod.exports;});

test('zoom accepts documented view levels and rejects invalid saved preferences',async()=>{
  const api=await compiled;
  assert.deepEqual([...api.EDITOR_ZOOM_LEVELS],[50,75,90,100,110,125,150,175,200]);
  for(const value of api.EDITOR_ZOOM_LEVELS){assert.equal(api.isEditorZoom(value),true);assert.equal(api.readEditorZoom({getItem:key=>{assert.equal(key,'editor.zoom');return String(value);}}),value);}
  for(const value of [null,'','NaN','Infinity','0','49','201','83','-100','100.5','null','{"zoom":150}'])assert.equal(api.readEditorZoom({getItem:()=>value}),100,String(value));
  for(const value of [undefined,null,'150',NaN,Infinity,49,201,83,100.5])assert.equal(api.isEditorZoom(value),false);
});

test('zoom writes only its own preference key; storage errors leave a usable view and notification stream',async()=>{
  const api=await compiled,writes=[],events=[],document={value:[{type:'p',children:[{text:'Unchanged α + x²'}]}],dirty:false};
  const before=JSON.stringify(document),storage={setItem(key,value){writes.push([key,value]);}};
  const unsubscribe=api.subscribeEditorZoom(()=>events.push(api.getEditorZoom()));
  assert.equal(api.setEditorZoom(125,storage),true);assert.equal(api.getEditorZoom(),125);assert.deepEqual(writes,[['editor.zoom','125']]);
  assert.equal(api.setEditorZoom(125,storage),true);assert.deepEqual(events,[125],'unchanged zoom does not rerender the document');
  assert.equal(api.setEditorZoom(150,{setItem(){throw Error('Storage denied');}}),false);
  assert.equal(api.getEditorZoom(),150);assert.deepEqual(events,[125,150]);
  assert.equal(api.setEditorZoom('200',storage),false);assert.equal(api.getEditorZoom(),150);
  unsubscribe();api.setEditorZoom(100,storage);assert.deepEqual(events,[125,150]);
  assert.equal(JSON.stringify(document),before);
  assert.equal(api.readEditorZoom({getItem(){throw Error('Storage denied');}}),100);
  assert.equal(api.readEditorZoom(),100,'missing browser storage is safe');
});

test('zoom steps stop at the available endpoints',async()=>{
  const api=await compiled;
  assert.equal(api.nextEditorZoom(50,-1),50);assert.equal(api.nextEditorZoom(200,1),200);
  assert.equal(api.nextEditorZoom(90,1),100);assert.equal(api.nextEditorZoom(100,-1),90);
  assert.equal(api.nextEditorZoom(50,1),75);assert.equal(api.nextEditorZoom(200,-1),175);
});

test('zooming a mounted document leaves content, selection, history and document change notifications untouched',async t=>{
  const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
  window.document.write('<!doctype html><html><body></body></html>');
  const keys=['localStorage','window','document','navigator','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Document','DocumentFragment','MutationObserver','ResizeObserver','DOMParser','Range','Event','CustomEvent','KeyboardEvent','DOMRect','NodeFilter','ShadowRoot','requestAnimationFrame','cancelAnimationFrame','getComputedStyle'];
  const previous=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const key of keys)Object.defineProperty(globalThis,key,{value:key==='window'?window:typeof window[key]==='function'&&['requestAnimationFrame','cancelAnimationFrame','getComputedStyle'].includes(key)?window[key].bind(window):window[key],configurable:true});
  Object.defineProperty(window.Range.prototype,'getBoundingClientRect',{value:undefined,configurable:true});
  const result=await build({loader:{'.css':'empty'},stdin:{contents:`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {flushSync} from 'react-dom';
    import {Plate,PlateContent,createPlateEditor,ParagraphPlugin} from 'platejs/react';
    import {DocumentZoomSurface} from './src/components/ui/document-zoom-surface';
    import {DocumentViewToolbarButtons} from './src/components/ui/document-view-toolbar-buttons';
    import {DocumentZoomControls} from './src/components/ui/document-zoom-controls';
    import {Toolbar} from './src/components/ui/toolbar';
    import {TooltipProvider} from './src/components/ui/tooltip';
    export function mount(container){
      let changes=0;
      const editor=createPlateEditor({plugins:[ParagraphPlugin],value:[{type:'p',children:[{text:'Unchanged α + x²'}]}]});
      const root=createRoot(container);
      flushSync(()=>root.render(<TooltipProvider><Plate editor={editor} onChange={()=>changes++}>
        <aside><Toolbar><DocumentViewToolbarButtons /></Toolbar><div data-math-panel>Math input</div></aside>
        <div className="document-editor-frame">
          <DocumentZoomSurface><header data-metadata>Author</header><PlateContent /><section data-bibliography>References</section></DocumentZoomSurface>
          <footer className="document-editor-footer"><DocumentZoomControls /></footer>
        </div>
      </Plate></TooltipProvider>));
      return {editor,changes:()=>changes,unmount(){root.unmount();}};
    }
  `,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'zoom-i18n',setup(builder){builder.onResolve({filter:/^(?:@\/|\.\.\/\.\.\/)i18n$/},()=>({path:'i18n',namespace:'zoom-test'}));builder.onLoad({filter:/.*/,namespace:'zoom-test'},()=>({contents:'export const t=value=>value;'}));}}]});
  const mod=new Module(path.resolve('.zoom-ui-test.cjs'),module);mod.paths=module.paths;mod._compile(result.outputFiles[0].text,path.resolve('.zoom-ui-test.cjs'));
  const container=document.createElement('div');document.body.append(container);const view=mod.exports.mount(container);
  t.after(async()=>{view.unmount();await window.happyDOM.abort();for(const [key,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
  const tick=()=>new Promise(resolve=>setTimeout(resolve,20));await tick();
  const before={children:JSON.stringify(view.editor.children),selection:JSON.stringify(view.editor.selection),history:JSON.stringify(view.editor.history),changes:view.changes()};
  window.localStorage.setItem('private-document-draft','UNCHANGED');
  const select=container.querySelector('.document-zoom-select');select.value='150';select.dispatchEvent(new window.Event('change',{bubbles:true}));await tick();
  const surface=container.querySelector('.document-zoom-surface');
  assert.equal(surface.style.zoom,'1.5');assert.equal(surface.dataset.editorZoom,'150');
  assert.ok(surface.contains(container.querySelector('[data-slate-editor]')));
  assert.ok(surface.contains(container.querySelector('[data-metadata]')));assert.ok(surface.contains(container.querySelector('[data-bibliography]')));
  assert.equal(surface.contains(container.querySelector('aside')),false);assert.equal(surface.contains(container.querySelector('[data-math-panel]')),false);
  const controls=container.querySelector('.document-zoom-controls');
  assert.ok(container.querySelector('.document-editor-footer').contains(controls),'zoom controls belong to the editor footer');
  assert.equal(surface.contains(controls),false,'zoom controls stay outside the scaled document');
  assert.equal(container.querySelector('aside').contains(controls),false,'zoom controls are separate from the side toolbar');
  assert.equal(window.localStorage.getItem('editor.zoom'),'150');assert.equal(window.localStorage.getItem('private-document-draft'),'UNCHANGED');
  container.querySelector('[aria-label="Reset zoom to 100%"]')?.click();await tick();
  assert.equal(surface.style.zoom,'1');assert.equal(select.value,'100');
  Object.defineProperty(window,'localStorage',{configurable:true,get(){throw Error('Storage denied');}});
  select.value='200';select.dispatchEvent(new window.Event('change',{bubbles:true}));await tick();assert.equal(surface.style.zoom,'2');
  assert.deepEqual({children:JSON.stringify(view.editor.children),selection:JSON.stringify(view.editor.selection),history:JSON.stringify(view.editor.history),changes:view.changes()},before);
});

test('display-formula insertion points stay beside both formula edges at 50–200% zoom',async t=>{
  const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
  window.document.write('<!doctype html><html><body><style>[data-empty-text]{font-size:16px}</style></body></html>');
  const keys=['localStorage','window','document','navigator','Node','Element','HTMLElement','Document','MutationObserver','ResizeObserver','requestAnimationFrame','cancelAnimationFrame','getComputedStyle'];
  const previous=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const key of keys)Object.defineProperty(globalThis,key,{value:key==='window'?window:typeof window[key]==='function'&&['requestAnimationFrame','cancelAnimationFrame','getComputedStyle'].includes(key)?window[key].bind(window):window[key],configurable:true});
  const prototype=window.HTMLElement.prototype;
  for(const [name,amount] of [['clientLeft',1],['clientTop',2],['scrollLeft',7],['scrollTop',11]])
    Object.defineProperty(prototype,name,{configurable:true,get(){return this.matches('[data-coordinate-origin]')?amount:0;},set(){}});
  Object.defineProperty(prototype,'offsetParent',{configurable:true,get(){return this.closest('[data-coordinate-origin]');}});
  prototype.getBoundingClientRect=function(){
    const zoom=Number(this.closest('[data-editor-zoom]')?.dataset.editorZoom??100)/100;
    const x=this.matches('.boundary-start')?20:this.matches('.boundary-end')?140:0;
    const y=this.matches('.boundary-start,.boundary-end')?30:0;
    const width=this.matches('.boundary-start,.boundary-end')?2:300;
    const height=this.matches('.boundary-start,.boundary-end')?40:100;
    return new window.DOMRect(40+x*zoom,80+y*zoom,width*zoom,height*zoom);
  };
  const result=await build({stdin:{contents:`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {flushSync} from 'react-dom';
    import {DisplayBoundaryText} from './src/display-boundary-text';
    import {getEditorZoom,setEditorZoom,subscribeEditorZoom} from './src/editor-zoom';
    export {setEditorZoom};
    function Surface({children}){
      const zoom=React.useSyncExternalStore(subscribeEditorZoom,getEditorZoom,()=>100);
      return <div className="document-zoom-surface" data-editor-zoom={zoom} style={{zoom:zoom/100}}>{children}</div>;
    }
    export function mount(container){
      const root=createRoot(container);
      flushSync(()=>root.render(<Surface><article data-coordinate-origin style={{position:'relative'}}>
        <DisplayBoundaryText attributes={{'data-boundary-text':'before'} as any} text={{text:''}}><span /></DisplayBoundaryText>
        <div className="math-block-node"><span className="boundary-start" /><span className="boundary-end" /></div>
        <DisplayBoundaryText attributes={{'data-boundary-text':'after'} as any} text={{text:''}}><span /></DisplayBoundaryText>
      </article></Surface>));
      return ()=>root.unmount();
    }`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',define:{'process.env.NODE_ENV':'"production"'}});
  const mod=new Module(path.resolve('.zoom-boundary-test.cjs'),module);mod.paths=module.paths;mod._compile(result.outputFiles[0].text,path.resolve('.zoom-boundary-test.cjs'));
  const container=document.createElement('div');document.body.append(container);const unmount=mod.exports.mount(container);
  t.after(async()=>{unmount();await window.happyDOM.abort();for(const [key,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
  const before=container.querySelector('[data-boundary-text="before"]'),after=container.querySelector('[data-boundary-text="after"]');
  for(const zoom of [50,100,150,200,75,100]){
    mod.exports.setEditorZoom(zoom);await new Promise(resolve=>setTimeout(resolve,35));
    assert.equal(before.style.left,'23px',`before edge at ${zoom}% is positioned in unscaled document coordinates`);
    assert.equal(after.style.left,'148px',`after edge at ${zoom}% is positioned in unscaled document coordinates`);
    assert.ok(Math.abs(parseFloat(before.style.top)-49.4)<.001,`before edge baseline at ${zoom}%`);
    assert.ok(Math.abs(parseFloat(after.style.top)-49.4)<.001,`after edge baseline at ${zoom}%`);
  }
});

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');

const workerFlag='--gutter-selection-worker';
if(process.argv.includes(workerFlag)){
  void exerciseGutters().then(()=>process.exit(0),error=>{console.error(String(error.stack||error).slice(0,3000));process.exit(1);});
}else{
  test('full EditorKit gutters avoid desktop selection subscriptions and preserve narrow-screen, selection and drag feedback',{timeout:120000},()=>{
    const result=spawnSync(process.execPath,[__filename,workerFlag],{cwd:__dirname,encoding:'utf8',timeout:115000,maxBuffer:2*1024*1024});
    const output=(result.stdout||'')+(result.stderr||'');
    assert.equal(result.error,undefined,output);assert.equal(result.status,0,output);
    for(const marker of ['DESKTOP_NO_GUTTER_SELECTION_SUBSCRIPTIONS','NARROW_GUTTER_SELECTION','BLOCK_SELECTION_AND_DROP_FEEDBACK','SHARED_MEDIA_LISTENER_CLEANUP'])assert.match(output,new RegExp(marker));
  });
}

async function exerciseGutters(){
  const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{build}=require('esbuild');
  const {Window}=await import('happy-dom');const window=new Window({url:'http://localhost/'});
  window.document.write('<!doctype html><html><body></body></html>');
  const globals=['innerWidth','innerHeight','window','document','navigator','location','history','sessionStorage','localStorage',
    'Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Document','DocumentFragment','MutationObserver',
    'ResizeObserver','DOMParser','Range','Event','CustomEvent','KeyboardEvent','ClipboardEvent','DOMRect','HTMLDivElement',
    'HTMLSpanElement','NodeFilter','ShadowRoot','HTMLCollection','NodeList','HTMLButtonElement','HTMLImageElement','PointerEvent','Selection','CSS'];
  const methods=['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'];
  const descriptors=new Map([...globals,...methods].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const key of globals)Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
  for(const key of methods)Object.defineProperty(globalThis,key,{value:window[key].bind(window),configurable:true});
  const diagnostics=path.resolve(__dirname,'diagnostics');fs.mkdirSync(diagnostics,{recursive:true});
  const directory=fs.mkdtempSync(path.join(diagnostics,'gutter-selection-test-'));
  let wide=true,mediaQueries=0,peakMediaListeners=0,selectedSubscriptions=0,selectedRenders=0;
  const mediaListeners=new Set(),nativeMatchMedia=window.matchMedia.bind(window);
  const query={get matches(){return wide;},media:'(min-width: 40rem)',
    addEventListener:(event,listener)=>{assert.equal(event,'change');mediaListeners.add(listener);peakMediaListeners=Math.max(peakMediaListeners,mediaListeners.size);},
    removeEventListener:(event,listener)=>{assert.equal(event,'change');mediaListeners.delete(listener);}};
  window.matchMedia=media=>media===query.media?(mediaQueries++,query):nativeMatchMedia(media);
  globalThis.__gutterSelectionProbe=kind=>{
    if(kind==='subscribe')selectedSubscriptions++;
    else if(kind==='unsubscribe')selectedSubscriptions--;
    else selectedRenders++;
  };
  const redundantContextCalls=[];
  globalThis.__blockChromeEditorProbe=stack=>{
    if(/at (?:Gutter(?:View)?|SelectedGutter|DragHandle|DropLine|BlockSelection)\b/.test(stack))redundantContextCalls.push(stack);
  };
  let host;
  const renderErrors=[];
  const originalError=console.error;
  console.error=(...values)=>originalError(...values.map(value=>String(value?.stack||value).slice(0,1600)));
  try{
    let selectedInstrumented=false,editorInstrumented=false;
    await build({stdin:{contents:`
export {PlateMathHost} from './src/plate-host';
export {EditorModel} from './src/editor-model';
export {draftStorage} from './src/platform';
export {BlockSelectionPlugin} from '@platejs/selection/react';
export {DndPlugin} from '@platejs/dnd';
export {flushSync} from 'react-dom';
`,resolveDir:__dirname,loader:'ts'},bundle:true,platform:'browser',alias:{path:'path-browserify'},format:'esm',splitting:true,outdir:directory,
      outExtension:{'.js':'.mjs'},entryNames:'entry',external:['yjs'],conditions:['production'],define:{'process.env.NODE_ENV':'"production"'},
      plugins:[{name:'real-selection-subscription-observer',setup(b){
        b.onResolve({filter:/\.css$/},args=>({path:args.path,namespace:'empty-css'}));
        b.onLoad({filter:/.*/,namespace:'empty-css'},()=>({contents:'export default {};',loader:'js'}));
        b.onLoad({filter:/[\\/]slate-react[\\/]dist[\\/]index(?:\.es)?\.js$/},args=>{
          const source=fs.readFileSync(args.path,'utf8');
          const contents=source.replace(/(const useSelected = \(\{[\s\S]*?\} = \{\}\) => \{|var useSelected = function useSelected\(\) \{)/,`$1
globalThis.__gutterSelectionProbe?.('render');
React.useEffect(()=>{globalThis.__gutterSelectionProbe?.('subscribe');return()=>globalThis.__gutterSelectionProbe?.('unsubscribe');},[]);`);
          assert.notEqual(contents,source,'observe real Slate selection hooks');selectedInstrumented=true;
          return {contents,loader:'js'};
        });
        b.onLoad({filter:/[\\/]@platejs[\\/]core[\\/]dist[\\/]react[\\/]index\.js$/},args=>{
          const source=fs.readFileSync(args.path,'utf8');
          const contents=source.replace('const useEditorRef = (id) => {','const useEditorRef = (id) => {\n globalThis.__blockChromeEditorProbe?.(new Error().stack);');
          assert.notEqual(contents,source,'observe actual editor context hooks');editorInstrumented=true;
          return {contents,loader:'js'};
        });
      }}]});
    assert.ok(selectedInstrumented&&editorInstrumented);
    const {PlateMathHost,EditorModel,draftStorage,BlockSelectionPlugin,DndPlugin,flushSync}=await import(pathToFileURL(path.join(directory,'entry.mjs')).href);
    window.addEventListener('vulgar-document-render-error',event=>renderErrors.push(event.detail));
    const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
    const resize=async desktop=>{flushSync(()=>{wide=desktop;for(const listener of mediaListeners)listener();});await tick();};
    draftStorage().clear();
    draftStorage().setItem('math-plate-document-v1',JSON.stringify({version:1,value:Array.from({length:120},(_,i)=>({type:'p',id:'paragraph-'+i,children:[{text:'Ordinary prose '+i}]}))}));
    const mount=document.createElement('div');document.body.append(mount);
    host=new PlateMathHost(mount,new EditorModel(),{activate(){},leave(){},change(){}});
    await tick();const editor=host.editor;
    const rootBlock=id=>mount.querySelector(`[data-root-block-id="${id}"]`);
    const gutter=id=>rootBlock(id).parentElement.querySelector('.slate-gutterLeft');
    const overlay=id=>rootBlock(id).querySelector('[data-slot="block-selection"]');
    assert.equal(mount.querySelectorAll('.slate-gutterLeft').length,120);
    assert.equal(selectedSubscriptions,0);assert.equal(selectedRenders,0);
    assert.equal(mediaQueries,1);assert.equal(mediaListeners.size,1);
    editor.tf.select(editor.api.end([60]));await tick();
    for(const letter of 'abc'){editor.tf.insertText(letter);await tick();}
    assert.equal(selectedSubscriptions,0);assert.equal(selectedRenders,0,'typing never mounts a desktop gutter selection hook');
    assert.equal(redundantContextCalls.length,0,'block chrome consumes its supplied editor instead of subscribing to it again');
    assert.ok(gutter('paragraph-60').classList.contains('hover:opacity-100'));
    assert.ok(gutter('paragraph-60').classList.contains('group-hover:opacity-100'));
    assert.ok(gutter('paragraph-60').classList.contains('opacity-0'));
    console.log('DESKTOP_NO_GUTTER_SELECTION_SUBSCRIPTIONS');

    await resize(false);
    assert.equal(selectedSubscriptions,120);
    assert.equal(gutter('paragraph-60').classList.contains('opacity-0'),false,'narrow-screen selected paragraph keeps its visible handle');
    assert.equal(gutter('paragraph-59').classList.contains('opacity-0'),true);
    editor.tf.select(editor.api.end([61]));await tick();
    assert.equal(gutter('paragraph-60').classList.contains('opacity-0'),true);
    assert.equal(gutter('paragraph-61').classList.contains('opacity-0'),false);
    editor.tf.select({anchor:{path:[59,0],offset:0},focus:{path:[61,0],offset:2}});await tick();
    for(const id of ['paragraph-59','paragraph-60','paragraph-61'])assert.equal(gutter(id).classList.contains('opacity-0'),false);
    await resize(true);assert.equal(selectedSubscriptions,0);
    assert.equal(mediaListeners.size,1);assert.equal(peakMediaListeners,1);
    console.log('NARROW_GUTTER_SELECTION');

    flushSync(()=>editor.getApi(BlockSelectionPlugin).blockSelection.set(['paragraph-10','paragraph-11']));await tick();
    assert.ok(overlay('paragraph-10')?.classList.contains('opacity-100'));assert.ok(overlay('paragraph-11')?.classList.contains('opacity-100'));
    assert.equal(overlay('paragraph-12'),null);
    flushSync(()=>editor.setOption(DndPlugin,'isDragging',true));await tick();
    assert.ok(overlay('paragraph-10').classList.contains('opacity-0'),'dragging still hides the selected block overlay');
    flushSync(()=>editor.setOption(DndPlugin,'dropTarget',{id:'paragraph-12',line:'top'}));await tick();
    assert.ok(rootBlock('paragraph-12').querySelector('.slate-dropLine.-top-px'));
    assert.equal(rootBlock('paragraph-11').querySelector('.slate-dropLine'),null);
    flushSync(()=>editor.setOption(DndPlugin,'dropTarget',{id:'paragraph-12',line:'bottom'}));await tick();
    assert.ok(rootBlock('paragraph-12').querySelector('.slate-dropLine.-bottom-px'));
    flushSync(()=>editor.setOption(DndPlugin,'dropTarget',{id:'paragraph-12',line:'left'}));await tick();
    assert.equal(rootBlock('paragraph-12').querySelector('.slate-dropLine'),null,'vertical block drags ignore horizontal drop indicators');
    flushSync(()=>{editor.setOption(DndPlugin,'isDragging',false);editor.setOption(DndPlugin,'dropTarget',null);});await tick();
    assert.ok(overlay('paragraph-10').classList.contains('opacity-100'));
    flushSync(()=>editor.setOption(BlockSelectionPlugin,'isSelectionAreaVisible',true));await tick();
    assert.ok(gutter('paragraph-10').classList.contains('hidden'));
    flushSync(()=>{editor.setOption(BlockSelectionPlugin,'isSelectionAreaVisible',false);editor.getApi(BlockSelectionPlugin).blockSelection.deselect();});await tick();
    assert.equal(overlay('paragraph-10'),null);assert.equal(gutter('paragraph-10').classList.contains('hidden'),false);
    assert.deepEqual(renderErrors,[]);console.log('BLOCK_SELECTION_AND_DROP_FEEDBACK');
    host.destroy();mount.remove();host=null;await tick();
    assert.equal(selectedSubscriptions,0);assert.equal(mediaListeners.size,0);
    console.log('SHARED_MEDIA_LISTENER_CLEANUP');
  }finally{
    if(host){host.editor.tf.deselect();host.destroy();}
    await window.happyDOM.cancelAsync();console.error=originalError;
    delete globalThis.__gutterSelectionProbe;delete globalThis.__blockChromeEditorProbe;
    for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
    const resolved=path.resolve(directory);assert.ok(resolved.startsWith(diagnostics+path.sep),'cleanup stays inside diagnostics');fs.rmSync(resolved,{recursive:true,force:true});
  }
}

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');

const workerFlag='--gutter-selection-worker';
if(process.argv.includes(workerFlag)){
  void exerciseGutters().then(()=>process.exit(0),error=>{console.error(String(error.stack||error).slice(0,3000));process.exit(1);});
}else{
  test('full EditorKit selects paragraphs without mounting drag handles or per-paragraph Slate selection hooks',{timeout:120000},()=>{
    const result=spawnSync(process.execPath,[__filename,workerFlag],{cwd:__dirname,encoding:'utf8',timeout:115000,maxBuffer:2*1024*1024});
    const output=(result.stdout||'')+(result.stderr||'');
    assert.equal(result.error,undefined,output);assert.equal(result.status,0,output);
    for(const marker of ['NO_PARAGRAPH_DRAG_HANDLES','BLOCK_SELECTION_WITHOUT_DRAG_HANDLES'])assert.match(output,new RegExp(marker));
  });
}

async function exerciseGutters(){
  const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{build}=require('esbuild');
  const {Window}=await import('happy-dom');const window=new Window({url:'http://localhost/'});
  window.document.write('<!doctype html><html><body></body></html>');
  // A touchscreen laptop can also have a mouse attached.
  Object.defineProperty(window.navigator,'maxTouchPoints',{value:10});
  const matchMedia=window.matchMedia.bind(window);
  window.matchMedia=query=>{
    const result=matchMedia(query);
    if(query==='(pointer: coarse)'||query==='(any-pointer: fine)')
      Object.defineProperty(result,'matches',{value:true});
    return result;
  };
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
  let selectedSubscriptions=0,selectedRenders=0;
  globalThis.__gutterSelectionProbe=kind=>{
    if(kind==='subscribe')selectedSubscriptions++;
    else if(kind==='unsubscribe')selectedSubscriptions--;
    else selectedRenders++;
  };
  const redundantContextCalls=[];
  globalThis.__blockChromeEditorProbe=stack=>{
    if(/at BlockSelection\b/.test(stack))redundantContextCalls.push(stack);
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
    const {PlateMathHost,EditorModel,draftStorage,BlockSelectionPlugin,flushSync}=await import(pathToFileURL(path.join(directory,'entry.mjs')).href);
    window.addEventListener('vulgar-document-render-error',event=>renderErrors.push(event.detail));
    const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
    draftStorage().clear();
    draftStorage().setItem('math-plate-document-v1',JSON.stringify({version:1,value:Array.from({length:120},(_,i)=>({type:'p',id:'paragraph-'+i,children:[{text:'Ordinary prose '+i}]}))}));
    const mount=document.createElement('div');document.body.append(mount);
    host=new PlateMathHost(mount,new EditorModel(),{activate(){},leave(){},change(){}});
    await tick();const editor=host.editor;
    const paragraph=index=>editor.api.toDOMNode(editor.children[index]);
    const overlay=index=>paragraph(index).querySelector('[data-slot="block-selection"]');
    const setViewport=async width=>{
      window.happyDOM.setWindowSize({width,height:800});
      await tick();
      assert.equal(mount.querySelector('.slate-gutterLeft, .slate-dropLine, .slate-blockToolbar'),null);
      assert.equal(selectedSubscriptions,0);
    };
    for(const width of [1280,480]){
      await setViewport(width);
      editor.tf.select(editor.api.end([60]));
      editor.tf.insertText('a');await tick();
      assert.equal(selectedRenders,0);
    }
    assert.equal(editor.children[60].children[0].text,'Ordinary prose 60aa');
    assert.equal(redundantContextCalls.length,0);
    console.log('NO_PARAGRAPH_DRAG_HANDLES');

    const rightClick=(index,shiftKey=false)=>paragraph(index).querySelector('[data-slate-string]')
      .dispatchEvent(new window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,shiftKey}));
    flushSync(()=>rightClick(10));await tick();
    assert.ok(mount.querySelector('[data-slot="context-menu-trigger"]'));
    assert.ok(document.querySelector('[role="menu"]'),'mouse opens the block menu on a touchscreen laptop');
    flushSync(()=>rightClick(11,true));await tick();
    const blocks=editor.getApi(BlockSelectionPlugin).blockSelection;
    assert.deepEqual(blocks.getNodes({sort:true}).map(([node])=>node.id),['paragraph-10','paragraph-11']);
    for(const index of [10,11])assert.ok(overlay(index)?.classList.contains('opacity-100'));
    assert.equal(overlay(12),null);
    flushSync(()=>blocks.deselect());await tick();
    assert.equal(overlay(10),null);assert.equal(overlay(11),null);
    editor.tf.select({anchor:{path:[59,0],offset:8},focus:{path:[60,0],offset:8}});
    assert.equal(editor.api.string(editor.selection),' prose 59Ordinary');
    editor.tf.insertText(' + ');await tick();
    assert.equal(editor.children[59].children[0].text,'Ordinary +  prose 60aa');
    assert.equal(editor.api.isCollapsed(),true);
    assert.deepEqual(renderErrors,[]);
    console.log('BLOCK_SELECTION_WITHOUT_DRAG_HANDLES');
  }finally{
    if(host){host.editor.tf.deselect();host.destroy();}
    await window.happyDOM.cancelAsync();console.error=originalError;
    delete globalThis.__gutterSelectionProbe;delete globalThis.__blockChromeEditorProbe;
    for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
    const resolved=path.resolve(directory);assert.ok(resolved.startsWith(diagnostics+path.sep),'cleanup stays inside diagnostics');fs.rmSync(resolved,{recursive:true,force:true});
  }
}

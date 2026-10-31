const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');

const workerFlag='--collaboration-bootstrap-worker';
if(process.argv.includes(workerFlag)){
  // The complete kit keeps React/Plate stores and timers. Each build variant
  // runs in its own process so a deliberate broken fixture cannot poison the
  // next editor or turn an expected React error into a test-runner exception.
  void exerciseBootstrap(process.argv.includes('--without-deselect')).then(
    ()=>process.exit(0),
    error=>{console.error(String(error.stack||error).slice(0,1800));process.exit(1);},
  );
}else{
  const run=broken=>spawnSync(process.execPath,[__filename,workerFlag,...(broken?['--without-deselect']:[])],{
    cwd:__dirname,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024,
  });
  test('the complete editor can host a freshly inserted inline formula and query toolbar marks safely',{timeout:65000},()=>{
    const result=run(false),output=(result.stdout||'')+(result.stderr||'');
    assert.equal(result.error,undefined,output);assert.equal(result.status,0,output);
    assert.match(output,/BOOTSTRAP_MARKS_OK/);
  });
  test('the same full-kit fixture detects the stale caret when only the connect deselect is removed',{timeout:65000},()=>{
    const result=run(true),output=(result.stdout||'')+(result.stderr||'');
    assert.equal(result.error,undefined,output);assert.equal(result.status,1,output);
    assert.match(output,/BOOTSTRAP_CAUGHT_STALE_SELECTION/);
  });
}

async function exerciseBootstrap(broken){
  const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{build}=require('esbuild');
  const {Window}=await import('happy-dom');
  const window=new Window({url:'http://localhost/'});
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
  const directory=fs.mkdtempSync(path.join(diagnostics,'collaboration-bootstrap-'));
  let host,originalStart,Session;
  const originalError=console.error;
  console.error=(...values)=>originalError(...values.map(value=>String(value?.stack||value).slice(0,1600)));
  try{
    let stripped=false;
    await build({stdin:{contents:"export {PlateMathHost} from './src/plate-host';export {DocumentCollaborationSession} from './src/collaboration-session';export {EditorModel} from './src/editor-model';export {draftStorage} from './src/platform';",resolveDir:__dirname,loader:'ts'},
      bundle:true,platform:'browser',alias:{path:'path-browserify'},format:'esm',splitting:true,outdir:directory,
      outExtension:{'.js':'.mjs'},entryNames:'entry',external:['yjs'],conditions:['production'],define:{'process.env.NODE_ENV':'"production"'},
      plugins:[{name:'bootstrap-fixture',setup(build){
        // Styles do not affect selection/marks. Keep every real EditorKit
        // plugin and component, including the table marks wrapper and toolbar.
        build.onResolve({filter:/\.css$/},args=>({path:args.path,namespace:'empty-css'}));
        build.onLoad({filter:/.*/,namespace:'empty-css'},()=>({contents:'export default {};',loader:'js'}));
        if(broken)build.onLoad({filter:/[\\/]collaboration-prose\.ts$/},args=>{
          const source=fs.readFileSync(args.path,'utf8');
          const fixture=source.replace(/^\s*this\.editor\.tf\.deselect\(\);\r?\n(?=\s*YjsEditor\.connect\(this\.bound\))/m,'');
          assert.notEqual(fixture,source,'the regression fixture must remove exactly the connect deselect');
          stripped=true;return {contents:fixture,loader:'ts'};
        });
      }}],
    });
    if(broken)assert.equal(stripped,true);
    const exports=await import(pathToFileURL(path.join(directory,'entry.mjs')).href);
    const {PlateMathHost,DocumentCollaborationSession,EditorModel,draftStorage}=exports;
    Session=DocumentCollaborationSession;originalStart=Session.prototype.start;
    Session.prototype.start=function(creator){
      // No network or shared-document shortcut: exercise actual host/session,
      // prose binding, native formula hydration, React renders and selectors.
      this.options.transportFactory=()=>({peerId:'bootstrap-host',role:creator?'host':'guest',
        getState:()=>({available:true,peers:[]}),subscribe:()=>()=>{},onMessage:()=>()=>{},send:()=>false,destroy(){}});
      return originalStart.call(this,creator);
    };
    const tick=()=>new Promise(resolve=>setTimeout(resolve,15)),renderErrors=[];
    window.addEventListener('vulgar-document-render-error',event=>renderErrors.push(event.detail));
    draftStorage().clear();const mount=document.createElement('div');document.body.append(mount);
    host=new PlateMathHost(mount,new EditorModel(),{activate(){},leave(){},change(){},isComposing:()=>false});
    host.editor.tf.insertText('Main manuscript · ',{at:{path:[0,0],offset:0}});await tick();
    const inserted=host.insertFormula(false),id=inserted.element.dataset.mathId;
    inserted.model.insert('x');host.syncMath();host.exit(inserted.element,1);await tick();
    assert.ok(host.editor.selection,'the new formula must leave a real body caret before hosting');
    await host.startCollaboration();
    try{
      // This is the same API used by FontSizeToolbarButton; the complete
      // TableKit's marks wrapper remains installed in this test.
      host.editor.api.marks();
    }catch(error){
      console.log('BOOTSTRAP_CAUGHT_STALE_SELECTION');throw error;
    }
    await tick();host.editor.api.marks();
    assert.deepEqual(renderErrors,[]);assert.equal(host.getCollaborationState().writable,true);
    assert.ok(document.getElementById('textFlow'));assert.equal(host.models.get(id).exportLatex(),'x');
    console.log('BOOTSTRAP_MARKS_OK');
  }finally{
    // A broken fixture can leave React's pending-marks timer with the same bad
    // path. Clear it before ordinary host/DOM teardown, never in product code.
    if(host){host.editor.tf.deselect();host.destroy();}
    if(Session&&originalStart)Session.prototype.start=originalStart;
    await window.happyDOM.cancelAsync();console.error=originalError;
    for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
    const resolved=path.resolve(directory);
    assert.ok(resolved.startsWith(diagnostics+path.sep),'cleanup must stay inside the diagnostic workspace');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
}

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');

const workerFlag='--toggle-performance-worker';
if(process.argv.includes(workerFlag)){
  void exerciseToggles().then(()=>process.exit(0),error=>{console.error(String(error.stack||error).slice(0,2400));process.exit(1);});
}else{
  test('the complete EditorKit skips plain-text toggle subscriptions and preserves nested toggle visibility',{timeout:100000},()=>{
    const result=spawnSync(process.execPath,[__filename,workerFlag],{cwd:__dirname,encoding:'utf8',timeout:95000,maxBuffer:2*1024*1024});
    const output=(result.stdout||'')+(result.stderr||'');
    assert.equal(result.error,undefined,output);assert.equal(result.status,0,output);
    for(const marker of ['PLAIN_PROSE_NO_NATIVE_TOGGLE_RENDERS','NESTED_TOGGLE_VISIBILITY','OUTDENT_MOVE_UNDO_REDO','NEGATIVE_INDENT_NORMALIZED'])assert.match(output,new RegExp(marker));
  });
}

async function exerciseToggles(){
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
  const directory=fs.mkdtempSync(path.join(diagnostics,'toggle-performance-test-'));
  const renders=new Map(),renderErrors=[];
  globalThis.__nativeToggleProbe=id=>renders.set(id,(renders.get(id)??0)+1);
  let host;
  const originalError=console.error;
  console.error=(...values)=>originalError(...values.map(value=>String(value?.stack||value).slice(0,1600)));
  try{
    let instrumented=false;
    await build({stdin:{contents:`
export {PlateMathHost} from './src/plate-host';
export {EditorModel} from './src/editor-model';
export {draftStorage} from './src/platform';
export {TogglePlugin} from '@platejs/toggle/react';
export {indent,outdent} from '@platejs/indent';
export {flushSync} from 'react-dom';
`,resolveDir:__dirname,loader:'ts'},bundle:true,platform:'browser',alias:{path:'path-browserify'},format:'esm',splitting:true,outdir:directory,
      outExtension:{'.js':'.mjs'},entryNames:'entry',external:['yjs'],conditions:['production'],define:{'process.env.NODE_ENV':'"production"'},
      plugins:[{name:'native-toggle-render-observer',setup(b){
        b.onResolve({filter:/\.css$/},args=>({path:args.path,namespace:'empty-css'}));
        b.onLoad({filter:/.*/,namespace:'empty-css'},()=>({contents:'export default {};',loader:'js'}));
        b.onLoad({filter:/[\\/]@platejs[\\/]toggle[\\/]dist[\\/]react[\\/]index\.js$/},args=>{
          const source=fs.readFileSync(args.path,'utf8');
          const contents=source.replace('const ToggleAboveNodes = (t0) => {','const ToggleAboveNodes = (t0) => {\n globalThis.__nativeToggleProbe?.(t0.element.id);');
          assert.notEqual(contents,source,'observe the actual installed native ToggleAboveNodes component');instrumented=true;
          return {contents,loader:'js'};
        });
      }}]});
    assert.equal(instrumented,true);
    const {PlateMathHost,EditorModel,draftStorage,TogglePlugin,indent,outdent,flushSync}=await import(pathToFileURL(path.join(directory,'entry.mjs')).href);
    window.addEventListener('vulgar-document-render-error',event=>renderErrors.push(event.detail));
    const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
    const setup=async value=>{
      if(host){host.editor.tf.deselect();host.destroy();host.mount.remove();}
      draftStorage().clear();renders.clear();
      const nodes=typeof value==='number'?Array.from({length:value},(_,i)=>({type:'p',id:'paragraph-'+i,children:[{text:'Synthetic paragraph '+i+' with ordinary prose.'}]})):value;
      draftStorage().setItem('math-plate-document-v1',JSON.stringify({version:1,value:nodes}));
      const mount=document.createElement('div');document.body.append(mount);
      host=new PlateMathHost(mount,new EditorModel(),{activate(){},leave(){},change(){}});
      await tick();return host.editor;
    };
    const pathOf=(editor,id)=>{const index=editor.children.findIndex(node=>node.id===id);assert.ok(index>=0,id+' remains in the document');return [index];};
    const domOf=(editor,id)=>editor.api.toDOMNode(editor.children[pathOf(editor,id)[0]]);
    const isVisible=(editor,id)=>{
      let element=domOf(editor,id);assert.ok(element&&element.isConnected,id+' has mounted DOM');
      while(element&&element!==host.mount){if(element.style?.visibility==='hidden')return false;element=element.parentElement;}
      return true;
    };
    const expectVisible=(editor,expected)=>{for(const [id,visible] of Object.entries(expected))assert.equal(isVisible(editor,id),visible,id+' native wrapper visibility');};
    const toggleButton=async(editor,id)=>{
      const button=domOf(editor,id).querySelector('button');assert.ok(button,id+' has its real toggle button');
      button.click();await tick();
    };

    let editor=await setup(200);
    assert.equal(renders.size,0,'ordinary unindented prose mounts no native visibility subscription');
    editor.tf.select(editor.api.end([100]));await tick();renders.clear();
    for(const character of 'abcde'){editor.tf.insertText(character);await tick();}
    assert.equal(renders.size,0,'typing does not mount native ToggleAboveNodes for any plain paragraph');
    assert.match(editor.api.string([100]),/abcde$/);assert.deepEqual(renderErrors,[]);
    console.log('PLAIN_PROSE_NO_NATIVE_TOGGLE_RENDERS');

    editor=await setup(5);
    flushSync(()=>editor.tf.withNewBatch(()=>{
      editor.tf.setNodes({type:'toggle'},{at:[0]});
      indent(editor,{getNodesOptions:{at:[1]}});
      editor.tf.setNodes({type:'toggle'},{at:[2]});indent(editor,{getNodesOptions:{at:[2]}});
      indent(editor,{getNodesOptions:{at:[3]}});indent(editor,{getNodesOptions:{at:[3]}});
    }));await tick();assert.deepEqual(renderErrors,[],'building nested toggle nodes keeps the full editor mounted');
    expectVisible(editor,{'paragraph-0':true,'paragraph-1':false,'paragraph-2':false,'paragraph-3':false,'paragraph-4':true});
    assert.ok(renders.has('paragraph-1')&&renders.has('paragraph-2')&&renders.has('paragraph-3'),'indented blocks still mount the original native renderer');
    assert.equal(renders.has('paragraph-0'),false,'a top-level toggle itself cannot be inside another toggle');
    await toggleButton(editor,'paragraph-0');
    expectVisible(editor,{'paragraph-0':true,'paragraph-1':true,'paragraph-2':true,'paragraph-3':false,'paragraph-4':true});
    await toggleButton(editor,'paragraph-2');expectVisible(editor,{'paragraph-1':true,'paragraph-2':true,'paragraph-3':true});
    await toggleButton(editor,'paragraph-0');expectVisible(editor,{'paragraph-1':false,'paragraph-2':false,'paragraph-3':false});
    await toggleButton(editor,'paragraph-0');expectVisible(editor,{'paragraph-1':true,'paragraph-2':true,'paragraph-3':true});
    assert.equal(editor.getOptions(TogglePlugin).openIds.has('paragraph-2'),true,'opening the parent retains the nested toggle state');
    console.log('NESTED_TOGGLE_VISIBILITY');

    await toggleButton(editor,'paragraph-0');
    flushSync(()=>editor.tf.withNewBatch(()=>{outdent(editor,{getNodesOptions:{at:pathOf(editor,'paragraph-3')}});outdent(editor,{getNodesOptions:{at:pathOf(editor,'paragraph-3')}});}));await tick();
    expectVisible(editor,{'paragraph-1':false,'paragraph-2':false,'paragraph-3':true});
    editor.tf.undo();await tick();assert.equal(isVisible(editor,'paragraph-3'),false,'undoing outdent restores enclosing toggle visibility');
    editor.tf.redo();await tick();assert.equal(isVisible(editor,'paragraph-3'),true);
    editor.tf.withNewBatch(()=>editor.tf.moveNodes({at:pathOf(editor,'paragraph-1'),to:[0]}));await tick();
    assert.equal(isVisible(editor,'paragraph-1'),true,'dragging an indented paragraph before its toggle removes its enclosing owner');
    editor.tf.undo();await tick();assert.equal(isVisible(editor,'paragraph-1'),false,'undo restores the native owner relation');
    editor.tf.redo();await tick();assert.equal(isVisible(editor,'paragraph-1'),true);
    editor.tf.withNewBatch(()=>editor.tf.setNodes({type:'p'},{at:pathOf(editor,'paragraph-0')}));await tick();
    assert.equal(isVisible(editor,'paragraph-2'),true,'converting the enclosing toggle back to prose releases its nested heading');
    editor.tf.undo();await tick();assert.equal(isVisible(editor,'paragraph-2'),false,'undoing conversion restores the closed toggle');
    console.log('OUTDENT_MOVE_UNDO_REDO');

    editor=await setup([
      {type:'toggle',id:'negative-toggle',indent:-1,children:[{text:'Invalid imported indentation'}]},
      {type:'p',id:'plain-after-negative',children:[{text:'This remains visible.'}]},
      {type:'p',id:'negative-paragraph',indent:-2,children:[{text:'Also normalized.'}]},
    ]);
    for(const node of editor.children)assert.ok((node.indent??0)>=0,'negative indentation is normalized before toggle ownership is computed');
    expectVisible(editor,{'negative-toggle':true,'plain-after-negative':true,'negative-paragraph':true});
    assert.equal(renders.size,0,'normalized unindented blocks have no visibility subscription');
    assert.deepEqual(renderErrors,[]);
    console.log('NEGATIVE_INDENT_NORMALIZED');

    editor=await setup([
      {type:'toggle',id:'before-list',children:[{text:'Closed toggle'}]},
      {type:'p',id:'top-level-list',indent:1,listStyleType:'disc',children:[{text:'A level-one list item has corrected indentation zero.'}]},
      {type:'p',id:'after-list',children:[{text:'Outside the toggle.'}]},
    ]);
    assert.equal(isVisible(editor,'top-level-list'),true,'native list correction keeps a top-level list outside the toggle');
    assert.equal(renders.has('top-level-list'),false,'list correction also avoids an unnecessary native subscription');
    assert.deepEqual(renderErrors,[]);
  }finally{
    if(host){host.editor.tf.deselect();host.destroy();}
    await window.happyDOM.cancelAsync();console.error=originalError;delete globalThis.__nativeToggleProbe;
    for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
    const resolved=path.resolve(directory);assert.ok(resolved.startsWith(diagnostics+path.sep),'cleanup stays inside diagnostics');fs.rmSync(resolved,{recursive:true,force:true});
  }
}

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');

const workerFlag='--block-discussion-performance-worker';
if(process.argv.includes(workerFlag)){
  void exerciseDiscussions().then(()=>process.exit(0),error=>{console.error(String(error.stack||error).slice(0,2400));process.exit(1);});
}else{
  test('the complete EditorKit skips unrelated discussion renders and retains draft, comment and suggestion updates',{timeout:120000},()=>{
    const result=spawnSync(process.execPath,[__filename,workerFlag],{cwd:__dirname,encoding:'utf8',timeout:115000,maxBuffer:2*1024*1024});
    const output=(result.stdout||'')+(result.stderr||'');
    assert.equal(result.error,undefined,output);assert.equal(result.status,0,output);
    for(const marker of ['EMPTY_PROSE_NO_DISCUSSION_RENDERS','DRAFT_MOUNTS_AND_CLEARS','CROSS_BLOCK_COMMENT_OWNER_UNDO_REDO','SUGGESTION_INSERT_REMOVE_UNDO_REDO'])assert.match(output,new RegExp(marker));
  });
}

async function exerciseDiscussions(){
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
  const directory=fs.mkdtempSync(path.join(diagnostics,'block-discussion-test-'));
  const renders=new Map(),states=new Map(),renderErrors=[];
  globalThis.__blockDiscussionProbe=(kind,id,state)=>{
    if(kind==='render')renders.set(id,(renders.get(id)??0)+1);
    else states.set(id,state);
  };
  let host;
  const originalError=console.error;
  console.error=(...values)=>originalError(...values.map(value=>String(value?.stack||value).slice(0,1600)));
  try{
    let instrumented=false;
    await build({stdin:{contents:`
export {PlateMathHost} from './src/plate-host';
export {EditorModel} from './src/editor-model';
export {draftStorage} from './src/platform';
export {commentPlugin} from './src/components/editor/plugins/comment-kit';
export {discussionPlugin} from './src/components/editor/plugins/discussion-kit';
export {suggestionPlugin} from './src/components/editor/plugins/suggestion-kit';
export {getDraftCommentKey,getCommentKey} from '@platejs/comment';
export {getSuggestionKey} from '@platejs/suggestion';
export {flushSync} from 'react-dom';
`,resolveDir:__dirname,loader:'ts'},bundle:true,platform:'browser',alias:{path:'path-browserify'},format:'esm',splitting:true,outdir:directory,
      outExtension:{'.js':'.mjs'},entryNames:'entry',external:['yjs'],conditions:['production'],define:{'process.env.NODE_ENV':'"production"'},
      plugins:[{name:'discussion-render-observer',setup(b){
        b.onResolve({filter:/\.css$/},args=>({path:args.path,namespace:'empty-css'}));
        b.onLoad({filter:/.*/,namespace:'empty-css'},()=>({contents:'export default {};',loader:'js'}));
        b.onLoad({filter:/[\\/]components[\\/]ui[\\/]block-discussion\.tsx$/},args=>{
          const source=fs.readFileSync(args.path,'utf8');
          let contents=source.replace(/(const BlockCommentContent = \(\{ children, element \}: PlateElementProps\) => \{)/,
            '$1\n globalThis.__blockDiscussionProbe?.("render", element.id);');
          assert.notEqual(contents,source,'observe the actual full-kit discussion component, not a stub');
          contents=contents.replace(/(const totalCount = suggestionsCount \+ discussionsCount;)/,
            '$1\n globalThis.__blockDiscussionProbe?.("state", element.id, {discussions:resolvedDiscussions.map(item=>item.id),suggestions:resolvedSuggestions.map(item=>item.suggestionId),draft:!!draftCommentNode});');
          assert.match(contents,/__blockDiscussionProbe\?\.\("state"/);
          contents=contents.replace('<div className="flex w-full justify-between">','<div className="flex w-full justify-between" data-probe-discussion-block={element.id}>');
          assert.match(contents,/data-probe-discussion-block/);instrumented=true;
          return {contents,loader:'tsx'};
        });
      }}]});
    assert.equal(instrumented,true);
    const {PlateMathHost,EditorModel,draftStorage,commentPlugin,discussionPlugin,suggestionPlugin,getDraftCommentKey,getCommentKey,flushSync}=await import(pathToFileURL(path.join(directory,'entry.mjs')).href);
    window.addEventListener('vulgar-document-render-error',event=>renderErrors.push(event.detail));
    const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
    const marked=id=>document.querySelector(`[data-probe-discussion-block="${id}"]`);
    const setup=async count=>{
      if(host){host.editor.tf.deselect();host.destroy();host.mount.remove();}
      draftStorage().clear();renders.clear();states.clear();
      draftStorage().setItem('math-plate-document-v1',JSON.stringify({version:1,value:Array.from({length:count},(_,i)=>({type:'p',id:'paragraph-'+i,children:[{text:'Synthetic paragraph '+i+' with ordinary prose.'}]}))}));
      const mount=document.createElement('div');document.body.append(mount);
      host=new PlateMathHost(mount,new EditorModel(),{activate(){},leave(){},change(){}});
      await tick();return host.editor;
    };
    const byId=(editor,id)=>editor.children.findIndex(node=>node.id===id);
    const selectEnd=(editor,id)=>editor.tf.select(editor.api.end([byId(editor,id)]));

    let editor=await setup(200);
    assert.equal(renders.size,0,'unannotated prose does not mount BlockCommentContent at all');
    selectEnd(editor,'paragraph-100');await tick();renders.clear();
    for(const character of 'abcde'){editor.tf.insertText(character);await tick();}
    assert.equal(renders.size,0,'ordinary typing must not render a discussion component for any unannotated paragraph');
    assert.match(editor.api.string([100]),/abcde$/);assert.equal(host.models.size,0);assert.deepEqual(renderErrors,[]);
    console.log('EMPTY_PROSE_NO_DISCUSSION_RENDERS');

    editor=await setup(4);
    editor.tf.select({anchor:{path:[1,0],offset:0},focus:{path:[1,0],offset:9}});
    editor.getTransforms(commentPlugin).comment.setDraft();await tick();
    assert.ok(marked('paragraph-1'),'an ordinary paragraph immediately gains its draft discussion UI');
    assert.equal(states.get('paragraph-1')?.draft,true);
    assert.equal(editor.getApi(commentPlugin).comment.nodes({at:[],isDraft:true}).length,1);
    assert.equal(renders.has('paragraph-3'),false,'unrelated plain text does not gain a discussion wrapper');
    flushSync(()=>editor.tf.withNewBatch(()=>editor.tf.unsetNodes(getDraftCommentKey(),{at:[],match:node=>!!node[getDraftCommentKey()]})));await tick();
    assert.equal(editor.getApi(commentPlugin).comment.nodes({at:[],isDraft:true}).length,0);
    assert.equal(marked('paragraph-1'),null,'clearing a draft removes its UI');
    assert.deepEqual(renderErrors,[],'draft cancellation leaves all Slate leaf paths valid');
    console.log('DRAFT_MOUNTS_AND_CLEARS');

    editor=await setup(4);
    const discussion={id:'cross-block',createdAt:new Date('2026-01-01'),comments:[],isResolved:false,userId:'local'};
    editor.setOption(discussionPlugin,'discussions',[discussion]);
    editor.tf.withNewBatch(()=>editor.tf.setNodes({comment:true,[getCommentKey(discussion.id)]:true},{
      at:{anchor:{path:[0,0],offset:0},focus:{path:[1,0],offset:12}},match:node=>typeof node.text==='string',split:true,
    }));await tick();
    assert.deepEqual(states.get('paragraph-0')?.discussions,[discussion.id]);
    assert.deepEqual(states.get('paragraph-1')?.discussions,[],'a multi-paragraph comment has only one owning block');
    assert.ok(marked('paragraph-0'));assert.equal(marked('paragraph-1'),null);
    editor.tf.withNewBatch(()=>editor.tf.removeNodes({at:[0]}));await tick();
    assert.deepEqual(states.get('paragraph-1')?.discussions,[discussion.id],'deleting the owner moves the badge to its surviving anchor');
    assert.ok(marked('paragraph-1'));
    editor.tf.undo();await tick();assert.deepEqual(states.get('paragraph-0')?.discussions,[discussion.id]);assert.equal(marked('paragraph-1'),null);
    editor.tf.redo();await tick();assert.ok(marked('paragraph-1'));
    editor.setOption(discussionPlugin,'discussions',[{...discussion,isResolved:true}]);await tick();assert.equal(marked('paragraph-1'),null,'resolving a discussion updates its existing block');
    editor.setOption(discussionPlugin,'discussions',[discussion]);await tick();assert.ok(marked('paragraph-1'),'reopening restores the badge');
    console.log('CROSS_BLOCK_COMMENT_OWNER_UNDO_REDO');

    editor=await setup(4);selectEnd(editor,'paragraph-2');await tick();
    editor.setOption(suggestionPlugin,'isSuggesting',true);
    editor.tf.withNewBatch(()=>editor.tf.insertText(' proposed'));await tick();
    editor.setOption(suggestionPlugin,'isSuggesting',false);
    const suggestion=editor.getApi(suggestionPlugin).suggestion.nodes({at:[2]})[0];
    assert.ok(suggestion,'the actual suggestion insertion transform creates a marked leaf');
    const suggestionId=editor.getApi(suggestionPlugin).suggestion.nodeId(suggestion[0]);
    assert.deepEqual(states.get('paragraph-2')?.suggestions,[suggestionId]);assert.ok(marked('paragraph-2'));
    editor.tf.undo();await tick();assert.equal(marked('paragraph-2'),null,'undo removes the new suggestion UI');
    editor.tf.redo();await tick();assert.deepEqual(states.get('paragraph-2')?.suggestions,[suggestionId]);assert.ok(marked('paragraph-2'));
    const restoredSuggestion=editor.getApi(suggestionPlugin).suggestion.nodes({at:[2]})[0];
    editor.tf.withNewBatch(()=>editor.tf.removeNodes({at:restoredSuggestion[1]}));await tick();assert.equal(marked('paragraph-2'),null);
    editor.tf.undo();await tick();assert.ok(marked('paragraph-2'),'undoing deletion restores the retained suggestion');
    assert.deepEqual(states.get('paragraph-2')?.suggestions,[suggestionId]);
    assert.deepEqual(renderErrors,[]);
    console.log('SUGGESTION_INSERT_REMOVE_UNDO_REDO');
  }finally{
    if(host){host.editor.tf.deselect();host.destroy();}
    await window.happyDOM.cancelAsync();console.error=originalError;delete globalThis.__blockDiscussionProbe;
    for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
    const resolved=path.resolve(directory);assert.ok(resolved.startsWith(diagnostics+path.sep),'cleanup stays inside diagnostics');fs.rmSync(resolved,{recursive:true,force:true});
  }
}

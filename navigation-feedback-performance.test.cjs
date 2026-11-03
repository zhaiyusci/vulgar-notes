const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');

const workerFlag='--navigation-without-feedback-worker';
if(process.argv.includes(workerFlag)){
  void exerciseNavigation().then(()=>process.exit(0),error=>{console.error(String(error.stack||error).slice(0,3500));process.exit(1);});
}else{
  test('full EditorKit keeps navigation and selection without per-element navigation feedback subscriptions',{timeout:120000},()=>{
    const result=spawnSync(process.execPath,[__filename,workerFlag],{cwd:__dirname,encoding:'utf8',timeout:115000,maxBuffer:2*1024*1024});
    const output=(result.stdout||'')+(result.stderr||'');
    assert.equal(result.error,undefined,output);assert.equal(result.status,0,output);
    for(const marker of ['NO_NAVIGATION_FEEDBACK_SUBSCRIPTIONS','ENDNOTE_NAVIGATION_WITHOUT_FLASH','TOC_AND_REFERENCE_JUMPS','SELECTION_AND_CARET_PRESERVED'])assert.match(output,new RegExp(marker));
  });
}

async function exerciseNavigation(){
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
  const directory=fs.mkdtempSync(path.join(diagnostics,'navigation-feedback-test-'));
  let navigationHookCalls=0,host;
  globalThis.__navigationFeedbackProbe=()=>navigationHookCalls++;
  const renderErrors=[];
  const originalError=console.error;
  console.error=(...values)=>originalError(...values.map(value=>String(value?.stack||value).slice(0,1600)));
  try{
    let instrumented=false;
    await build({stdin:{contents:`
export {PlateMathHost} from './src/plate-host';
export {EditorModel} from './src/editor-model';
export {draftStorage} from './src/platform';
export {FootnoteReferencePlugin} from '@platejs/footnote/react';
export {BlockSelectionPlugin} from '@platejs/selection/react';
export {flushSync} from 'react-dom';
`,resolveDir:__dirname,loader:'ts'},bundle:true,platform:'browser',alias:{path:'path-browserify'},format:'esm',splitting:true,outdir:directory,
      outExtension:{'.js':'.mjs'},entryNames:'entry',external:['yjs'],conditions:['production'],define:{'process.env.NODE_ENV':'"production"'},
      plugins:[{name:'native-navigation-hook-observer',setup(b){
        b.onResolve({filter:/\.css$/},args=>({path:args.path,namespace:'empty-css'}));
        b.onLoad({filter:/.*/,namespace:'empty-css'},()=>({contents:'export default {};',loader:'js'}));
        b.onLoad({filter:/[\\/]@platejs[\\/]core[\\/]dist[\\/]react[\\/]index\.js$/},args=>{
          const source=fs.readFileSync(args.path,'utf8');
          const contents=source.replace('const useNavigationHighlight = (target) => {','const useNavigationHighlight = (target) => {\n globalThis.__navigationFeedbackProbe?.();');
          assert.notEqual(contents,source,'observe the actual per-element navigation hook');instrumented=true;
          return {contents,loader:'js'};
        });
      }}]});
    assert.ok(instrumented);
    const {PlateMathHost,EditorModel,draftStorage,FootnoteReferencePlugin,BlockSelectionPlugin,flushSync}=await import(pathToFileURL(path.join(directory,'entry.mjs')).href);
    window.addEventListener('vulgar-document-render-error',event=>renderErrors.push(event.detail));
    const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
    const value=Array.from({length:120},(_,i)=>({type:'p',id:'paragraph-'+i,children:[{text:'Ordinary prose '+i}]}));
    value[0]={type:'h1',id:'heading',texLabel:'sec:introduction',children:[{text:'Introduction'}]};
    value[1]={type:'toc',id:'contents',children:[{text:''}]};
    value[2].children=[{text:'Before '},{type:'footnoteReference',id:'note-reference',identifier:'note-1',children:[{text:''}]},
      {text:' after '},{type:'tex_reference',id:'cross-reference',command:'ref',keys:['sec:introduction'],children:[{text:''}]},{text:' end'}];
    value.push({type:'footnoteDefinition',id:'note-definition',identifier:'note-1',children:[{type:'p',id:'note-content',children:[{text:'Endnote content'}]}]});
    draftStorage().clear();draftStorage().setItem('math-plate-document-v1',JSON.stringify({version:1,value}));
    const mount=document.createElement('div');document.body.append(mount);
    host=new PlateMathHost(mount,new EditorModel(),{activate(){},leave(){},change(){}});
    await tick();const editor=host.editor;
    const noFlash=()=>assert.equal(mount.querySelector('[data-nav-target], [data-nav-pulse], [data-nav-highlight]'),null);
    assert.equal(editor.plugins.navigationFeedback,undefined,'the native feedback plugin is disabled');
    assert.equal(navigationHookCalls,0,'no paragraph or endnote subscribes to navigation feedback');
    editor.tf.select(editor.api.end([60]));await tick();
    for(const letter of 'abc'){editor.tf.insertText(letter);await tick();}
    assert.equal(navigationHookCalls,0);noFlash();
    assert.equal(editor.children[60].children[0].text,'Ordinary prose 60abc');
    console.log('NO_NAVIGATION_FEEDBACK_SUBSCRIPTIONS');

    const scrolls=[];editor.api.scrollIntoView=point=>scrolls.push(structuredClone(point));
    const footnotes=editor.getTransforms(FootnoteReferencePlugin).footnote;
    const footnoteApi=editor.getApi(FootnoteReferencePlugin).footnote;
    assert.equal(footnotes.focusDefinition({identifier:'note-1'}),true);await tick();
    let definition=footnoteApi.definition({identifier:'note-1'});
    assert.ok(definition);assert.deepEqual(editor.selection.anchor.path,definition[1].concat([0,0]));
    assert.equal(scrolls.length,1);noFlash();
    assert.equal(footnotes.focusReference({identifier:'note-1'}),true);await tick();
    assert.equal(editor.selection.anchor.path[0],2);assert.equal(scrolls.length,2);noFlash();
    // The jump resolves current document paths after structural changes and undo.
    editor.tf.withNewBatch(()=>editor.tf.insertNodes({type:'p',id:'new-first',children:[{text:'New first paragraph'}]},{at:[0]}));await tick();
    assert.equal(footnotes.focusReference({identifier:'note-1'}),true);await tick();
    assert.equal(editor.selection.anchor.path[0],3);
    editor.tf.undo();await tick();assert.equal(footnotes.focusReference({identifier:'note-1'}),true);await tick();
    assert.equal(editor.selection.anchor.path[0],2);noFlash();
    assert.equal(navigationHookCalls,0);console.log('ENDNOTE_NAVIGATION_WITHOUT_FLASH');

    const heading=editor.children.find(node=>node.id==='heading');
    const headingElement=editor.api.toDOMNode(heading);let headingScrolls=0;
    headingElement.scrollIntoView=()=>headingScrolls++;
    const tocLink=mount.querySelector('.document-toc-link');assert.ok(tocLink);
    tocLink.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));await tick();
    assert.equal(headingScrolls,1);assert.deepEqual(editor.selection.anchor.path,[0,0]);noFlash();
    const crossReference=mount.querySelector('.tex-reference [role="link"]');assert.ok(crossReference);
    crossReference.dispatchEvent(new window.MouseEvent('click',{bubbles:true,ctrlKey:true}));await tick();
    assert.equal(headingScrolls,2);noFlash();console.log('TOC_AND_REFERENCE_JUMPS');

    // Normal editing selection is separate from the removed jump feedback.
    editor.tf.select({anchor:{path:[60,0],offset:1},focus:{path:[60,0],offset:5}});await tick();
    assert.equal(editor.api.isExpanded(),true);
    editor.tf.insertText('replacement');await tick();
    assert.equal(editor.children[60].children[0].text,'Oreplacementary prose 60abc');
    assert.equal(editor.api.isCollapsed(),true);assert.equal(editor.selection.anchor.offset,12);
    editor.tf.deselect();await tick();
    flushSync(()=>editor.getApi(BlockSelectionPlugin).blockSelection.set(['paragraph-10']));await tick();
    const selectedBlock=mount.querySelector('[data-root-block-id="paragraph-10"] [data-slot="block-selection"]');
    assert.ok(selectedBlock?.classList.contains('opacity-100'));
    flushSync(()=>editor.getApi(BlockSelectionPlugin).blockSelection.deselect());await tick();
    const refPath=footnoteApi.references({identifier:'note-1'})[0][1];
    editor.tf.select(editor.api.range(refPath));editor.tf.focus();await tick();
    assert.equal(mount.querySelector('.endnote-reference')?.getAttribute('data-reference-selected'),'true');
    noFlash();assert.equal(navigationHookCalls,0);assert.deepEqual(renderErrors,[]);
    console.log('SELECTION_AND_CARET_PRESERVED');
  }finally{
    if(host){host.editor.tf.deselect();host.destroy();}
    await window.happyDOM.cancelAsync();console.error=originalError;delete globalThis.__navigationFeedbackProbe;
    for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
    const resolved=path.resolve(directory);assert.ok(resolved.startsWith(diagnostics+path.sep),'cleanup stays inside diagnostics');fs.rmSync(resolved,{recursive:true,force:true});
  }
}

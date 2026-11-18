const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const Module=require('node:module');
const path=require('node:path');

test('proofreading controls are explicit, bounded and keep suggestion actions separate from navigation',async t=>{
  const {Window}=await import('happy-dom');const window=new Window({url:'http://localhost/'});
  const globals=['window','document','navigator','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLButtonElement','Element','Node','NodeFilter',
    'Document','DocumentFragment','MutationObserver','ResizeObserver','Event','CustomEvent','KeyboardEvent','PointerEvent','MouseEvent','DOMRect','getComputedStyle','requestAnimationFrame','cancelAnimationFrame'];
  const before=new Map(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const key of globals)Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?window:typeof window[key]==='function'&&['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(key)?window[key].bind(window):window[key]});
  window.document.write('<!doctype html><button id="openPreferences">Preferences</button><button id="outside">Outside</button>');
  const React=require('react'),{createRoot}=require('react-dom/client'),{flushSync}=require('react-dom');
  const bundle=await build({stdin:{contents:"export {ProofreadingToolbarButton} from './src/components/ui/proofreading-toolbar-button';export {ProofreadingTools} from './src/components/ui/proofreading-tools';export {HostContext} from '@/plate-editor-context';",resolveDir:__dirname,loader:'tsx'},
    bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react-dom','react-dom/client'],plugins:[{name:'proofreading-ui-adapters',setup(b){
      const adapters={
        'platejs/react':'export const useEditorReadOnly=()=>globalThis.proofreadingUiTest.readOnly;',
        '@/plate-editor-context':"import {createContext} from 'react';export const HostContext=createContext(null);",
        '@/i18n':"export const t=(value,vars={})=>value.replace(/\\{(\\w+)\\}/g,(_,key)=>vars[key]??'{'+key+'}');",
        './toolbar':"export const ToolbarButton=({tooltip,...props})=><button type='button' {...props}/>;",
      };
      b.onResolve({filter:/.*/},args=>Object.hasOwn(adapters,args.path)?{path:args.path,namespace:'proofreading-ui-test'}:undefined);
      b.onLoad({filter:/.*/,namespace:'proofreading-ui-test'},args=>({contents:adapters[args.path],loader:'tsx',resolveDir:__dirname}));
    }}]});
  const mod=new Module(path.join(__dirname,'.proofreading-ui-test.cjs'),module);mod.filename=path.join(__dirname,'.proofreading-ui-test.cjs');mod.paths=module.paths;mod._compile(bundle.outputFiles[0].text,mod.filename);
  const {ProofreadingToolbarButton,ProofreadingTools,HostContext}=mod.exports;
  const mounts=[];const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
  const originalRect=window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect=function(){return this.classList.contains('proofreading-suggestion-menu')?new window.DOMRect(0,0,300,200):originalRect.call(this);};
  try{
    const listeners=new Set();let state={enabled:false,pending:0,checking:false,error:'',checked:0,issues:[]};
    const calls={current:0,document:0,stop:0,locate:[],apply:[],ignore:[],settings:0};
    const update=patch=>{flushSync(()=>{state={...state,...patch};for(const listener of listeners)listener();});};
    const controller={getSnapshot:()=>state,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
      closeMenu:()=>{if(state.menu)update({menu:undefined});},checkCurrent:()=>{calls.current++;return false;},checkDocument:()=>calls.document++,
      stop:()=>{calls.stop++;update({checking:false,pending:0});},
      locate:id=>{calls.locate.push(id);return true;},apply:(id,replacement)=>{calls.apply.push([id,replacement]);return true;},
      ignore:id=>{calls.ignore.push(id);update({issues:state.issues.filter(issue=>issue.id!==id),menu:undefined});}};
    globalThis.proofreadingUiTest={readOnly:false};
    const host={proofreader:controller,get readOnly(){return globalThis.proofreadingUiTest.readOnly;}};
    const mount=document.createElement('div');document.body.append(mount);const root=createRoot(mount);mounts.push(root);
    const render=()=>flushSync(()=>root.render(React.createElement(HostContext.Provider,{value:host},React.createElement(ProofreadingToolbarButton))));render();await tick();
    document.getElementById('openPreferences').addEventListener('click',()=>calls.settings++);
    const trigger=()=>mount.querySelector('[aria-label="Proofreading"]');
    const button=(label,scope=document)=>[...scope.querySelectorAll('button')].find(node=>node.textContent===label||node.getAttribute('aria-label')===label);
    const panel=()=>document.querySelector('.proofreading-panel:not(.proofreading-suggestion-menu)');
    const click=async node=>{assert.ok(node);flushSync(()=>node.click());await tick();};
    await click(trigger());assert.ok(panel());
    assert.match(panel().textContent,/Choose a proofreading service/);assert.doesNotMatch(panel().textContent,/AI proofreading/);assert.equal(button('Check paragraph',panel()),undefined);
    assert.equal(calls.current+calls.document,0,'opening the panel must not request proofreading');assert.equal(listeners.size,1);
    await click(button('Proofreading settings',panel()));assert.equal(calls.settings,1);assert.equal(panel(),null);

    update({enabled:true});await click(trigger());assert.match(panel().textContent,/Check a paragraph or the document/);
    assert.match(panel().textContent,/Manual checking/);assert.doesNotMatch(panel().textContent,/Start typing|Pause|Resume/);
    assert.equal(button('Cancel checking',panel()),undefined,'idle manual checking has no pause or resume operation');
    const pointer=new window.PointerEvent('pointerdown',{bubbles:true,cancelable:true});
    button('Check paragraph',panel()).dispatchEvent(pointer);assert.equal(pointer.defaultPrevented,true,'the check button preserves the prose selection');
    assert.doesNotMatch(panel().textContent,/No issues found/);
    await click(button('Check paragraph',panel()));assert.equal(calls.current,1);assert.match(panel().textContent,/Place the cursor in editable prose first/);
    await click(button('Check document',panel()));assert.equal(calls.document,1);
    update({checked:2});assert.match(panel().textContent,/No issues found in the checked text/);assert.match(panel().textContent,/Paragraphs checked: 2/);
    update({checking:true,pending:3});assert.match(panel().textContent,/Checking/);assert.match(panel().textContent,/Queued: 3/);
    assert.equal(button('Check paragraph',panel()).disabled,true);assert.equal(button('Check document',panel()).disabled,true);
    const checksBefore=calls.current+calls.document;await click(button('Check document',panel()));assert.equal(calls.current+calls.document,checksBefore,'an active manual run cannot be queued again');
    await click(button('Cancel checking',panel()));assert.equal(calls.stop,1);assert.equal(button('Cancel checking',panel()),undefined);
    assert.match(panel().textContent,/Manual checking/);assert.equal(button('Check paragraph',panel()).disabled,false);
    update({checking:false,pending:2});assert.ok(button('Cancel checking',panel()),'a queued run can be cancelled before its next request starts');
    await click(button('Cancel checking',panel()));assert.equal(calls.stop,2);
    const issue=index=>({id:'issue-'+index,original:'teh '+index,replacements:['the '+index,''],message:'Check this spelling.',kind:'spelling',start:0,end:3});
    update({checking:false,pending:0,issues:Array.from({length:105},(_,index)=>issue(index))});
    assert.equal(panel().querySelectorAll('[data-proofreading-issue]').length,100);await click(button('Show more suggestions',panel()));
    assert.equal(panel().querySelectorAll('[data-proofreading-issue]').length,105);
    const first=panel().querySelector('[data-proofreading-issue="issue-0"]');
    await click(first.querySelector('.proofreading-original'));assert.deepEqual(calls.locate,['issue-0']);assert.equal(calls.apply.length,0);
    await click(button('Delete',first));assert.deepEqual(calls.apply,[['issue-0','']]);
    await click(button('Ignore',first));assert.deepEqual(calls.ignore,['issue-0']);assert.equal(panel().querySelector('[data-proofreading-issue="issue-0"]'),null);
    assert.equal(calls.current+calls.document,checksBefore,'applying or ignoring suggestions does not start a manual check');
    const remainingIssues=state.issues;
    const failure='The proofreading service requires payment or has insufficient balance (HTTP 402).\nService response: Insufficient Balance <retry later>';
    update({issues:[],error:failure});
    assert.equal(panel().querySelector('[role="alert"]').textContent,failure,'the service detail stays on its own line as plain text');
    assert.equal(panel().querySelector('retry'),null,'service details are never interpreted as HTML');
    assert.match(panel().textContent,/Paragraphs checked: 2/);
    assert.doesNotMatch(panel().textContent,/No issues found|Check a paragraph or the document/,'a failed run must not display an empty-result success or idle prompt');
    assert.equal(button('Check paragraph',panel()).disabled,false,'a failed run may be retried explicitly');
    assert.equal(calls.current+calls.document,checksBefore,'displaying a service error must not retry');
    update({error:''});assert.match(panel().textContent,/No issues found in the checked text/);
    update({issues:remainingIssues,error:'The proofreading request timed out.'});assert.match(panel().textContent,/request timed out/);

    update({menu:{id:'issue-1',x:window.innerWidth-1,y:window.innerHeight-1}});await tick();
    let menu=document.querySelector('.proofreading-suggestion-menu');assert.ok(menu);assert.equal(panel(),null);
    assert.equal(menu.parentElement,document.body);assert.equal(menu.querySelectorAll('[data-proofreading-issue]').length,1);
    assert.ok(Number.parseFloat(menu.style.left)<=window.innerWidth-308);assert.ok(Number.parseFloat(menu.style.top)<=window.innerHeight-208);
    const initialFocus=document.activeElement;menu.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
    assert.notEqual(document.activeElement,initialFocus);assert.ok(menu.contains(document.activeElement));
    document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await tick();assert.equal(document.querySelector('.proofreading-suggestion-menu'),null);
    update({menu:{id:'issue-2',x:12,y:12}});await tick();
    document.getElementById('outside').dispatchEvent(new window.PointerEvent('pointerdown',{bubbles:true}));await tick();assert.equal(document.querySelector('.proofreading-suggestion-menu'),null);

    globalThis.proofreadingUiTest.readOnly=true;render();update({menu:{id:'issue-3',x:20,y:20}});await tick();
    menu=document.querySelector('.proofreading-suggestion-menu');assert.ok(menu);
    const replacements=[...menu.querySelectorAll('.proofreading-replacements button')];assert.ok(replacements.every(node=>node.disabled));
    const previous=calls.apply.length;await click(replacements[0]);assert.equal(calls.apply.length,previous);
    assert.equal(menu.querySelector('.proofreading-original').disabled,false,'read-only users can still locate an issue');
    update({menu:undefined});await click(trigger());assert.equal(button('Check paragraph',panel()).disabled,true);assert.match(panel().textContent,/read-only/);
    assert.equal(listeners.size,1,'all suggestions share the one toolbar subscription');
    flushSync(()=>root.unmount());mounts.length=0;assert.equal(listeners.size,0);

    // The same controls also run without HostContext or any Plate provider.
    // Even while the Plate adapter reports read-only, this component follows its own explicit props.
    const standalone=createRoot(mount);mounts.push(standalone);let settingsActions=0;
    flushSync(()=>standalone.render(React.createElement(ProofreadingTools,{service:controller,readOnly:false,onConfigure:()=>settingsActions++})));
    await click(trigger());assert.equal(button('Check paragraph',panel()).disabled,false);
    const currentBefore=calls.current;await click(button('Check paragraph',panel()));assert.equal(calls.current,currentBefore+1);
    const preferencesBefore=calls.settings;await click(button('Proofreading settings',panel()));
    assert.equal(settingsActions,1);assert.equal(calls.settings,preferencesBefore,'the independent UI calls its supplied settings action, not an application DOM button');
    assert.equal(panel(),null);assert.equal(listeners.size,1);
    flushSync(()=>standalone.unmount());mounts.length=0;assert.equal(listeners.size,0);
  }finally{
    for(const root of mounts)flushSync(()=>root.unmount());await window.happyDOM.cancelAsync();
    delete globalThis.proofreadingUiTest;
    for(const [key,descriptor] of before){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
});

test('reusable proofreading UI has no runtime dependency on Plate or its controller implementation',async()=>{
  const result=await build({entryPoints:['src/components/ui/proofreading-tools.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',jsx:'automatic'});
  const inputs=Object.keys(result.metafile.inputs).map(file=>file.replaceAll('\\','/'));
  assert.ok(inputs.some(file=>file.endsWith('src/components/ui/proofreading-tools.tsx')));
  assert.equal(inputs.some(file=>/\/src\/(?:plate-host|plate-math-element|plate-editor-context|proofreading-controller|document-lifecycle|platform)\./.test('/'+file)),false);
  assert.equal(inputs.some(file=>/node_modules\/(?:@platejs\/|platejs\/|slate(?:-react|-history)?\/)/.test(file)),false);
});

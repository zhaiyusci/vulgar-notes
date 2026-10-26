const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const path=require('node:path');
const fs=require('node:fs');
const fixedChildren=new Map([...fs.readFileSync('src/components/ui/fixed-toolbar-buttons.tsx','utf8').matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.\/[^'"]+)['"]/g)].map(match=>[match[2],match[1].split(',').map(name=>name.trim()).filter(Boolean)]));

const code=build({
 stdin:{contents:"export {CrossReferenceToolbarButton,CitationReferenceEditor} from './reference-toolbar-button';export {FixedToolbarButtons} from './fixed-toolbar-buttons';export {HostContext} from '@/plate-math-element';",resolveDir:path.resolve('src/components/ui'),loader:'tsx'},
 bundle:true,write:false,platform:'node',format:'cjs',target:'es2022',jsx:'automatic',external:['react','react/*','react-dom','react-dom/*'],
 plugins:[{name:'toolbar-adapters',setup(build){
  const adapters={
   'platejs':`export const KEYS=new Proxy({},{get:(_,key)=>key});export const NodeApi={nodes:function*(editor){function* walk(nodes,parent=[]){for(let i=0;i<nodes.length;i++){const node=nodes[i],path=[...parent,i];yield[node,path];if(node.children)yield*walk(node.children,path);}}yield*walk(editor.children);}};`,
   'platejs/react':`export const useEditorRef=()=>globalThis.referenceToolbarTest.editor;export const useEditorSelector=selector=>selector(globalThis.referenceToolbarTest.editor);export const useEditorReadOnly=()=>globalThis.referenceToolbarTest.editor.api.isReadOnly();`,
   '@/plate-math-element':`import{createContext}from'react';export const HostContext=createContext(null);`,
   '@/use-bibliography':`export const useBibliographyLibraries=()=>globalThis.referenceToolbarTest.libraries;`,
   '@/i18n':`export const t=value=>value;`,
   './toolbar':`export const ToolbarButton=({tooltip,...props})=><button type="button" {...props}/>;export const ToolbarGroup=({children})=><div data-toolbar-group>{children}</div>;`,
   './button':`export const Button=({variant,...props})=><button type="button" {...props}/>;`,
   './dialog':`export const Dialog=({open,children})=>open?<div role="dialog">{children}</div>:null;export const DialogContent=({onCloseAutoFocus,...props})=><div {...props}/>;export const DialogTitle=props=><h2 {...props}/>;export const DialogDescription=props=><p {...props}/>;`,
   './bibtex-libraries-button':`export const BibtexLibrariesButton=({onChooseKey})=><button type="button" onClick={()=>onChooseKey('library')}>Bibliography libraries</button>;`,
  };
  build.onResolve({filter:/.*/},args=>{
   if(Object.hasOwn(adapters,args.path))return {path:args.path,namespace:'toolbar-test'};
   if(args.importer.endsWith('fixed-toolbar-buttons.tsx')&&args.path!=='./reference-toolbar-button'&&fixedChildren.has(args.path))return {path:args.path,namespace:'fixed-toolbar-test'};
  });
  build.onLoad({filter:/.*/,namespace:'toolbar-test'},args=>({contents:adapters[args.path],loader:'tsx',resolveDir:process.cwd()}));
  build.onLoad({filter:/.*/,namespace:'fixed-toolbar-test'},args=>({contents:fixedChildren.get(args.path).map(name=>`export const ${name}=({children})=><span data-toolbar-component="${name}">{children}</span>;`).join('\n'),loader:'tsx',resolveDir:process.cwd()}));
 }}],
}).then(result=>result.outputFiles[0].text);

test('cross-reference and citation dialog interactions',async t=>{
 const {Window}=await import('happy-dom');
 const window=new Window({url:'http://localhost/'});
 for(const key of ['window','document','navigator','Node','Element','HTMLElement','HTMLInputElement','HTMLSelectElement','MutationObserver','Event','CustomEvent','MouseEvent'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
 const React=require('react'),{createRoot}=require('react-dom/client'),{flushSync}=require('react-dom');
 const compiled={exports:{}};new Function('require','module','exports',await code)(require,compiled,compiled.exports);
 const api=compiled.exports,tick=()=>new Promise(resolve=>setTimeout(resolve,10));
 const byText=(root,text)=>[...root.querySelectorAll('button')].find(button=>button.textContent===text);
 const click=element=>{assert.ok(element,'expected button');flushSync(()=>element.click());};
 const input=(element,value)=>{
  assert.ok(element,'expected input');
  const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  flushSync(()=>{setter.call(element,value);element.dispatchEvent(new window.Event('input',{bubbles:true}));element.dispatchEvent(new window.Event('change',{bubbles:true}));});
 };
 const change=(element,value)=>flushSync(()=>{element.value=value;element.dispatchEvent(new window.Event('change',{bubbles:true}));});
 function setup({host=true,selection=true,fallback=false,readOnly=false,fixedToolbar=false}={}){
  const range={anchor:{path:[0,0],offset:0},focus:{path:[0,0],offset:0}},calls={prepare:0,insert:[],set:[],select:[],focus:0};
  const ref={type:'tex_reference',id:'cross',command:'eqref',keys:['eq:sample'],children:[{text:''}]};
  const citation={type:'tex_reference',id:'citation',command:'cite',keys:['library'],children:[{text:''}]};
  const editor={children:[{type:'p',children:[{text:'Body'},ref,citation]},
   {type:'inline_equation',display:true,texLabel:'eq:sample',texExpression:'x=1',children:[{text:''}]},
   {type:'h1',texLabel:'sec:sample',children:[{text:'A heading'}]},
   {type:'bibliography_entry',citeKey:'legacy',children:[{text:'Legacy Author. Kept title.'}]},
   {type:'footnoteDefinition',identifier:'note',children:[{type:'p',children:[{text:'Not a label or citation target'}]}]},
  ],selection:selection?structuredClone(range):null,api:{isReadOnly:()=>readOnly},tf:{}};
  editor.tf={withNewBatch:fn=>fn(),select:point=>{calls.select.push(point);editor.selection=point;},insertNodes:node=>{calls.insert.push(node);editor.children[0].children.push(node);},setNodes:(props,{at})=>{calls.set.push({props,at});let node=editor;for(const index of at)node=node.children[index];Object.assign(node,props);},move:()=>{},focus:()=>{calls.focus++;}};
  const state=globalThis.referenceToolbarTest={editor,libraries:[{id:'library',name:'Library.bib',source:'@book{library,author={Smith, Ann},title={A searchable book},year=2024}'}]};
  const hostValue=host?{prepareTextInsertion:()=>{calls.prepare++;if(fallback&&!editor.selection)editor.selection=structuredClone(range);}}:null;
  const mount=document.createElement('div');document.body.append(mount);const root=createRoot(mount);
  const children=fixedToolbar?React.createElement(api.FixedToolbarButtons):React.createElement(React.Fragment,null,React.createElement(api.CrossReferenceToolbarButton),React.createElement(api.CitationReferenceEditor));
  flushSync(()=>root.render(React.createElement(api.HostContext.Provider,{value:hostValue},children)));
  const close=()=>{flushSync(()=>root.unmount());mount.remove();};
  const edit=id=>flushSync(()=>document.dispatchEvent(new window.CustomEvent('edit-tex-reference',{detail:id})));
  return {mount,root,editor,ref,citation,calls,state,close,edit};
 }

 await t.test('only cross-references have a standalone trigger while existing citations keep their own editor',async()=>{
  const h=setup();await tick();
  const cross=h.mount.querySelector('button[aria-label="Cross-reference"]'),citation=h.mount.querySelector('button[aria-label="Citation"]');
  assert.equal(cross.title,'Cross-reference');assert.equal(citation,null);
  click(cross);assert.equal(h.mount.querySelector('[role="dialog"] h2').textContent,'Cross-reference');
  assert.deepEqual([...h.mount.querySelector('select').options].map(option=>option.value),['ref','eqref']);
  assert.equal(byText(h.mount,'Bibliography libraries'),undefined);
  assert.ok(h.mount.querySelector('input[aria-label="Label"]'));
  click(byText(h.mount,'Cancel'));h.edit('citation');
  assert.equal(h.mount.querySelector('[role="dialog"] h2').textContent,'Citation');assert.equal(h.mount.querySelector('select'),null);
  assert.ok(h.mount.querySelector('input[aria-label="Citation key"]'));assert.ok(byText(h.mount,'Bibliography libraries'));
  input(h.mount.querySelector('input[type="search"]'),'Smith');
  assert.match(h.mount.querySelector('[role="dialog"]').textContent,/A searchable book/);
  assert.doesNotMatch(h.mount.querySelector('[role="dialog"]').textContent,/Legacy Author/);
  input(h.mount.querySelector('input[type="search"]'),'Legacy Author');
  assert.match(h.mount.querySelector('[role="dialog"]').textContent,/Kept title/);
  assert.doesNotMatch(h.mount.querySelector('[role="dialog"]').textContent,/Not a label or citation target/);
  h.close();
 });

 await t.test('double-click routes once and switching ref/eqref updates the original node',async()=>{
  const h=setup();await tick();h.edit('cross');
  assert.equal(h.calls.prepare,1);assert.equal(h.mount.querySelectorAll('[role="dialog"]').length,1);
  assert.equal(h.mount.querySelector('input[aria-label="Label"]').value,'eq:sample');
  change(h.mount.querySelector('select'),'ref');
  assert.equal(h.mount.querySelector('input[aria-label="Label"]').value,'eq:sample');
  click(byText(h.mount,'Apply'));
  assert.equal(h.calls.insert.length,0);assert.equal(h.calls.set.length,1);assert.equal(h.ref.id,'cross');assert.equal(h.ref.command,'ref');
  h.edit('citation');assert.equal(h.calls.prepare,2);assert.equal(h.mount.querySelectorAll('[role="dialog"]').length,1);
  assert.equal(h.mount.querySelector('[role="dialog"] h2').textContent,'Citation');assert.equal(h.mount.querySelector('select'),null);
  h.edit('cross');assert.equal(h.calls.prepare,3);assert.equal(h.mount.querySelectorAll('[role="dialog"]').length,1);assert.equal(h.mount.querySelector('[role="dialog"] h2').textContent,'Cross-reference');
  h.close();
 });

 await t.test('citation edits remain citations and changed-kind targets cannot be converted',async()=>{
  const h=setup();await tick();h.edit('citation');
  input(h.mount.querySelector('input[aria-label="Citation key"]'),'legacy, library');click(byText(h.mount,'Apply'));
  assert.equal(h.citation.command,'cite');assert.deepEqual(h.citation.keys,['legacy','library']);assert.equal(h.calls.insert.length,0);
  h.edit('cross');h.ref.command='cite';click(byText(h.mount,'Apply'));
  assert.equal(h.ref.command,'cite');assert.equal(h.calls.set.length,1);assert.equal(h.calls.insert.length,0);
  assert.equal(h.mount.querySelector('[role="alert"]').textContent,'This reference is no longer available.');h.close();
 });

 await t.test('headless citation editing can choose library keys without inserting another citation',async()=>{
  const h=setup({selection:false,fallback:true});await tick();h.edit('citation');
  input(h.mount.querySelector('input[aria-label="Citation key"]'),'legacy');
  click(byText(h.mount,'Bibliography libraries'));click(byText(h.mount,'Apply'));
  assert.equal(h.calls.prepare,1);assert.equal(h.calls.insert.length,0);assert.equal(h.calls.set.length,1);
  assert.deepEqual(h.citation.keys,['legacy','library']);assert.equal(h.calls.focus,1);h.close();
 });

 await t.test('without a remaining selection, cross-reference insertion shows the cursor instruction',async()=>{
  const h=setup({host:false,selection:false});await tick();click(h.mount.querySelector('button[aria-label="Cross-reference"]'));
  input(h.mount.querySelector('input[aria-label="Label"]'),'eq:unlisted');
  click(byText(h.mount,'Apply'));assert.equal(h.calls.insert.length,0);assert.equal(h.mount.querySelector('[role="alert"]').textContent,'Place the cursor in the document first.');h.close();
 });

 await t.test('a citation removed while its editor is open is never recreated as a new node',async()=>{
  const h=setup();await tick();h.edit('citation');h.editor.children[0].children=h.editor.children[0].children.filter(node=>node.id!=='citation');
  click(byText(h.mount,'Apply'));assert.equal(h.calls.insert.length,0);assert.equal(h.calls.set.length,0);
  assert.equal(h.mount.querySelector('[role="alert"]').textContent,'This reference is no longer available.');h.close();
 });

 await t.test('real fixed-toolbar structure keeps one library entry and mounts citation editing without a trigger',async()=>{
  const h=setup({fixedToolbar:true});await tick();
  assert.equal(h.mount.querySelector('button[aria-label="Citation"]'),null);
  assert.equal([...h.mount.querySelectorAll('button')].filter(button=>button.textContent==='Bibliography libraries').length,1);
  assert.ok(h.mount.querySelector('[data-toolbar-component="InsertEndnoteToolbarButton"]'));
  h.edit('citation');assert.equal(h.mount.querySelectorAll('[role="dialog"]').length,1);
  assert.equal(h.mount.querySelector('[role="dialog"] h2').textContent,'Citation');h.close();
 });

 await t.test('read-only editors ignore toolbar and double-click editing requests',async()=>{
  const h=setup({readOnly:true});await tick();click(h.mount.querySelector('button[aria-label="Cross-reference"]'));h.edit('cross');h.edit('citation');
  assert.equal(h.mount.querySelector('[role="dialog"]'),null);assert.equal(h.calls.prepare,0);assert.equal(h.calls.insert.length,0);h.close();
 });
 await window.happyDOM.abort();
});

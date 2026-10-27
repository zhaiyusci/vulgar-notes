const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const path=require('node:path');

const compiledSource=build({stdin:{contents:"export {BibtexLibrariesButton} from './bibtex-libraries-button';export {HostContext} from '@/plate-math-element';export {parseBibLibraries} from '@/bibtex';",resolveDir:path.resolve('src/components/ui'),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',target:'es2022',jsx:'automatic',external:['react','react/*','react-dom','react-dom/*'],plugins:[{name:'library-dialog-adapters',setup(b){
 const adapters={
  'platejs/react':`export const useEditorRef=()=>globalThis.bibtexLibrariesTest.editor;`,
  '@/plate-math-element':`import{createContext}from'react';export const HostContext=createContext(null);`,
  '@/use-bibliography':`import{useSyncExternalStore}from'react';export const useBibliographyLibraries=()=>useSyncExternalStore(globalThis.bibtexLibrariesTest.subscribe,()=>globalThis.bibtexLibrariesTest.libraries);export const useBibliographyStyle=()=>useSyncExternalStore(globalThis.bibtexLibrariesTest.subscribe,()=>globalThis.bibtexLibrariesTest.style);`,
  '@/bibliography-source':`export const openBibliographySource=async()=>{const s=globalThis.bibtexLibrariesTest;s.calls.open++;return s.openResult;};export const refreshBibliographySource=async(id,name)=>{const s=globalThis.bibtexLibrariesTest;s.calls.refresh.push({id,name});return s.refreshResult;};export const rememberBibliographySource=async(id,file)=>{const s=globalThis.bibtexLibrariesTest;s.calls.remember.push({id,file});return {persisted:s.persisted};};export const forgetBibliographySource=async id=>{const s=globalThis.bibtexLibrariesTest;s.calls.forget.push(id);if(s.forgetResult)return s.forgetResult;};`,
  '@/i18n':`export const t=value=>value;`,
  './toolbar':`export const ToolbarButton=({tooltip,...props})=><button type="button" {...props}/>;`,
  './button':`export const Button=({variant,size,...props})=><button type="button" {...props}/>;`,
  './dialog':`export const Dialog=({open,children})=>open?<div role="dialog">{children}</div>:null;export const DialogContent=({onCloseAutoFocus,...props})=><div {...props}/>;export const DialogTitle=props=><h2 {...props}/>;export const DialogDescription=props=><p {...props}/>;`,
 };
 b.onResolve({filter:/.*/},args=>Object.hasOwn(adapters,args.path)?{path:args.path,namespace:'library-dialog-test'}:undefined);
 b.onLoad({filter:/.*/,namespace:'library-dialog-test'},args=>({contents:adapters[args.path],loader:'tsx',resolveDir:process.cwd()}));
}}]}).then(result=>result.outputFiles[0].text);

test('BibTeX library dialog source refresh and reference-list settings',async t=>{
 const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
 for(const key of ['window','document','navigator','Node','Element','HTMLElement','HTMLInputElement','HTMLSelectElement','MutationObserver','Event','CustomEvent','MouseEvent'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
 const React=require('react'),{createRoot}=require('react-dom/client'),{flushSync}=require('react-dom');
 const compiled={exports:{}};new Function('require','module','exports',await compiledSource)(require,compiled,compiled.exports);const api=compiled.exports;
 const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
 const byText=(root,text)=>[...root.querySelectorAll('button')].find(button=>button.textContent===text);
 const click=element=>{assert.ok(element,'expected button');flushSync(()=>element.click());};
 const input=(element,value)=>{const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;flushSync(()=>{setter.call(element,value);element.dispatchEvent(new window.Event('input',{bubbles:true}));element.dispatchEvent(new window.Event('change',{bubbles:true}));});};
 const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
 function setup(){
  const listeners=new Set(),calls={prepare:0,set:[],style:[],open:0,refresh:[],remember:[],forget:[]};
  const state=globalThis.bibtexLibrariesTest={calls,libraries:[{id:'one',name:'original.bib',source:'@book{alpha,title={Alpha original},author={Writer, Ann},year=2020}'},{id:'two',name:'other.bib',source:'@book{beta,title={Beta other},year=2021}'}],style:'simple',openResult:null,refreshResult:null,persisted:true,aliases:{one:'canonical-one',two:'canonical-two'},subscribe:listener=>{listeners.add(listener);return ()=>listeners.delete(listener);}};
  const editor=state.editor={selection:{anchor:{path:[0,0],offset:0},focus:{path:[0,0],offset:0}},tf:{focus(){}}};
  const changed=()=>{for(const listener of listeners)listener();};
  const host={prepareTextInsertion:()=>{calls.prepare++;},getBibliographyLibraries:()=>state.libraries,getBibliographySourceId:id=>state.aliases[id]??id,isCapturedBibliographyLibrary:()=>false,getBibliographyNotices:()=>[],setBibliographyLibraries:(libraries,updated)=>{
   api.parseBibLibraries(libraries);calls.set.push({libraries,updated});state.libraries=libraries;
   for(const id of updated??[])state.aliases[id]=id;
   changed();
  },setBibliographyStyle:style=>{calls.style.push(style);state.style=style;changed();}};
  const mount=document.createElement('div');document.body.append(mount);const root=createRoot(mount);
  flushSync(()=>root.render(React.createElement(api.HostContext.Provider,{value:host},React.createElement(api.BibtexLibrariesButton))));
  click(mount.querySelector('button[aria-label="BibTeX libraries"]'));
  const close=()=>{flushSync(()=>root.unmount());mount.remove();};
  return {state,calls,host,editor,mount,changed,close};
 }
 await t.test('Refresh rereads the canonical original source and preserves library identity, selected view and search',async()=>{
  const h=setup();await tick();click(byText(h.mount,'original.bib'));input(h.mount.querySelector('input[type="search"]'),'Alpha');
  assert.equal([...h.mount.querySelectorAll('button')].some(button=>/Replace library/.test(button.textContent+' '+button.getAttribute('aria-label'))),false);
  h.state.refreshResult={name:'original.bib',text:'@book{alpha,title={Alpha updated},year=2026}\n@book{new,title={Alpha new}}'};
  click(h.mount.querySelector('button[aria-label="Refresh library: original.bib"]'));await tick();
  assert.equal(h.calls.open,0);assert.deepEqual(h.calls.refresh,[{id:'canonical-one',name:'original.bib'}]);
  assert.equal(h.state.libraries.length,2);assert.equal(h.state.libraries[0].id,'one');assert.equal(h.state.libraries[0].name,'original.bib');assert.match(h.state.libraries[0].source,/Alpha updated/);
  assert.match(h.state.libraries[1].source,/Beta other/);assert.deepEqual(h.calls.set[0].updated,['one']);
  assert.equal(h.calls.remember.length,1);assert.equal(h.calls.remember[0].id,'one','the committed cache identity receives the refreshed source link');
  assert.equal(h.mount.querySelector('input[type="search"]').value,'Alpha');assert.equal(h.mount.querySelector('textarea[aria-label="BibTeX source"]').value,h.state.libraries[0].source);
  assert.match(h.mount.querySelector('[aria-label="Library entries"]').textContent,/Alpha updated/);assert.doesNotMatch(h.mount.querySelector('[aria-label="Library entries"]').textContent,/Beta other/);
  assert.equal(h.mount.querySelector('[role="status"]').textContent,'Library refreshed.');h.close();
 });
 await t.test('refresh cancellation and malformed BibTeX preserve the current library and never overwrite its source link',async()=>{
  const h=setup();await tick();const before=h.state.libraries;
  click(h.mount.querySelector('button[aria-label="Refresh library: original.bib"]'));await tick();
  assert.equal(h.state.libraries,before);assert.equal(h.calls.set.length,0);assert.equal(h.calls.remember.length,0);
  h.state.refreshResult={name:'original.bib',text:'@book{broken,title='};
  click(h.mount.querySelector('button[aria-label="Refresh library: original.bib"]'));await tick();
  assert.equal(h.state.libraries,before);assert.equal(h.calls.set.length,0);assert.equal(h.calls.remember.length,0);assert.match(h.mount.querySelector('[role="alert"]').textContent,/Invalid BibTeX/);
  assert.equal(h.calls.open,0);h.close();
 });
 await t.test('a library removed while its original file is being read is never recreated',async()=>{
  const h=setup();await tick();const read=deferred();h.state.refreshResult=read.promise;
  click(h.mount.querySelector('button[aria-label="Refresh library: original.bib"]'));await tick();
  h.state.libraries=h.state.libraries.filter(library=>library.id!=='one');flushSync(h.changed);
  read.resolve({name:'original.bib',text:'@book{alpha,title={Late contents}}'});await tick();
  assert.deepEqual(h.state.libraries.map(library=>library.id),['two']);assert.equal(h.calls.set.length,0);assert.equal(h.calls.remember.length,0);
  assert.equal(h.mount.querySelector('[role="alert"]').textContent,'This library is no longer available.');h.close();
 });
 await t.test('Add rejects duplicate filenames with Refresh guidance instead of replacing an existing library',async()=>{
  const h=setup();await tick();const before=h.state.libraries;h.state.openResult={name:'original.bib',text:'@book{different,title={Unrelated}}'};
  click(byText(h.mount,'Add .bib library'));await tick();
  assert.equal(h.calls.open,1);assert.equal(h.calls.refresh.length,0);assert.equal(h.calls.set.length,0);assert.equal(h.calls.remember.length,0);assert.equal(h.state.libraries,before);
  assert.match(h.mount.querySelector('[role="alert"]').textContent,/Refresh that library/);h.close();
 });
 await t.test('reference list format changes through its host setting without modifying library sources or numbers',async()=>{
  const h=setup();await tick();const before=h.state.libraries,select=h.mount.querySelector('select[aria-label="Reference list format"]');
  assert.ok([...select.options].some(option=>option.value==='apa'));
  flushSync(()=>{select.value='apa';select.dispatchEvent(new window.Event('change',{bubbles:true}));});await tick();
  assert.deepEqual(h.calls.style,['apa']);assert.equal(select.value,'apa');assert.equal(h.state.libraries,before);assert.equal(h.calls.set.length,0);assert.equal(h.calls.refresh.length,0);assert.equal(h.calls.remember.length,0);h.close();
 });
 await t.test('refresh remains successful when the source link cannot persist and reports the limitation',async()=>{
  const h=setup();await tick();h.state.persisted=false;h.state.refreshResult={name:'original.bib',text:'@book{alpha,title={Still updated}}'};
  click(h.mount.querySelector('button[aria-label="Refresh library: original.bib"]'));await tick();
  assert.match(h.state.libraries[0].source,/Still updated/);assert.equal(h.mount.querySelector('[role="alert"]'),null);
  assert.match(h.mount.querySelector('[role="status"]').textContent,/Library refreshed\..*source link could not be saved/);h.close();
 });
 await t.test('removal cleans both canonical and portable source links after committing the library removal',async()=>{
  const h=setup();await tick();click(byText(h.mount,'original.bib'));const cleanup=deferred();h.state.forgetResult=cleanup.promise;
  click(h.mount.querySelector('button[aria-label="Remove library: original.bib"]'));click(byText(h.mount,'Remove library'));await tick();
  assert.deepEqual(h.state.libraries.map(library=>library.id),['two']);assert.deepEqual(h.calls.forget,['canonical-one']);
  cleanup.resolve();await tick();assert.deepEqual(h.calls.forget,['canonical-one','one']);assert.equal(h.mount.querySelector('[role="alert"]'),null);
  assert.ok(byText(h.mount,'All libraries').className.includes('bg-muted'));assert.equal(h.mount.querySelector('button[aria-label="Remove library: original.bib"]'),null);h.close();
 });
 await window.happyDOM.abort();
});

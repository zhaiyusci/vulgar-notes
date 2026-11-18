const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const BIB=`% preserve this comment
@string{journalName = {The Computer Journal}}
@article{knuth1984,
  author = {Knuth, Donald E.},
  title = {Literate Programming},
  journal = journalName,
  year = {1984},
  keywords = {classic, computing},
  customfield = {Keep me}
}
@article{lamport1978,
  author = {Lamport, Leslie},
  title = {Time, Clocks, and the Ordering of Events},
  journal = {CACM},
  year = {1978}
}`;

async function fixture(t,{source=BIB,citedKeys=[],readOnly=false,otherLibraries=[]}={}){
  const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
  const keys=['localStorage','window','document','navigator','Node','NodeFilter','Text','Document','ShadowRoot','Element','HTMLElement','HTMLCollection','NodeList','MutationObserver','ResizeObserver','DOMRect','HTMLInputElement','HTMLTextAreaElement','HTMLDialogElement','Event','MouseEvent','PointerEvent','KeyboardEvent','CustomEvent','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','customElements','DOMParser','XMLSerializer','indexedDB'];
  const descriptors=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let indexedDBReads=0;
  for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,value:key==='indexedDB'?{open(){indexedDBReads++;throw Error('The editor must use its supplied MemoryBackend');}}:key==='window'?window:['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(key)?window[key].bind(window):window[key]});
  window.localStorage.setItem('editor.locale','en');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vulgar-bib-editor-')),outfile=path.join(directory,'harness.cjs');
  buildSync({stdin:{contents:"export * from './test/editor-harness';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,format:'cjs',platform:'node',outfile,loader:{'.css':'empty'},logLevel:'silent'});
  const harness=require(outfile),libraries=[{id:'lib-1',name:'main.bib',source},...otherLibraries];
  const host={libraries,readOnly,closed:false,saves:0,getBibliographyLibraries(){return this.libraries;},setBibliographyLibraries(next){assert.equal(this.readOnly,false,'read-only host must never receive a save');this.libraries=next;this.saves++;}};
  const container=window.document.createElement('div');window.document.body.append(container);
  harness.mount(container,host,libraries[0],()=>citedKeys,readOnly);
  t.after(async()=>{
    harness.unmount();await wait(20);await window.happyDOM.abort();
    for(const [key,descriptor] of descriptors)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
    assert.ok(directory.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(directory).startsWith('vulgar-bib-editor-'));
    fs.rmSync(directory,{recursive:true,force:true});
  });
  async function until(predicate,description){for(let attempt=0;attempt<100;attempt++){harness.flushSync(()=>{});if(predicate())return;await wait(20);}throw Error('Timed out: '+description+' '+container.textContent);}
  const button=text=>[...container.querySelectorAll('button')].find(element=>element.textContent.trim()===text);
  return {window,harness,container,host,library:libraries[0],until,button,indexedDBReads:()=>indexedDBReads};
}

test('editor connects its memory store before mounting and saving without edits preserves exact BibTeX',async t=>{
  const f=await fixture(t);await f.until(()=>f.host.store&&f.button('Save library')&&!f.button('Save library').disabled,'editable imported library');
  const widget=f.container.querySelector('bib-library');assert.ok(widget?.shadowRoot);assert.equal(widget.getAttribute('lang'),'en');
  assert.equal(widget.shadowRoot.querySelectorAll('li.item').length,2);assert.equal(f.indexedDBReads(),0);
  assert.deepEqual(f.host.store.items().find(item=>item.id==='knuth1984').tags,['classic','computing']);
  f.button('Save library').click();await f.until(()=>f.host.closed,'actual Save button commits and closes');
  assert.equal(f.host.saves,1);assert.equal(f.host.libraries[0].source,BIB);
});

test('record form edits title and tags while retaining comments, macros, unknown fields and untouched entries',async t=>{
  const f=await fixture(t);await f.until(()=>f.host.store&&!f.button('Save library').disabled,'ready store');
  const shadow=f.container.querySelector('bib-library').shadowRoot;
  const first=[...shadow.querySelectorAll('li.item')].find(item=>item.getAttribute('data-id')==='knuth1984');
  const edit=[...first.querySelectorAll('button')].find(button=>['Edit','编辑'].includes(button.textContent));assert.ok(edit);edit.click();
  await f.until(()=>shadow.querySelector('dialog[open] form [name=title]')?.value==='Literate Programming','entry form');
  const form=shadow.querySelector('dialog form');form.querySelector('[name=title]').value='Literate Programming (edited)';form.querySelector('[name=tags]').value='classic, edited';
  form.dispatchEvent(new f.window.Event('submit',{bubbles:true,cancelable:true}));
  await f.until(()=>f.host.store.items().find(item=>item.id==='knuth1984').csl.title.includes('(edited)'),'store updated');
  f.button('Save library').click();await f.until(()=>f.host.closed,'saved');
  const saved=f.host.libraries[0].source;assert.match(saved,/\(edited\)/);assert.match(saved,/keywords\s*=\s*\{classic, edited\}/);assert.match(saved,/customfield = \{Keep me\}/);assert.match(saved,/@string\{journalName = \{The Computer Journal\}\}/);assert.ok(saved.startsWith('% preserve this comment'));
  assert.ok(saved.includes(BIB.slice(BIB.indexOf('@article{lamport1978'))),'untouched entry remains byte-identical');
});

test('malformed initial source keeps Save disabled and cannot replace the original library with an empty one',async t=>{
  const f=await fixture(t,{source:'@article{broken,title={unfinished'});
  await f.until(()=>f.container.querySelector('[role=alert]'),'parse error');
  assert.equal(f.button('Save library').disabled,true);f.button('Save library').click();assert.equal(f.host.saves,0);assert.equal(f.host.libraries[0].source,f.library.source);assert.equal(f.host.closed,false);
});

test('saving detects a changed or removed library and read-only permission instead of discarding the draft',async t=>{
  const f=await fixture(t);await f.until(()=>f.host.store&&!f.button('Save library').disabled,'ready');
  f.host.libraries=[{...f.library,source:BIB+'\n% refreshed externally'}];f.button('Save library').click();await wait(10);
  assert.match(f.container.textContent,/changed while the editor was open/);assert.equal(f.host.closed,false);assert.equal(f.host.saves,0);
  f.host.libraries=[];f.button('Save library').click();await wait(10);assert.match(f.container.textContent,/no longer available/);assert.equal(f.host.saves,0);
  f.host.libraries=[f.library];f.host.readOnly=true;f.button('Save library').click();await wait(10);assert.match(f.container.textContent,/read-only/);assert.equal(f.host.saves,0);assert.equal(f.host.closed,false);
});

test('citation removal confirmation is recomputed after another edit and actual Save anyway commits',async t=>{
  const f=await fixture(t,{citedKeys:['knuth1984','lamport1978','already-missing']});await f.until(()=>f.host.store&&!f.button('Save library').disabled,'ready');
  await f.host.store.remove('knuth1984');await wait(10);f.button('Save library').click();await f.until(()=>f.button('Save anyway'),'first warning');
  assert.match(f.container.textContent,/knuth1984/);assert.doesNotMatch(f.container.querySelector('[role=alert]').textContent,/already-missing/);assert.equal(f.host.saves,0);
  await f.host.store.remove('lamport1978');await f.until(()=>f.button('Save library'),'edit resets confirmation');f.button('Save library').click();await f.until(()=>f.button('Save anyway'),'updated warning');
  assert.match(f.container.querySelector('[role=alert]').textContent,/lamport1978/);assert.equal(f.host.saves,0);
  f.button('Save anyway').click();await f.until(()=>f.host.closed,'confirmed save');assert.equal(f.host.saves,1);
});

test('citation enumeration excludes ref and eqref, while another library can satisfy a citation',async t=>{
  const f=await fixture(t);await f.until(()=>f.host.store&&!f.button('Save library').disabled,'ready');
  const keys=f.harness.citedReferenceKeys([{type:'p',children:[{text:''},{type:'tex_reference',command:'ref',keys:['section:a'],children:[{text:''}]},{type:'tex_reference',command:'eqref',keys:['equation:b'],children:[{text:''}]},{type:'tex_reference',command:'cite',keys:['knuth1984'],children:[{text:''}]}]}]);
  assert.deepEqual(keys,['knuth1984']);
  assert.deepEqual(f.harness.missingCitations([],[f.library,{id:'other',name:'other.bib',source:'@book{knuth1984,title={Elsewhere}}'}],f.library.id,keys),[]);
});

test('key conflicts across libraries fail before saving',async t=>{
  const f=await fixture(t,{otherLibraries:[{id:'other',name:'other.bib',source:'@book{occupied,title={Other}}'}]});await f.until(()=>f.host.store&&!f.button('Save library').disabled,'ready');
  await f.host.store.renameKey('knuth1984','occupied');await wait(10);f.button('Save library').click();await f.until(()=>f.container.querySelector('[role=alert]'),'duplicate key error');
  assert.equal(f.host.saves,0);assert.equal(f.host.closed,false);assert.equal(f.host.libraries[0].source,BIB);
});

test('a read-only editor exposes its draft without enabling Save or interactive edits',async t=>{
  const f=await fixture(t,{readOnly:true});await f.until(()=>f.host.store,'ready');
  assert.equal(f.button('Save library').disabled,true);assert.ok(f.container.querySelector('[inert]'));assert.match(f.container.textContent,/read-only/);
  f.button('Save library').click();assert.equal(f.host.saves,0);assert.equal(f.host.closed,false);
});

test('valid citation-key punctuation is preserved on initialization and no-op save',async t=>{
  const source='@article{author+2026/topic, title={A title}, year={2026}}';
  const f=await fixture(t,{source});await f.until(()=>f.host.store&&!f.button('Save library').disabled,'ready');
  assert.deepEqual(f.host.store.items().map(item=>item.id),['author+2026/topic']);
  f.button('Save library').click();await f.until(()=>f.host.closed,'saved');assert.equal(f.host.libraries[0].source,source);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {buildSync}=require('esbuild');
let compiled;
function source(){
  return compiled??=buildSync({entryPoints:['src/generated/bib-library.js'],bundle:true,write:false,platform:'browser',format:'cjs',target:'es2022'}).outputFiles[0].text;
}
async function environment(language='en'){
  const {Window}=await import('happy-dom');
  const window=new Window({url:'https://editor.example/'});window.localStorage.setItem('editor.locale',language);
  const timers=new Set,network=[],storage=[];let timer=0;
  const context={module:{exports:{}},console:{log:console.log,warn:console.warn,error:console.error,debug:console.debug},URL,Blob,TextEncoder,TextDecoder,Headers,Request,Response,AbortController,Intl,structuredClone,
    window,document:window.document,navigator:window.navigator,location:window.location,localStorage:window.localStorage,
    HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,HTMLTextAreaElement:window.HTMLTextAreaElement,
    customElements:window.customElements,CustomEvent:window.CustomEvent,Event:window.Event,
    setTimeout,clearTimeout,setInterval:()=>{const id=++timer;timers.add(id);return id;},clearInterval:id=>timers.delete(id),
    fetch:(...args)=>{network.push(args);throw Error('Network is forbidden in bibliography tests');},
    XMLHttpRequest:class{constructor(){network.push('XHR');throw Error('Network is forbidden in bibliography tests');}},
    indexedDB:{open(){storage.push('open');throw Error('Persistent storage was not requested');}},
    confirm:()=>true};
  context.exports=context.module.exports;
  vm.runInNewContext(source(),context,{timeout:10000});
  return {window,api:context.module.exports,timers,network,storage,dispose:()=>window.happyDOM.abort()};
}
const json=value=>JSON.parse(JSON.stringify(value));

test('editing a title leaves full creator identities, date precision, unknown metadata and valid citation keys intact',async()=>{
  const f=await environment();
  try{
    const key="O’Neil/ά+2026",item={id:key,type:'article-journal',title:'Original',author:[{literal:'Research Consortium'},{family:'Beethoven',given:'Ludwig','non-dropping-particle':'van',suffix:'Jr.'}],issued:{'date-parts':[[2026,11,9]],season:4},volume:7,'vulgar-source-key':key,custom:{a:true}};
    const form=f.api.cslToForm(item);form.title='Updated';
    const changed=f.api.formToCsl(form,item);
    assert.equal(changed.title,'Updated');assert.deepEqual(json(changed.author),item.author);assert.deepEqual(json(changed.issued),item.issued);assert.equal(changed.volume,7);assert.deepEqual(json(changed.custom),{a:true});
    const store=new f.api.BibliographyStore({backend:new f.api.MemoryBackend()});await store.ready();await store.importItems([item]);
    assert.equal(store.items()[0].id,key);assert.equal(store.items()[0].csl['vulgar-source-key'],key);
    const unsupported={...item,type:'article-magazine'};const unsupportedForm=f.api.cslToForm(unsupported);unsupportedForm.type='';unsupportedForm.title='Changed';
    assert.equal(f.api.formToCsl(unsupportedForm,unsupported).type,'article-magazine');
  }finally{await f.dispose();}
});

test('BibTeX parsing does not auto-fetch URLs or DOI strings disguised as a library',async()=>{
  const f=await environment();
  try{
    assert.equal(f.api.parseBibtex('@article{valid,title={A title},year={2026}}')[0].id,'valid');
    for(const input of ['https://example.invalid/private-library','10.1000/example'])assert.throws(()=>f.api.parseBibtex(input));
    assert.deepEqual(f.network,[]);
  }finally{await f.dispose();}
});

test('BibTeX exports retain the explicit citation key and use tags as the one keywords field',async()=>{
  const f=await environment();
  try{
    const csl={id:'new-entry',type:'article-journal',title:'New',author:[{family:'Researcher'}],issued:{'date-parts':[[2026]]},keyword:'old'};
    assert.match(f.api.toBibtex([{csl,tags:['tag'],id:'new-entry'}]),/^@article\{new-entry,/);
    assert.equal((f.api.toBibtex([{csl,tags:['tag']}]).match(/keywords\s*=/g)||[]).length,1);
    assert.doesNotMatch(f.api.toBibtex([{csl,tags:[]}]),/keywords\s*=/);
    const key="O’Neil/ά+2026";assert.ok(f.api.toBibtex([{...csl,id:key}]).startsWith('@article{'+key+','));
    for(const id of ['bad,key','bad\nkey','x}\n@misc{injected'])assert.throws(()=>f.api.toBibtex([{...csl,id}]),/Invalid citation key/);
    assert.equal(csl.keyword,'old');
  }finally{await f.dispose();}
});

for(const language of ['en','zh-CN'])test('vendor controls use '+language+' without translating user content or opening IndexedDB',async()=>{
  const f=await environment(language);
  try{
    const store=new f.api.BibliographyStore({backend:new f.api.MemoryBackend()});await store.ready();await store.importItems([{id:'编辑',type:'book',title:'编辑',author:[{literal:'中文作者'}],URL:'javascript:alert(1)'}]);
    const element=f.window.document.createElement('bib-library');await element.connect(store);f.window.document.body.append(element);
    const root=element.shadowRoot;
    assert.equal(root.querySelector('.item .title a'),null);
    assert.equal(root.querySelector('.item .title a')?.textContent??root.querySelector('.item .title')?.firstChild.textContent,'编辑');
    assert.equal(root.querySelector('.item .key').textContent,'编辑');
    assert.equal(root.querySelector('.toolbar .import').textContent,language==='en'?'Import .bib':'导入 .bib');
    const edit=[...root.querySelectorAll('.actions button')].find(button=>button.textContent===(language==='en'?'Edit':'编辑'));
    assert.ok(edit);edit.click();await new Promise(resolve=>setTimeout(resolve,15));
    assert.equal(root.querySelector('dialog h2').textContent,language==='en'?'Edit entry':'编辑条目');
    assert.equal(f.timers.size,1);element.remove();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.timers.size,0);
    assert.deepEqual(f.storage,[]);assert.deepEqual(f.network,[]);
  }finally{await f.dispose();}
});

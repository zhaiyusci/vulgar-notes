const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');

const source=build({
 entryPoints:['src/platform.ts'],bundle:true,write:false,format:'iife',globalName:'platform',
 plugins:[{name:'platform-test-adapters',setup(b){
  b.onResolve({filter:/^@tauri-apps\//},args=>({path:args.path,namespace:'platform-test'}));
  b.onResolve({filter:/^\.\/i18n$/},()=>({path:'i18n',namespace:'platform-test'}));
  b.onLoad({filter:/.*/,namespace:'platform-test'},({path})=>({contents:path==='i18n'
   ?'export const t=value=>value;'
   :path.endsWith('/core')
    ?'export const isTauri=()=>globalThis.platformTest.desktop;'
    :path.endsWith('/plugin-dialog')
     ?`export const open=async options=>{const s=globalThis.platformTest;s.opens.push(options);return s.openPath;};
       export const save=async options=>{const s=globalThis.platformTest;s.saves.push(options);return s.savePath;};
       export const confirm=async()=>true;`
     :`export const readTextFile=async path=>{const s=globalThis.platformTest;s.reads.push(path);return s.files[path];};
       export const writeFile=async(path,data)=>{globalThis.platformTest.writes.push({path,data});};`,loader:'js'}));
 }}],
}).then(result=>result.outputFiles[0].text);

async function harness(t,desktop=true){
 const {Window}=await import('happy-dom');
 const window=new Window({url:'http://localhost/'});
 window.document.write('<!doctype html><body></body>');
 const state=window.platformTest={desktop,openPath:null,savePath:null,opens:[],saves:[],reads:[],writes:[],files:{},downloads:[]};
 window.TextEncoder=TextEncoder;
 window.URL.createObjectURL=blob=>{state.downloadBlob=blob;return 'blob:test-document';};
 window.URL.revokeObjectURL=()=>{};
 window.setTimeout=()=>0;
 window.document.addEventListener('click',event=>{
  if(event.target.tagName==='A'){
   event.preventDefault();state.downloads.push({name:event.target.download,url:event.target.href});
  }
 });
 window.eval(await source+'\nwindow.platform=platform;');
 t.after(()=>window.happyDOM.abort());
 return {window,state,api:window.platform};
}

async function browserSelection(h,file,{cancel=false,bibtex=false}={}){
 const pending=bibtex?h.api.openBibtexFile():h.api.openDocumentFile();
 const input=h.window.document.querySelector('input[type="file"]');
 assert.ok(input,'opening a browser document must create a file picker');
 if(bibtex)assert.match(input.accept,/(?:^|,)\s*\.bib(?:,|$)/i);
 else{
  assert.match(input.accept,/(?:^|,)\s*\.vulgar(?:,|$)/i);
  assert.match(input.accept,/(?:^|,)\s*\.json(?:,|$)/i);
 }
 if(cancel)input.dispatchEvent(new h.window.Event('cancel'));
 else{
  Object.defineProperty(input,'files',{value:file?[file]:[]});
  input.dispatchEvent(new h.window.Event('change'));
 }
 return pending.finally(()=>assert.equal(h.window.document.querySelector('input[type="file"]'),null,'the temporary picker must be removed'));
}

test('desktop opens native and legacy documents case-insensitively with their data and original path',async t=>{
 const h=await harness(t),text='{"version":1,"value":[{"text":"数学"}]}';
 for(const path of ['C:\\notes\\draft.vulgar','C:\\notes\\legacy.JSON','C:\\notes\\DRAFT.VULGAR']){
  h.state.openPath=path;h.state.files[path]=text;
  const opened=await h.api.openDocumentFile();
  assert.equal(opened.path,path);assert.equal(opened.name,path.split('\\').pop());assert.equal(opened.text,text);
 }
 const filters=h.state.opens[0].filters;
 assert.ok(filters.some(filter=>/Vulgar Notes/i.test(filter.name)));
 assert.deepEqual(Array.from(new Set(filters.flatMap(filter=>Array.from(filter.extensions)))).sort(),['json','vulgar']);
 assert.equal(h.state.reads.length,3);
});

test('desktop cancellation and unrelated extensions never read document data',async t=>{
 const h=await harness(t);
 assert.equal(await h.api.openDocumentFile(),null);
 for(const path of ['C:\\notes\\draft.md','C:\\notes\\draft.vulgar.bak','C:\\notes\\draft.json.exe']){
  h.state.openPath=path;await assert.rejects(h.api.openDocumentFile());
 }
 assert.equal(h.state.reads.length,0);
});

test('browser opens native and legacy files with their actual JSON contents',async t=>{
 const h=await harness(t,false),text='{"version":1,"value":[{"text":"α 中文"}]}';
 for(const name of ['draft.vulgar','legacy.JSON','DRAFT.VULGAR']){
  const opened=await browserSelection(h,new h.window.File([text],name,{type:'application/json'}));
  assert.equal(opened.name,name);assert.equal(opened.text,text);assert.equal(opened.path,undefined);
 }
});

test('browser cancellation, empty selection and unsupported extensions do not produce a document',async t=>{
 const h=await harness(t,false);
 assert.equal(await browserSelection(h,null,{cancel:true}),null);
 assert.equal(await browserSelection(h,null),null);
 await assert.rejects(browserSelection(h,new h.window.File(['{}'],'draft.md',{type:'application/json'})));
});

test('new desktop saves and Save As use the native suffix and preserve JSON bytes',async t=>{
 const h=await harness(t),text='{"version":1,"value":[{"text":"β 中文"}]}';
 h.state.savePath='C:\\notes\\document.vulgar';
 let saved=await h.api.saveDocumentFile(text);
 assert.equal(saved.name,'document.vulgar');assert.equal(saved.path,h.state.savePath);
 assert.equal(h.state.saves[0].defaultPath,'document.vulgar');
 assert.deepEqual(Array.from(h.state.saves[0].filters.flatMap(filter=>Array.from(filter.extensions))),['vulgar']);
 assert.equal(Buffer.from(h.state.writes[0].data).toString('utf8'),text);
 h.state.savePath='C:\\notes\\legacy.vulgar';
 saved=await h.api.saveDocumentFile(text,undefined,'legacy.JSON');
 assert.equal(h.state.saves[1].defaultPath,'legacy.vulgar');assert.equal(saved.name,'legacy.vulgar');
 assert.equal(Buffer.from(h.state.writes[1].data).toString('utf8'),text);
});

test('direct desktop Save keeps the original native or legacy path without prompting',async t=>{
 const h=await harness(t),text='{"version":1,"value":[]}';
 for(const path of ['C:\\notes\\draft.vulgar','C:\\notes\\DRAFT.VULGAR','C:\\notes\\legacy.JSON']){
  const saved=await h.api.saveDocumentFile(text,path,path.split('\\').pop());
  assert.equal(saved.path,path);assert.equal(h.state.writes.at(-1).path,path);
  assert.equal(Buffer.from(h.state.writes.at(-1).data).toString('utf8'),text);
 }
 assert.equal(h.state.saves.length,0);
});

test('cancelled desktop saves and invalid new file suffixes never write data',async t=>{
 const h=await harness(t);
 assert.equal(await h.api.saveDocumentFile('{}'),null);
 for(const path of ['C:\\notes\\draft','C:\\notes\\draft.md','C:\\notes\\draft.json','C:\\notes\\draft.vulgar.bak']){
  h.state.savePath=path;await assert.rejects(h.api.saveDocumentFile('{}'));
 }
 assert.equal(h.state.writes.length,0);
});

test('browser saves download native files containing the unchanged JSON data',async t=>{
 const h=await harness(t,false),text='{"version":1,"value":[{"text":"正文"}]}';
 for(const [name,expected] of [[undefined,'document.vulgar'],['legacy.JSON','legacy.vulgar'],['draft.vulgar','draft.vulgar']]){
  const saved=await h.api.saveDocumentFile(text,undefined,name);
  assert.equal(saved.name,expected);assert.equal(saved.path,undefined);
  assert.equal(h.state.downloads.at(-1).name,expected);
  assert.equal(await h.state.downloadBlob.text(),text);
  assert.match(h.state.downloadBlob.type,/^application\/json/);
  assert.equal(h.window.document.querySelector('a'),null,'temporary download links must be removed');
 }
});

test('desktop bibliography picker is separate from native document opening and preserves BibTeX source',async t=>{
 const h=await harness(t),source='@article{paper, title={中文 and {LaTeX}}, year={2026}}';
 h.state.openPath='C:\\notes\\library.BIB';h.state.files[h.state.openPath]=source;
 const opened=await h.api.openBibtexFile();
 assert.equal(opened.name,'library.BIB');assert.equal(opened.text,source);
 assert.deepEqual(Array.from(h.state.opens[0].filters[0].extensions),['bib']);
 await assert.rejects(h.api.openDocumentFile());
 h.state.openPath='C:\\notes\\document.vulgar';await assert.rejects(h.api.openBibtexFile());
 assert.equal(h.state.reads.length,1);
 h.state.openPath=null;assert.equal(await h.api.openBibtexFile(),null);
});

test('browser bibliography picker accepts .bib only and cleans up after selection or cancellation',async t=>{
 const h=await harness(t,false),source='@book{2026/key, title={A book}}';
 const opened=await browserSelection(h,new h.window.File([source],'source.BIB'),{bibtex:true});
 assert.equal(opened.name,'source.BIB');assert.equal(opened.text,source);
 await assert.rejects(browserSelection(h,new h.window.File(['{}'],'document.json'),{bibtex:true}));
 assert.equal(await browserSelection(h,null,{bibtex:true,cancel:true}),null);
});

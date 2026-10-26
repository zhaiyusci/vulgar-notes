const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const compiled={exports:{}};
new Function('module','exports',buildSync({stdin:{contents:"export * from './src/bibliography-library-store';export {citedBibLibraries,parseBibLibraries} from './src/bibtex';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'browser',format:'cjs',target:'es2022'}).outputFiles[0].text)(compiled,compiled.exports);
const {CACHE_KEY,readLibraryCache,writeLibraryCache,restoreLibraryAttachments,citedBibLibraries,parseBibLibraries}=compiled.exports;
const full={id:'full',name:'Papers.bib',source:'@string{press={A Press}}\n@book{a,title={Book A},publisher=press}\n@book{b,title={Book B}}\n@book{c,title={UNSELECTED_LOCAL_RECORD}}'};
function storage(){const data=new Map();return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};}

test('full local catalog survives restart while portable snapshots still contain only cited records',()=>{
 const local=storage();writeLibraryCache([full],local);
 const snapshot=citedBibLibraries([full],['a','b']);
 assert.equal(parseBibLibraries(snapshot).length,2);assert.doesNotMatch(JSON.stringify(snapshot),/UNSELECTED_LOCAL_RECORD/);
 const restored=readLibraryCache(local);assert.equal(restored.error,undefined);assert.equal(restored.libraries[0].source,full.source);
 assert.match(local.getItem(CACHE_KEY),/UNSELECTED_LOCAL_RECORD/);
 const runtime=restoreLibraryAttachments(snapshot,restored.libraries);
 assert.equal(parseBibLibraries(runtime.libraries).length,3);assert.deepEqual(runtime.fullLibraryIds,['full']);assert.deepEqual(runtime.capturedOnlyIds,[]);
 assert.equal(runtime.cacheLibraryIds.full,'full');assert.equal(runtime.conflicts.length,0);
 assert.doesNotMatch(JSON.stringify(citedBibLibraries(runtime.libraries,['a','b'])),/UNSELECTED_LOCAL_RECORD/);
});

test('default cache uses window localStorage, independently of draft or unrelated globals',()=>{
 const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),previousLocal=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const local=storage(),unrelated=storage();
 Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:local}});
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:unrelated});
 try{writeLibraryCache([full]);assert.equal(readLibraryCache().libraries.length,1);assert.equal(unrelated.data.size,0);assert.equal(local.data.size,1);}
 finally{if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else delete globalThis.window;if(previousLocal)Object.defineProperty(globalThis,'localStorage',previousLocal);else delete globalThis.localStorage;}
});

test('invalid or inaccessible caches remain intact for recovery',()=>{
 const local=storage();
 for(const raw of ['not JSON',JSON.stringify({version:2,libraries:[]}),JSON.stringify({version:1,libraries:[{id:'bad',name:'bad.bib',source:'@book{bad,title='}]}),JSON.stringify({version:1,libraries:[full,full]})]){
  local.setItem(CACHE_KEY,raw);const read=readLibraryCache(local);assert.deepEqual(read.libraries,[]);assert.ok(read.error);assert.equal(local.getItem(CACHE_KEY),raw);
 }
 const denied=readLibraryCache({getItem(){throw Error('Storage denied');}});assert.equal(denied.error,'Storage denied');assert.deepEqual(denied.libraries,[]);
});

test('invalid writes and quota errors preserve the previous complete catalog',()=>{
 const local=storage();writeLibraryCache([full],local);const before=local.getItem(CACHE_KEY);
 assert.throws(()=>writeLibraryCache([full,{...full,id:'other'}],local),/Duplicate citation key/);assert.equal(local.getItem(CACHE_KEY),before);
 assert.throws(()=>writeLibraryCache([{id:'bad',name:'bad.bib',source:'@book{bad,title='}],local));assert.equal(local.getItem(CACHE_KEY),before);
 assert.throws(()=>writeLibraryCache([],{setItem(){throw Error('Quota exceeded');}}),/Quota exceeded/);assert.equal(local.getItem(CACHE_KEY),before);
});

test('an explicit replacement preserves a corrupt catalog before overwriting its main key',()=>{
 const local=storage(),raw='{corrupt private catalog';local.setItem(CACHE_KEY,raw);
 writeLibraryCache([full],local);assert.equal(local.getItem(CACHE_KEY+'-recovery'),raw);assert.equal(readLibraryCache(local).libraries.length,1);
 const firstRecovery=local.getItem(CACHE_KEY+'-recovery');local.setItem(CACHE_KEY,'another corrupt value');
 writeLibraryCache([full],local);assert.equal(local.getItem(CACHE_KEY+'-recovery'),firstRecovery);
 const denied=storage();denied.setItem(CACHE_KEY,raw);
 assert.throws(()=>writeLibraryCache([full],{getItem:denied.getItem,setItem(key,value){if(key.endsWith('-recovery'))throw Error('Backup quota exceeded');denied.setItem(key,value);}}),/Backup quota/);
 assert.equal(denied.getItem(CACHE_KEY),raw,'a failed recovery backup must leave the original key intact');
});

test('stable id reattaches full sources while preserving the document attachment name',()=>{
 const [captured]=structuredClone(citedBibLibraries([full],['a']));captured.name='Renamed in document.bib';
 const restored=restoreLibraryAttachments([captured],[full]);
 assert.equal(restored.libraries[0].source,full.source);assert.equal(restored.libraries[0].name,captured.name);assert.equal(restored.cacheLibraryIds.full,'full');
});

test('portable ids map back to cached ids only after exact source proof, never filename alone',()=>{
 const [snapshot]=structuredClone(citedBibLibraries([full],['a']));snapshot.id='portable-copy';
 const restored=restoreLibraryAttachments([snapshot],[full]);
 assert.equal(restored.libraries.length,1);assert.equal(restored.libraries[0].id,'portable-copy');assert.equal(restored.libraries[0].source,full.source);
 assert.equal(restored.cacheLibraryIds['portable-copy'],'full');assert.deepEqual(restored.fullLibraryIds,['portable-copy']);
 const unrelated={id:'unrelated',name:full.name,source:'@book{unrelated,title={Different library}}'};
 const separate=restoreLibraryAttachments([unrelated],[full]);assert.equal(separate.libraries.length,2);assert.equal(separate.libraries[0].source,unrelated.source);assert.deepEqual(separate.capturedOnlyIds,['unrelated']);
});

test('changed or missing captured records remain authoritative and do not overwrite the local source',()=>{
 const [snapshot]=citedBibLibraries([full],['a']);
 const changed={...snapshot,source:snapshot.source.replace('Book A','Older captured title')};
 const before=JSON.stringify(full),restored=restoreLibraryAttachments([changed],[full]);
 assert.deepEqual(restored.libraries,[changed]);assert.deepEqual(restored.capturedOnlyIds,['full']);assert.equal(restored.conflicts[0].reason,'source-mismatch');assert.equal(restored.cacheLibraryIds.full,'full');
 const missing={...snapshot,source:'@book{missing,title={Retained only in the document}}'};
 assert.equal(restoreLibraryAttachments([missing],[full]).libraries[0].source,missing.source);assert.equal(JSON.stringify(full),before);
});

test('source identity includes macro context even when original raw entry text and keys are identical',()=>{
 const cached={id:'macro',name:'Macro.bib',source:'@string{press={New Press}}\n@book{a,title={Same title},publisher=press}'};
 const original={...cached,source:cached.source.replace('New Press','Old Press')};
 const [snapshot]=citedBibLibraries([original],['a']);
 const restored=restoreLibraryAttachments([snapshot],[cached]);assert.equal(restored.conflicts[0].reason,'source-mismatch');assert.equal(restored.libraries[0].source,snapshot.source);
});

test('global catalog restores nonconflicting sources and reports collisions without losing document captures',()=>{
 const captured={id:'portable',name:'Captured.bib',source:'@book{a,title={Document version}}'};
 const other={id:'other',name:'Other.bib',source:'@book{other,title={Another local library}}'};
 const cached=[full,other],before=JSON.stringify(cached),restored=restoreLibraryAttachments([captured],cached);
 assert.deepEqual(restored.libraries.map(library=>library.id),['portable','other']);assert.equal(restored.libraries[0].source,captured.source);
 assert.deepEqual(restored.fullLibraryIds,['other']);assert.deepEqual(restored.conflicts[0].keys,['a']);assert.equal(restored.conflicts[0].reason,'duplicate-key');assert.equal(JSON.stringify(cached),before);
 assert.equal(parseBibLibraries(restored.libraries).length,2);
});

test('reattaching a full superset cannot introduce a duplicate from another saved source',()=>{
 const [snapshot]=citedBibLibraries([full],['a']);
 const independent={id:'separate',name:'Separate.bib',source:'@book{c,title={A different saved record}}'};
 const restored=restoreLibraryAttachments([snapshot,independent],[full]);
 assert.deepEqual(restored.libraries.map(library=>library.id),['full','separate']);assert.equal(parseBibLibraries(restored.libraries).length,2);
 assert.deepEqual(restored.conflicts[0].keys,['c']);assert.equal(restored.conflicts[0].reason,'duplicate-key');assert.deepEqual(restored.fullLibraryIds,[]);
});

test('reserved manual keys block newly introduced conflicts while preserving existing captured ambiguity',()=>{
 const none=restoreLibraryAttachments([],[full],['a']);assert.deepEqual(none.libraries,[]);assert.deepEqual(none.conflicts[0].keys,['a']);
 const [snapshot]=citedBibLibraries([full],['a']);
 const existing=restoreLibraryAttachments([snapshot],[full],['a']);assert.equal(existing.libraries[0].source,full.source);
 const introduced=restoreLibraryAttachments([snapshot],[full],['b']);assert.equal(introduced.libraries[0].source,snapshot.source);assert.deepEqual(introduced.conflicts[0].keys,['b']);
});

test('catalog merges never mutate documents, snapshots, source strings or identities',()=>{
 const snapshot=citedBibLibraries([full],['a']),before=JSON.stringify({snapshot,full});
 restoreLibraryAttachments(snapshot,[full]);assert.equal(JSON.stringify({snapshot,full}),before);
 const empty=restoreLibraryAttachments([],[]);assert.deepEqual(empty.libraries,[]);assert.deepEqual(empty.conflicts,[]);
});

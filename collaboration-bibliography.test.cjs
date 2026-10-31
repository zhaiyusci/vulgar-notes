const test=require('node:test');
const assert=require('node:assert/strict');
const Y=require('yjs');
const {buildSync}=require('esbuild');
const api={exports:{}};
const source=buildSync({stdin:{contents:"export * from './src/collaboration-bibliography';export {citedBibRecords,parseBibLibraries,parseBibLibrary} from './src/bibtex';",resolveDir:__dirname,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'browser',external:['yjs']}).outputFiles[0].text;
new Function('require','module','exports',source)(require,api,api.exports);
const {CollaborativeBibliography,citedBibRecords,parseBibLibraries,parseBibLibrary}=api.exports;
const library=(source,id='main',name='references.bib')=>({id,name,source});
function peers(t){
 const a=new Y.Doc(),b=new Y.Doc(),left=new CollaborativeBibliography(a,{}),right=new CollaborativeBibliography(b,{});
 t.after(()=>{left.destroy();right.destroy();a.destroy();b.destroy();});
 return {a,b,left,right};
}
function exchange(a,b){const fromA=Y.encodeStateAsUpdate(a),fromB=Y.encodeStateAsUpdate(b);Y.applyUpdate(a,fromB);Y.applyUpdate(b,fromA);}
const keys=libraries=>parseBibLibraries(libraries).map(entry=>entry.key).sort();

test('two peers citing distinct entries in the same source retain their union',t=>{
 const {a,b,left,right}=peers(t),full=[library('@book{a,title={First}}\n@book{b,title={Second}}\n@book{secret,title={UNRELATED_LOCAL_LIBRARY_CONTENT}}')];
 left.publish(full,['a']);right.publish(full,['b']);exchange(a,b);
 assert.deepEqual(keys(left.read()),['a','b']);assert.deepEqual(left.read(),right.read());
 assert.equal(left.read().length,1);assert.equal(left.read()[0].id,'main');
 assert.doesNotMatch(JSON.stringify(left.state.toJSON()),/UNRELATED_LOCAL_LIBRARY_CONTENT|secret/);
 assert.match(full[0].source,/UNRELATED_LOCAL_LIBRARY_CONTENT/);
});

test('a stale citation list never removes another peer’s referenced records',t=>{
 const {a,b,left,right}=peers(t),full=[library('@book{a,title={First}}\n@book{b,title={Second}}')];
 left.publish(full,['a']);right.publish(full,['b']);exchange(a,b);
 left.publish(full,['a']);right.publish(full,[]);exchange(a,b);
 assert.deepEqual(keys(left.read()),['a','b']);assert.deepEqual(keys(right.read()),['a','b']);
});

test('stale local records do not echo over a refreshed remote entry, but actual local refreshes propagate',t=>{
 const {a,b,left,right}=peers(t),old=[library('@book{a,title={Old title}}')],updated=[library('@book{a,title={Updated remotely}}')];
 left.publish(old,['a']);exchange(a,b);right.publish(old,['a']);
 right.publish(updated,['a']);exchange(a,b);
 left.publish(old,['a']);exchange(a,b);
 assert.equal(parseBibLibraries(left.read())[0].title,'Updated remotely');
 const changed=[library('@book{a,title={A new local refresh}}')];left.publish(changed,['a']);exchange(a,b);
 assert.equal(parseBibLibraries(right.read())[0].title,'A new local refresh');
});

test('a joining peer’s first old cache view cannot overwrite the room’s current reference',t=>{
 const {a,b,left,right}=peers(t);
 left.publish([library('@book{a,title={Room version}}')],['a']);exchange(a,b);
 right.publish([library('@book{a,title={Older private cache version}}')],['a']);exchange(a,b);
 assert.equal(parseBibLibraries(left.read())[0].title,'Room version');
});

test('macros expand per record without changing raw TeX, accents, braces, concatenation or original sources',t=>{
 const {a,b,left,right}=peers(t);
 const old=library(String.raw`@string{j={Old Journal}}
@article{a,title={A {NASA} \textbf{G\"odel} paper},journal=j # " Supplement",author={G\"odel, Kurt},customfield={Keep \alpha and {braces}}}`);
 const fresh=library(String.raw`@string{j={New Journal}} @article{b,title={Second},journal=j}`);
 const original=old.source;
 left.publish([old],['a']);right.publish([fresh],['b']);exchange(a,b);
 const merged=left.read();assert.equal(merged.length,1);assert.doesNotMatch(merged[0].source,/@string/);
 assert.match(merged[0].source,/journal = \{Old Journal Supplement\}/);assert.match(merged[0].source,/journal = \{New Journal\}/);
 assert.match(merged[0].source,/\\textbf\{G\\"odel\}/);assert.match(merged[0].source,/Keep \\alpha and \{braces\}/);
 const parsed=parseBibLibraries(merged);assert.match(parsed.find(entry=>entry.key==='a').description,/Old Journal Supplement/);assert.match(parsed.find(entry=>entry.key==='b').description,/New Journal/);
 assert.equal(old.source,original);
});

test('preambles expand their own macros and shared dependencies include recursive crossref and xdata parents',t=>{
 const {left}=peers(t);
 const libraries=[
  library(String.raw`@string{word={\newcommand{\myword}{Example}}} @preamble{word}
@proceedings{parent,title={Parent},year=2024,xdata={shared}}
@xdata{shared,publisher={Publisher},xdata={cycle}}
@xdata{cycle,xdata={shared}}
@book{unused,title={PRIVATE_UNUSED_ENTRY}}`,'parents','parents.bib'),
  library('@inproceedings{chapter,title={Chapter},crossref={parent}}','children','children.bib'),
 ];
 const original=JSON.stringify(libraries);left.publish(libraries,['chapter']);
 const records=left.read();assert.deepEqual(keys(records),['chapter','cycle','parent','shared']);
 assert.match(records.find(entry=>entry.id==='parents').source,/@preamble\{\{\\newcommand\{\\myword\}\{Example\}\}\}/);
 assert.doesNotMatch(JSON.stringify(left.state.toJSON()),/PRIVATE_UNUSED_ENTRY/);
 assert.equal(parseBibLibraries(records).find(entry=>entry.key==='chapter').year,'2024');assert.equal(JSON.stringify(libraries),original);
});

test('different preamble contexts retain independent captured sources and re-publishing read output is inert',t=>{
 const {a,b,left,right}=peers(t);
 left.publish([library('@preamble{"\\providecommand{\\word}{A}"}\n@book{a,title={\\word}}')],['a']);
 right.publish([library('@preamble{"\\providecommand{\\word}{B}"}\n@book{b,title={\\word}}')],['b']);exchange(a,b);
 const libraries=left.read();assert.equal(libraries.length,2);assert.notEqual(libraries[0].id,libraries[1].id);
 assert.match(libraries.find(item=>parseBibLibrary(item)[0].key==='a').source,/\\word\}\{A\}/);
 assert.match(libraries.find(item=>parseBibLibrary(item)[0].key==='b').source,/\\word\}\{B\}/);
 left.publish(libraries,['a','b']);const before=Y.encodeStateVector(a);left.publish(left.read(),['a','b']);assert.deepEqual(Y.encodeStateVector(a),before);
 assert.deepEqual(left.read(),right.read());
});

test('identical publish calls and empty or missing citations create no Yjs writes',t=>{
 const {a,left}=peers(t),full=[library('@book{a,title={First}}')];
 left.publish(full,['missing']);assert.equal(left.state.size,0);
 left.publish(full,['a']);const before=Y.encodeStateVector(a);left.publish(full,['a','a']);left.publish(full,[]);
 assert.deepEqual(Y.encodeStateVector(a),before);
});

test('malformed incoming record data is rejected without replacing the shared map',t=>{
 const {left}=peers(t);left.state.set('a',{version:1,key:'a',type:'book',libraryId:'main',libraryName:'a.bib',fields:{title:4},preambles:[]});
 const before=JSON.stringify(left.state.toJSON());assert.throws(()=>left.read(),/Invalid shared bibliography/);assert.equal(JSON.stringify(left.state.toJSON()),before);
});

test('a supplied document undo manager observes local bibliography refreshes and excludes remote changes',t=>{
 const a=new Y.Doc(),b=new Y.Doc(),origin={},prose=a.getText('prose'),manager=new Y.UndoManager(prose,{trackedOrigins:new Set([origin])}),left=new CollaborativeBibliography(a,origin,manager),right=new CollaborativeBibliography(b,{});
 t.after(()=>{left.destroy();right.destroy();manager.destroy();a.destroy();b.destroy();});
 left.publish([library('@book{a,title={First}}')],['a']);manager.clear();exchange(a,b);
 right.publish([library('@book{b,title={Remote}}')],['b']);exchange(a,b);assert.equal(manager.undoStack.length,0);
 left.publish([library('@book{a,title={Local update}}')],['a']);manager.undo();exchange(a,b);
 assert.equal(parseBibLibraries(left.read()).find(entry=>entry.key==='a').title,'First');assert.deepEqual(keys(left.read()),['a','b']);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const Y=require('yjs');
const {buildSync}=require('esbuild');
const bundled=buildSync({stdin:{contents:"export * from './src/collaboration-math';export {EditorModel,setMathIdNamespace} from './src/editor-model';",resolveDir:__dirname,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node',external:['yjs']}).outputFiles[0].text;
const compiled={exports:{}};new Function('require','module','exports',bundled)(require,compiled,compiled.exports);
const {CollaborativeMathStore,EditorModel,setMathIdNamespace}=compiled.exports;
const restore=snapshot=>{const model=new EditorModel();model.restore(snapshot);return model;};
const blank=text=>{const model=new EditorModel();model.root.items=Array.from(text);model.index();model.setCursor(model.root.id,model.root.items.length);return model;};
function peers(t,model=blank('x')){
 const a=new Y.Doc(),b=new Y.Doc(),originA={},originB={};
 const left=new CollaborativeMathStore(a,originA),right=new CollaborativeMathStore(b,originB);
 left.ensure('formula',model.snapshot());Y.applyUpdate(b,Y.encodeStateAsUpdate(a));
 t.after(()=>{left.destroy();right.destroy();a.destroy();b.destroy();setMathIdNamespace();});
 return {a,b,left,right,base:model.snapshot()};
}
function exchange(a,b){const fromA=Y.encodeStateAsUpdate(a),fromB=Y.encodeStateAsUpdate(b);Y.applyUpdate(a,fromB);Y.applyUpdate(b,fromA);}
function edit(store,before,change){const model=restore(before);change(model);store.stopCapturing();store.publish('formula',before,model.snapshot());return model.snapshot();}
const content=snapshot=>JSON.stringify(JSON.parse(snapshot).root);

test('concurrent same-region typing merges at character granularity and converges after offline exchange',t=>{
 const {a,b,left,right,base}=peers(t);
 edit(left,base,model=>model.insert('A'));edit(right,base,model=>model.insert('B'));
 exchange(a,b);
 const first=left.read('formula'),second=right.read('formula');
 assert.equal(content(first),content(second));
 const text=restore(first).exportLatex();assert.ok(text==='xAB'||text==='xBA',text);
});

test('concurrent structure insertions stay independent and nested argument content survives',t=>{
 const {a,b,left,right,base}=peers(t,blank(''));
 setMathIdNamespace('peer-left');
 edit(left,base,model=>{model.insertStructure('frac');model.insert('a');});
 setMathIdNamespace('peer-right');
 edit(right,base,model=>{model.insertStructure('sqrt');model.insert('b');});
 exchange(a,b);
 const merged=restore(left.read('formula'));
 assert.equal(content(left.read('formula')),content(right.read('formula')));
 assert.equal(merged.root.items.length,2);assert.deepEqual(new Set(merged.root.items.map(item=>item.type)),new Set(['frac','sqrt']));
 assert.match(merged.exportLatex(),/a/);assert.match(merged.exportLatex(),/b/);
 assert.equal(merged.nodes.size,2);
});

test('simultaneous numerator and denominator edits both remain in the shared fraction',t=>{
 const model=blank('');model.insertStructure('frac');model.insert('n');const fraction=model.root.items[0];model.setCursor(fraction.regions[1].id,0);model.insert('d');
 const {a,b,left,right,base}=peers(t,model);
 edit(left,base,next=>{next.setCursor(fraction.regions[0].id,1);next.insert('+a');});
 edit(right,base,next=>{next.setCursor(fraction.regions[1].id,1);next.insert('+b');});
 exchange(a,b);
 assert.equal(restore(left.read('formula')).exportLatex(),'\\frac{n+a}{d+b}');
 assert.equal(content(left.read('formula')),content(right.read('formula')));
});

test('a variant descriptor changes atomically while concurrent edits inside its argument merge',t=>{
 const model=blank('');model.insertStructure('sqrt');model.insert('x');const root=model.root.items[0];
 const {a,b,left,right,base}=peers(t,model);
 setMathIdNamespace('variant-author');
 edit(left,base,next=>{assert.equal(next.switchVariant(root.id,'nthroot'),true);next.insert('3');});
 edit(right,base,next=>{next.setCursor(root.regions[0].id,1);next.insert('+y');});
 exchange(a,b);
 const result=restore(left.read('formula'));
 assert.equal(result.root.items[0].type,'nthroot');assert.equal(result.root.items[0].regions.length,2);
 assert.match(result.exportLatex(),/x\+y/);assert.match(result.exportLatex(),/\[3\]/);
 assert.equal(content(left.read('formula')),content(right.read('formula')));
});

test('relative positions preserve the local selection when remote edits precede it',t=>{
 const {a,b,left,right,base}=peers(t,blank('abcd'));
 const local=restore(base);local.setCursor(local.root.id,3,1);local.pendingFont='font-mathbf';
 const cursor=left.captureCursor('formula',local.snapshot());
 edit(right,base,next=>{next.setCursor(next.root.id,0);next.insert('𠮷');});
 exchange(a,b);
 const result=restore(left.read('formula',local.snapshot(),cursor));
 assert.deepEqual(result.cursor,{region:local.root.id,offset:4,anchor:2});
 assert.equal(result.pendingFont,'font-mathbf');assert.equal(result.root.items.length,5);
 assert.equal(JSON.stringify(left.sharedRoot.toJSON()).includes('cursor'),false);
 assert.equal(JSON.stringify(left.sharedRoot.toJSON()).includes('pendingFont'),false);
});

test('concurrent matrix row and column configuration changes always retain one valid atomic shape',t=>{
 const model=blank('');model.insertStructure('matrix');model.insert('a');const matrix=model.root.items[0];
 const {a,b,left,right,base}=peers(t,model);
 setMathIdNamespace('row-peer');edit(left,base,next=>assert.equal(next.editMatrix(matrix.id,matrix.regions[0].id,'rowAfter'),true));
 setMathIdNamespace('column-peer');edit(right,base,next=>assert.equal(next.editMatrix(matrix.id,matrix.regions[0].id,'columnAfter'),true));
 exchange(a,b);
 const result=restore(left.read('formula')).root.items[0];
 assert.ok(result.rows===3&&result.columns===2||result.rows===2&&result.columns===3);
 assert.equal(result.regions.length,result.rows*result.columns);
 assert.equal(result.regions[0].items.join(''),'a');
 assert.equal(content(left.read('formula')),content(right.read('formula')));
});

test('cursor and pending-font changes never create shared content updates or undo entries',t=>{
 const {a,left,base}=peers(t,blank('abc')),before=Y.encodeStateVector(a),local=restore(base);
 local.setCursor(local.root.id,1,0);local.pendingFont='font-mathbf';
 left.publish('formula',base,local.snapshot());
 assert.deepEqual(Y.encodeStateVector(a),before);assert.equal(left.undoManager.undoStack.length,0);
 assert.equal(JSON.stringify(left.sharedRoot.toJSON()).includes('pendingFont'),false);
});

test('local undo removes only this peer’s edit and retains remote changes',t=>{
 const {a,b,left,right,base}=peers(t);
 edit(left,base,model=>model.insert('A'));edit(right,base,model=>model.insert('B'));exchange(a,b);
 assert.equal(left.undo(),true);exchange(a,b);
 assert.equal(restore(left.read('formula')).exportLatex(),'xB');
 assert.equal(restore(right.read('formula')).exportLatex(),'xB');
 assert.equal(left.redo(),true);exchange(a,b);
 const output=restore(right.read('formula')).exportLatex();assert.match(output,/A/);assert.match(output,/B/);
});

test('a shared undo manager includes formula changes and outlives the formula store',t=>{
 const doc=new Y.Doc(),prose=doc.getText('prose'),origin={},manager=new Y.UndoManager(prose,{trackedOrigins:new Set([origin])});
 const store=new CollaborativeMathStore(doc,origin,manager),model=blank('x');store.ensure('formula',model.snapshot());
 assert.equal(store.undoManager,manager);assert.ok(manager.scope.includes(store.sharedRoot));
 edit(store,model.snapshot(),next=>next.insert('y'));assert.equal(manager.undoStack.length,1);
 manager.undo();assert.equal(restore(store.read('formula')).exportLatex(),'x');
 store.destroy();manager.stopCapturing();doc.transact(()=>prose.insert(0,'still active'),origin);manager.undo();assert.equal(prose.toString(),'');
 manager.destroy();doc.destroy();
});

test('notifications name only changed formulas and report incoming updates as remote',t=>{
 const {a,b,left,right,base}=peers(t),events=[];
 const unsubscribe=left.subscribe((ids,local)=>events.push({ids,local}));
 edit(right,base,next=>next.insert('remote'));Y.applyUpdate(a,Y.encodeStateAsUpdate(b));
 assert.deepEqual(events,[{ids:['formula'],local:false}]);unsubscribe();
});

test('distributed numeric IDs remain distinct after observing another client’s IDs',()=>{
 setMathIdNamespace('client-A');const a=blank('');a.insertStructure('frac');const originalA=a.snapshot();
 setMathIdNamespace('client-B');const b=restore(originalA);b.setCursor(b.root.id,b.root.items.length);b.insertStructure('sqrt');const newB=b.root.items[1];
 setMathIdNamespace('client-A');const restoredA=restore(b.snapshot());restoredA.setCursor(restoredA.root.id,restoredA.root.items.length);restoredA.insertStructure('sqrt');const nextA=restoredA.root.items[2];
 assert.notEqual(newB.id,nextA.id);assert.notEqual(newB.regions[0].id,nextA.regions[0].id);
 assert.match(nextA.id,/^n\d+$/);assert.match(nextA.regions[0].id,/^r\d+$/);
 assert.doesNotThrow(()=>restore(restoredA.snapshot()));setMathIdNamespace();
});

test('a stale native CJK replacement rebases past a remote insertion before the edited range',t=>{
 const {a,b,left,right,base}=peers(t,blank('abc'));
 left.captureCursor('formula',base);
 edit(right,base,next=>{next.setCursor(next.root.id,0);next.insert('远');});Y.applyUpdate(a,Y.encodeStateAsUpdate(b));
 const stale=restore(base);stale.replace(1,2,'中');left.publish('formula',base,stale.snapshot());exchange(a,b);
 assert.equal(restore(left.read('formula')).exportLatex(),'远a中c');
 assert.equal(content(left.read('formula')),content(right.read('formula')));
});

test('a stale replacement deletes only original characters and retains a remote insertion inside its selection',t=>{
 const {a,b,left,right,base}=peers(t,blank('abcd'));
 edit(right,base,next=>{next.setCursor(next.root.id,2);next.insert('远');});Y.applyUpdate(a,Y.encodeStateAsUpdate(b));
 const stale=restore(base);stale.replace(1,3,'汉');left.publish('formula',base,stale.snapshot());exchange(a,b);
 assert.equal(restore(left.read('formula')).exportLatex(),'a汉远d');
 assert.equal(content(left.read('formula')),content(right.read('formula')));
});

test('a stale CJK edit preserves a concurrently inserted nested structure within its old selection',t=>{
 const {a,b,left,right,base}=peers(t,blank('abcd'));
 setMathIdNamespace('remote-structure');
 edit(right,base,next=>{next.setCursor(next.root.id,2);next.insertStructure('sqrt');next.insert('r');});Y.applyUpdate(a,Y.encodeStateAsUpdate(b));
 const stale=restore(base);stale.replace(1,3,'中');left.publish('formula',base,stale.snapshot());exchange(a,b);
 const merged=restore(left.read('formula'));
 assert.equal(merged.root.items.length,4);assert.equal(merged.root.items[2].type,'sqrt');
 assert.equal(merged.root.items[2].regions[0].items.join(''),'r');assert.equal(merged.exportLatex(),'a中\\sqrt{r}d');
});

test('deleting an already removed original never deletes a new identical remote character beside its tombstone',t=>{
 const {a,b,left,right,base}=peers(t,blank('aab'));
 const deleted=edit(right,base,next=>next.replace(1,2,''));
 edit(right,deleted,next=>{next.setCursor(next.root.id,1);next.insert('a');});Y.applyUpdate(a,Y.encodeStateAsUpdate(b));
 // The visible text is again aab, but the second a has a different CRDT ID.
 // Neither a remote restore nor read is allowed while native IME owns input.
 left.captureCursor('formula',base);
 const stale=restore(base);stale.replace(1,2,'');left.publish('formula',base,stale.snapshot());exchange(a,b);
 assert.equal(restore(left.read('formula')).exportLatex(),'aab');
});

test('an explicit fresh read updates identical-text identities for later intentional edits',t=>{
 const {a,b,left,right,base}=peers(t,blank('aab'));
 const deleted=edit(right,base,next=>next.replace(1,2,''));
 edit(right,deleted,next=>{next.setCursor(next.root.id,1);next.insert('a');});Y.applyUpdate(a,Y.encodeStateAsUpdate(b));
 const fresh=left.read('formula',base),next=restore(fresh);next.replace(1,2,'');left.publish('formula',fresh,next.snapshot());exchange(a,b);
 assert.equal(restore(right.read('formula')).exportLatex(),'ab');
});

test('missing baseline rejects a stale edit before any shared nodes, regions or text are mutated',t=>{
 const {a,left}=peers(t),foreign=blank('unknown'),before=foreign.snapshot();foreign.insertStructure('sqrt');foreign.insert('中');
 const state=Y.encodeStateAsUpdate(a);
 assert.throws(()=>left.publish('formula',before,foreign.snapshot()),/no valid shared baseline/);
 assert.deepEqual(Y.encodeStateAsUpdate(a),state);
});

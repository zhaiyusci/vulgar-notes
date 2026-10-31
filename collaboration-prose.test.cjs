const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const Y=require('yjs');
const {buildSync}=require('esbuild');

const source=buildSync({stdin:{contents:`
export {CollaborativeProseBinding,collaborationProseValue} from './src/collaboration-prose';
export {createPlateEditor} from 'platejs/react';
export {BaseEquationPlugin,BaseInlineEquationPlugin} from './src/plate-math-plugins';
export {yTextToSlateElement} from '@slate-yjs/core';
`,resolveDir:path.resolve('.'),loader:'ts'},bundle:true,format:'cjs',platform:'node',write:false,external:['yjs']}).outputFiles[0].text;
const compiled={exports:{}};
new Function('require','module','exports',source)(require,compiled,compiled.exports);
const {CollaborativeProseBinding,collaborationProseValue,createPlateEditor,BaseEquationPlugin,BaseInlineEquationPlugin,yTextToSlateElement}=compiled.exports;
const paragraph=text=>({type:'p',children:[{text}]});
const value=editor=>JSON.parse(JSON.stringify(editor.children));
const text=editor=>editor.children.map(node=>node.children.map(child=>child.text??'').join('')).join('\n');
const editor=initial=>createPlateEditor({plugins:[BaseEquationPlugin,BaseInlineEquationPlugin],value:initial,nodeId:false});
function peer(initial=[paragraph('')],hooks){
  const doc=new Y.Doc(),slate=editor(initial),binding=new CollaborativeProseBinding(slate,doc,Symbol('local'),hooks);
  return {doc,editor:slate,binding};
}
function exchange(a,b){
  a.binding.flush();b.binding.flush();
  const left=Y.encodeStateAsUpdate(a.doc,Y.encodeStateVector(b.doc));
  const right=Y.encodeStateAsUpdate(b.doc,Y.encodeStateVector(a.doc));
  Y.applyUpdate(a.doc,right,'network');Y.applyUpdate(b.doc,left,'network');
  a.binding.flush();b.binding.flush();
}
function start(initial,hooksA,hooksB){
  const a=peer(initial,hooksA);a.binding.seed(initial);a.binding.connect();
  const b=peer([paragraph('Local blank placeholder')],hooksB);
  Y.applyUpdate(b.doc,Y.encodeStateAsUpdate(a.doc),'network');b.binding.connect();
  return [a,b];
}
function cleanup(...peers){for(const item of peers){item.binding.destroy();item.doc.destroy();}}

test('only the creator seeds prose; an uninitialized joiner cannot manufacture or duplicate a paragraph',()=>{
  const waiting=peer([paragraph('Local blank placeholder')]);
  assert.throws(()=>waiting.binding.connect(),/Wait for the shared document/);
  assert.equal(waiting.binding.sharedRoot.length,0);
  assert.equal(text(waiting.editor),'Local blank placeholder');
  const a=peer([paragraph('Shared article')]);a.binding.seed([paragraph('Shared article')]);a.binding.connect();
  assert.throws(()=>a.binding.seed([paragraph('Duplicate')]),/already initialized/);
  Y.applyUpdate(waiting.doc,Y.encodeStateAsUpdate(a.doc),'network');waiting.binding.connect();
  assert.deepEqual(value(waiting.editor),value(a.editor));assert.equal(waiting.editor.children.length,1);
  cleanup(a,waiting);
});

test('concurrent real Plate text, mark and paragraph operations converge after an offline exchange',()=>{
  const [a,b]=start([paragraph('Shared text'),paragraph('Second paragraph')]);
  a.editor.tf.insertText('Alice ',{at:{path:[0,0],offset:0}});
  b.editor.tf.insertText(' Bob',{at:{path:[0,0],offset:11}});
  b.editor.tf.setNodes({italic:true},{at:[1,0]});
  a.editor.tf.insertNodes(paragraph('Alice paragraph'),{at:[2]});
  b.editor.tf.insertNodes(paragraph('Bob paragraph'),{at:[2]});
  exchange(a,b);
  assert.deepEqual(value(a.editor),value(b.editor));
  assert.equal(a.editor.children[0].children[0].text,'Alice Shared text Bob');
  assert.equal(a.editor.children[1].children[0].italic,true);
  assert.equal(a.editor.children.length,4);
  assert.ok(text(a.editor).includes('Alice paragraph'));assert.ok(text(a.editor).includes('Bob paragraph'));
  cleanup(a,b);
});

test('a new authoritative baseline cannot leave toolbar marks reading a removed local selection path',()=>{
  const guest=peer([paragraph('Local cached paragraph'),paragraph('Caret was here')]);
  guest.editor.tf.select({path:[1,0],offset:5});
  guest.binding.seed([paragraph('Shorter main document')]);guest.binding.connect();
  assert.equal(text(guest.editor),'Shorter main document');
  assert.doesNotThrow(()=>guest.editor.api.marks());
  cleanup(guest);
});

test('collaborative undo removes only local edits while retaining remote edits and supports redo',()=>{
  const [a,b]=start([paragraph('base')]);
  a.editor.tf.insertText('A',{at:{path:[0,0],offset:0}});exchange(a,b);
  b.editor.tf.insertText('B',{at:{path:[0,0],offset:5}});exchange(a,b);
  assert.equal(text(a.editor),'AbaseB');
  assert.equal(a.editor.history.undos.length,0);assert.equal(b.editor.history.undos.length,0);
  a.binding.undo();exchange(a,b);
  assert.equal(text(a.editor),'baseB');assert.equal(text(b.editor),'baseB');
  a.binding.redo();exchange(a,b);
  assert.equal(text(a.editor),'AbaseB');assert.equal(text(b.editor),'AbaseB');
  cleanup(a,b);
});

test('native formula fields stay local while formula identity, display, labels and source-only formulas are shared',()=>{
  const native={type:'equation',id:'native',display:true,numbered:true,texLabel:'eq:native',snapshot:'native-tree-1',texExpression:'x^2',children:[{text:''}]};
  const raw={type:'equation',id:'raw',texExpression:'\\unsupported{alpha}',children:[{text:''}]};
  const input=[paragraph('Article'),native,raw];
  const before=JSON.stringify(input),a=peer(input);a.binding.seed(input);a.binding.connect();
  let shared=yTextToSlateElement(a.binding.sharedRoot).children;
  assert.equal(shared[1].id,'native');assert.equal(shared[1].numbered,true);assert.equal(shared[1].texLabel,'eq:native');
  assert.equal(shared[1].snapshot,undefined);assert.equal(shared[1].texExpression,undefined);
  assert.equal(a.editor.children[1].snapshot,'native-tree-1');assert.equal(a.editor.children[1].texExpression,'x^2');
  assert.equal(shared[2].texExpression,'\\unsupported{alpha}');
  const initialVector=Y.encodeStateVector(a.doc);
  a.editor.tf.setNodes({snapshot:'native-tree-2',texExpression:'x^3'},{at:[1]});a.binding.flush();
  assert.deepEqual(Y.encodeStateVector(a.doc),initialVector,'derived math writes must create no prose CRDT update');
  assert.equal(a.binding.undoManager.undoStack.length,0);
  a.editor.tf.setNodes({snapshot:'native-tree-3',texExpression:'x^4',numbered:false,texLabel:'eq:changed'},{at:[1]});a.binding.flush();
  shared=yTextToSlateElement(a.binding.sharedRoot).children;
  assert.equal(shared[1].snapshot,undefined);assert.equal(shared[1].texExpression,undefined);
  assert.equal(shared[1].numbered,false);assert.equal(shared[1].texLabel,'eq:changed');
  assert.equal(a.editor.children[1].snapshot,'native-tree-3');assert.equal(a.editor.children[1].texExpression,'x^4');
  a.editor.tf.setNodes({snapshot:'converted-native-tree',texExpression:'alpha'},{at:[2]});a.binding.flush();
  shared=yTextToSlateElement(a.binding.sharedRoot).children;
  assert.equal(shared[2].snapshot,undefined);assert.equal(shared[2].texExpression,undefined,'native conversion removes the previous atomic source');
  assert.equal(a.editor.children[2].snapshot,'converted-native-tree');assert.equal(a.editor.children[2].texExpression,'alpha');
  assert.equal(JSON.stringify(input),before,'sanitization cannot modify the original value');
  cleanup(a);
});

test('recursive seeding and later insertions exclude native snapshots without flattening rich-text children',()=>{
  const inline={type:'inline_equation',id:'inline',snapshot:'nested-native-tree',texExpression:'a+b',children:[{text:''}]};
  const input=[{type:'blockquote',children:[{type:'p',children:[{text:'Before ',bold:true},inline,{text:' after'}]}]}];
  const sanitized=collaborationProseValue(input);
  assert.equal(sanitized[0].children[0].children[1].snapshot,undefined);
  assert.equal(sanitized[0].children[0].children[0].bold,true);
  const a=peer([paragraph('First')]);a.binding.seed([paragraph('First')]);a.binding.connect();
  a.editor.tf.insertNodes({type:'equation',id:'inserted',snapshot:'inserted-native-tree',texExpression:'y=1',children:[{text:''}]},{at:[1]});a.binding.flush();
  const shared=yTextToSlateElement(a.binding.sharedRoot).children;
  assert.equal(shared[1].snapshot,undefined);assert.equal(shared[1].texExpression,undefined);
  assert.equal(a.editor.children[1].snapshot,'inserted-native-tree');assert.equal(a.editor.children[1].texExpression,'y=1');
  cleanup(a);
});

test('withoutSaving synchronizes edits without entering collaborative undo and restores the origin on failure',()=>{
  const [a,b]=start([paragraph('base')]);
  a.binding.withoutSaving(()=>a.editor.tf.insertText('N',{at:{path:[0,0],offset:0}}));exchange(a,b);
  assert.equal(text(b.editor),'Nbase');assert.equal(a.binding.undoManager.undoStack.length,0);
  assert.throws(()=>a.binding.withoutSaving(()=>{throw Error('Failed transform');}),/Failed transform/);
  a.editor.tf.insertText('A',{at:{path:[0,0],offset:0}});exchange(a,b);
  assert.equal(a.binding.undoManager.undoStack.length,1);
  a.binding.undo();exchange(a,b);assert.equal(text(a.editor),'Nbase');assert.equal(text(b.editor),'Nbase');
  cleanup(a,b);
});

test('remote hooks surround applied changes and detach restores ordinary local editing and history',()=>{
  const calls=[],[a,b]=start([paragraph('base')],undefined,{beforeRemote:()=>calls.push('before'),afterRemote:()=>calls.push('after')});
  calls.length=0;a.editor.tf.insertText('A',{at:{path:[0,0],offset:0}});exchange(a,b);
  assert.deepEqual(calls,['before','after']);
  const originalEditor=editor([paragraph('original')]);
  const original={apply:originalEditor.apply,undo:originalEditor.undo,redo:originalEditor.redo,onChange:originalEditor.onChange,tfApply:originalEditor.tf.apply,tfWithoutSaving:originalEditor.tf.withoutSaving,apiOnChange:originalEditor.api.onChange,history:originalEditor.history};
  const doc=new Y.Doc(),binding=new CollaborativeProseBinding(originalEditor,doc,Symbol('detachable'));
  binding.seed(value(originalEditor));binding.connect();binding.destroy();binding.destroy();
  assert.equal(originalEditor.apply,original.apply);assert.equal(originalEditor.undo,original.undo);assert.equal(originalEditor.redo,original.redo);
  assert.equal(originalEditor.onChange,original.onChange);assert.equal(originalEditor.tf.apply,original.tfApply);assert.equal(originalEditor.tf.withoutSaving,original.tfWithoutSaving);assert.equal(originalEditor.api.onChange,original.apiOnChange);assert.equal(originalEditor.history,original.history);
  const vector=Y.encodeStateVector(doc);
  originalEditor.tf.insertText('!',{at:{path:[0,0],offset:8}});
  assert.equal(text(originalEditor),'original!');assert.equal(originalEditor.history.undos.length,1);
  originalEditor.undo();assert.equal(text(originalEditor),'original');
  assert.deepEqual(Y.encodeStateVector(doc),vector,'detached editors must no longer publish operations');
  doc.destroy();cleanup(a,b);
});

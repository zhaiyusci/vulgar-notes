const test=require('node:test');
const assert=require('node:assert/strict');
const Y=require('yjs');
const {buildSync}=require('esbuild');
const bundled=buildSync({stdin:{contents:`
export {DocumentCollaborationSession} from './src/collaboration-session';
export {createHostedInvite} from './src/collaboration-invite';
export {EditorModel,setMathIdNamespace} from './src/editor-model';
export {createPlateEditor,createPlatePlugin} from 'platejs/react';
export {BaseEquationPlugin,BaseInlineEquationPlugin} from './src/plate-math-plugins';
export {yTextToSlateElement} from '@slate-yjs/core';
`,resolveDir:__dirname,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node',external:['yjs']}).outputFiles[0].text;
const compiled={exports:{}};new Function('require','module','exports',bundled)(require,compiled,compiled.exports);
const {DocumentCollaborationSession,createHostedInvite,EditorModel,setMathIdNamespace,createPlateEditor,createPlatePlugin,BaseEquationPlugin,BaseInlineEquationPlugin,yTextToSlateElement}=compiled.exports;
const paragraph=(...children)=>({type:'p',children:children.map(child=>typeof child==='string'?{text:child}:child)});
const clone=value=>JSON.parse(JSON.stringify(value));
const prose=editor=>editor.children.map(node=>node.children.map(child=>child.text??'').join('')).join('\n');
const content=snapshot=>JSON.stringify(JSON.parse(snapshot).root);
const modelFrom=snapshot=>{const model=new EditorModel();model.restore(snapshot);return model;};
function blankMath(text){const model=new EditorModel();model.root.items=Array.from(text);model.index();model.setCursor(model.root.id,model.root.items.length);return model;}
function* nodes(value,parent=[]){for(let index=0;index<value.length;index++){const node=value[index],path=[...parent,index];yield[node,path];if(Array.isArray(node.children))yield*nodes(node.children,path);}}
const formula=(model,id='formula')=>({type:'equation',id,snapshot:model.snapshot(),texExpression:model.exportLatex(),numbered:true,children:[{text:''}]});
const citation=key=>({type:'tex_reference',command:'cite',keys:[key],children:[{text:''}]});

/** A direct-host queued network, never an automatic document exchange. */
class Network {
  endpoints=new Map();queue=[];record=[];
  endpoint(peerId,role){
    const network=this;
    const endpoint={peerId,role,available:true,peers:new Set(),listeners:new Set(),messages:new Set(),ended:false,destroyed:false,
      getState(){return{available:this.available,peers:[...this.peers],ended:this.ended};},
      subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);},
      onMessage(fn){this.messages.add(fn);return()=>this.messages.delete(fn);},
      send(to,bytes){if(!this.available||this.destroyed||!this.peers.has(to))return false;const frame={from:peerId,to,bytes:new Uint8Array(bytes)};network.queue.push(frame);network.record.push(frame);return true;},
      emit(){for(const fn of this.listeners)fn();},
      destroy(){if(this.destroyed)return;this.destroyed=true;for(const targetId of [...this.peers]){const target=network.endpoints.get(targetId);if(this.role==='host')target.ended=true;network.disconnect(this,target);}this.listeners.clear();this.messages.clear();},
    };this.endpoints.set(peerId,endpoint);return endpoint;
  }
  connect(a,b){a.available=b.available=true;a.peers.add(b.peerId);b.peers.add(a.peerId);a.emit();b.emit();}
  disconnect(a,b){a.peers.delete(b.peerId);b.peers.delete(a.peerId);a.emit();b.emit();}
  deliver(frame,force=false){const target=this.endpoints.get(frame.to);if(!target||target.destroyed)return;if(!force&&(!target.available||!target.peers.has(frame.from)))return;for(const fn of target.messages)fn(frame.from,frame.bytes);}
  flush(){for(let count=0;this.queue.length;count++){assert.ok(count<2000,'protocol must settle');this.deliver(this.queue.shift());}}
}
function makeAdapter(initial,{libraries=[],style='simple'}={}){
  const ReferencePlugin=createPlatePlugin({key:'tex_reference',node:{isElement:true,isInline:true,isVoid:true}});
  const editor=createPlateEditor({plugins:[BaseEquationPlugin,BaseInlineEquationPlugin,ReferencePlugin],value:clone(initial),nodeId:false});
  const state={editor,libraries:clone(libraries),style,models:new Map(),states:[],recoveries:[],replacements:0,applying:false,reconciles:0};
  for(const [node] of nodes(editor.children))if(node.snapshot)state.models.set(node.id,modelFrom(node.snapshot));
  state.adapter={editor,data:()=>({value:editor.children,libraries:state.libraries,style:state.style}),
    snapshots:()=>new Map([...state.models].map(([id,model])=>[id,model.snapshot()])),applying:value=>{state.applying=value;},
    replace:()=>{state.replacements++;state.models.clear();},
    recover:reason=>state.recoveries.push({reason,value:clone(editor.children),snapshots:new Map([...state.models].map(([id,model])=>[id,model.snapshot()]))}),
    reconcile:(math,cursors,libraries,style)=>{
      assert.equal(state.applying,true);state.reconciles++;state.libraries=clone(libraries);state.style=style;
      editor.tf.withoutSaving(()=>{for(const [node,path] of nodes(editor.children)){
        if(!['equation','inline_equation'].includes(node.type))continue;
        const previous=state.models.get(node.id)?.snapshot()??node.snapshot,snapshot=math.read(node.id,previous,cursors.get(node.id));if(!snapshot)continue;
        const model=state.models.get(node.id)??new EditorModel();model.restore(snapshot);state.models.set(node.id,model);
        editor.tf.setNodes({snapshot:model.snapshot(),texExpression:model.exportLatex()},{at:path});
      }});
    },state:value=>{state.lastState=value;state.states.push(value);},
  };return state;
}
function peer(initial,network,id,invite,hostKey,settings){
  const host=makeAdapter(initial,settings),transport=network.endpoint(id,hostKey?'host':'guest');
  const session=new DocumentCollaborationSession(invite,host.adapter,{hostKey,transportFactory:()=>transport});return{session,host,transport};
}
async function pump(network,...peers){for(let cycle=0;cycle<12;cycle++){
  for(const peer of peers)peer.session.flush();network.flush();for(let tick=0;tick<5;tick++)await Promise.resolve();
  if(!network.queue.length&&cycle>2)return;
}assert.fail('session did not settle');}
async function pair(t,value,settings,{grant=true,guests=1}={}){
  const {invite,hostKey}=await createHostedInvite(),network=new Network(),a=peer(value,network,'host',invite,hostKey,settings);await a.session.start(true);
  const others=[];for(let index=0;index<guests;index++){
    const b=peer([paragraph('LOCAL PLACEHOLDER MUST NOT SEED')],network,'guest-'+index,invite);others.push(b);await b.session.start(false);network.connect(a.transport,b.transport);await pump(network,a,...others);
  }
  t.after(()=>{a.session.destroy();for(const other of others)other.session.destroy();setMathIdNamespace();});
  if(grant)for(const other of others){a.session.setPeerPermission(other.transport.peerId,'edit');await pump(network,a,...others);}
  return{a,b:others[0],others,network};
}
function editMath(peer,id,change){
  setMathIdNamespace(peer.session.doc.guid);const model=peer.host.models.get(id);assert.ok(model,id);const before=model.snapshot();
  peer.session.math.stopCapturing();change(model);const after=model.snapshot();peer.session.publishMath(id,before,after);
  const found=[...nodes(peer.host.editor.children)].find(([node])=>node.id===id);assert.ok(found);
  peer.host.editor.tf.setNodes({snapshot:after,texExpression:model.exportLatex()},{at:found[1]});peer.session.flush();return after;
}

test('guests receive the host article and native math as view-only, then obtain a fresh editing baseline on grant',async t=>{
  const {a,b,network}=await pair(t,[paragraph('Before'),formula(blankMath('x')),paragraph('After')],undefined,{grant:false});
  assert.equal(a.session.ready,true);assert.equal(b.session.ready,true);assert.equal(a.session.writable,true);assert.equal(b.session.writable,false);
  assert.equal(prose(b.host.editor),'Before\n\nAfter');assert.equal(b.host.models.get('formula').exportLatex(),'x');
  const shared=yTextToSlateElement(b.session.prose.sharedRoot).children;assert.equal(shared[1].snapshot,undefined);assert.equal(shared[1].texExpression,undefined);
  b.host.editor.tf.insertText('not allowed',{at:{path:[0,0],offset:0}});await pump(network,a,b);assert.equal(prose(b.host.editor),'Before\n\nAfter');
  const previous=b.session.doc;a.session.setPeerPermission(b.transport.peerId,'edit');await pump(network,a,b);
  assert.notEqual(b.session.doc,previous);assert.equal(b.session.writable,true);assert.equal(b.host.lastState.permission,'edit');
  assert.equal(b.session.prose.undoManager.undoStack.length,0);assert.equal(a.host.lastState.peers[0].permission,'edit');
});
test('an absent host never seeds a guest placeholder, restores guest history, or allows takeover',async t=>{
  const {invite}=await createHostedInvite(),network=new Network(),b=peer([paragraph('private local placeholder')],network,'guest',invite);t.after(()=>b.session.destroy());
  await b.session.start(false);b.session.setName('Researcher');b.session.publishSettings();b.session.flush();
  assert.equal(b.session.ready,false);assert.equal(b.session.writable,false);assert.throws(()=>b.session.doc,/Wait for the shared document/);
  assert.equal(prose(b.host.editor),'private local placeholder');assert.equal(b.host.reconciles,0);assert.equal(b.host.lastState.role,'guest');assert.equal(network.queue.length,0);
});
test('unsupported shared protocol keeps the guest active and readonly across name and presence changes',async t=>{
  const {a,b,network}=await pair(t,[paragraph('Article')]);a.session.metadata.set('protocol',2);await pump(network,a,b);
  assert.equal(b.host.lastState.active,true);assert.equal(b.host.lastState.role,'guest');assert.equal(b.host.lastState.ready,false);assert.equal(b.host.lastState.writable,false);
  assert.match(b.host.lastState.error,/unsupported document version/);
  b.session.setName('Still a guest');b.session.publishPresence();await pump(network,a,b);
  assert.equal(b.host.lastState.active,true);assert.equal(b.host.lastState.role,'guest');assert.equal(b.host.lastState.writable,false);assert.match(b.host.lastState.error,/unsupported document version/);
});
test('live prose and same-formula typing from three participants converge through the host only',async t=>{
  const {a,b,others,network}=await pair(t,[paragraph('Shared prose'),formula(blankMath('x'))],undefined,{guests:2}),c=others[1];
  a.host.editor.tf.insertText('Alice ',{at:{path:[0,0],offset:0}});a.session.flush();b.host.editor.tf.insertText(' Bob',{at:{path:[0,0],offset:12}});b.session.flush();
  editMath(a,'formula',model=>model.insert('A'));editMath(b,'formula',model=>model.insert('B'));editMath(c,'formula',model=>model.insert('C'));await pump(network,a,b,c);
  assert.equal(prose(a.host.editor),'Alice Shared prose Bob\n');const latex=a.host.models.get('formula').exportLatex();for(const char of ['A','B','C'])assert.match(latex,new RegExp(char));
  for(const other of others){assert.equal(prose(other.host.editor),prose(a.host.editor));assert.equal(other.host.models.get('formula').exportLatex(),latex);assert.equal(other.host.lastState.pending,0);assert.deepEqual([...other.transport.peers],['host']);}
});
test('concurrent nested structures keep independent identities and each authored editable argument',async t=>{
  const {a,b,network}=await pair(t,[paragraph('Nested'),formula(blankMath(''))]);
  editMath(a,'formula',model=>{model.insertStructure('frac');model.insert('a');});editMath(b,'formula',model=>{model.insertStructure('sqrt');model.insert('b');});await pump(network,a,b);
  const result=a.host.models.get('formula');assert.equal(result.root.items.length,2);assert.deepEqual(new Set(result.root.items.map(node=>node.type)),new Set(['frac','sqrt']));
  assert.match(result.exportLatex(),/a/);assert.match(result.exportLatex(),/b/);assert.equal(content(result.snapshot()),content(b.host.models.get('formula').snapshot()));
});
test('each participant undo removes only their accepted prose and math edits',async t=>{
  const {a,b,network}=await pair(t,[paragraph('base'),formula(blankMath('x'))]);
  editMath(a,'formula',model=>model.insert('A'));editMath(b,'formula',model=>model.insert('B'));await pump(network,a,b);a.session.undo();await pump(network,a,b);
  assert.equal(a.host.models.get('formula').exportLatex(),'xB');assert.equal(b.host.models.get('formula').exportLatex(),'xB');a.session.redo();await pump(network,a,b);assert.match(a.host.models.get('formula').exportLatex(),/A/);
  a.session.prose.undoManager.stopCapturing();b.session.prose.undoManager.stopCapturing();a.host.editor.tf.insertText('A',{at:{path:[0,0],offset:0}});a.session.flush();await pump(network,a,b);
  b.host.editor.tf.insertText('B',{at:{path:[0,0],offset:5}});b.session.flush();await pump(network,a,b);a.session.undo();await pump(network,a,b);
  assert.equal(prose(a.host.editor),'baseB\n');assert.equal(prose(b.host.editor),'baseB\n');
});
test('offline writes are gated; unconfirmed input is recoverable and never replayed when a guest reconnects',async t=>{
  const {a,b,network}=await pair(t,[paragraph('main'),formula(blankMath('x'))]);
  b.host.editor.tf.insertText(' pending',{at:{path:[0,0],offset:4}});b.session.flush();assert.ok(b.host.lastState.pending>0);
  const old=b.session.doc,held=network.queue.splice(0);network.disconnect(a.transport,b.transport);await pump(network,a,b);
  assert.equal(b.session.writable,false);assert.equal(b.host.recoveries.length,1);assert.match(prose({children:b.host.recoveries[0].value}),/pending/);
  b.host.editor.tf.insertText('OFFLINE',{at:{path:[0,0],offset:0}});b.session.publishSettings();b.session.undo();b.session.redo();b.session.flush();assert.doesNotMatch(prose(b.host.editor),/OFFLINE/);
  a.host.editor.tf.insertText(' updated',{at:{path:[0,0],offset:4}});a.session.flush();network.connect(a.transport,b.transport);await pump(network,a,b);
  assert.notEqual(b.session.doc,old);assert.equal(prose(b.host.editor),'main updated\n');assert.equal(b.session.writable,true);assert.equal(b.host.lastState.recoveryAvailable,true);
  for(const frame of held)network.deliver(frame,true);await pump(network,a,b);assert.equal(prose(a.host.editor),'main updated\n');
});
test('host revocation rejects queued math input, preserves a detached recovery and keeps the guest on the main copy',async t=>{
  const {a,b,network}=await pair(t,[paragraph('main'),formula(blankMath('x'))]);editMath(b,'formula',model=>model.insert('pending'));const proposal=network.queue.shift();
  a.session.setPeerPermission(b.transport.peerId,'view');network.deliver(proposal,true);await pump(network,a,b);
  assert.equal(a.host.models.get('formula').exportLatex(),'x');assert.equal(b.host.models.get('formula').exportLatex(),'x');assert.equal(b.session.writable,false);assert.equal(b.host.lastState.permission,'view');assert.equal(b.host.recoveries.length,1);
  assert.match(modelFrom(b.host.recoveries[0].snapshots.get('formula')).exportLatex(),/pending/);
  const vector=Y.encodeStateVector(a.session.doc);b.session.publishMath('formula',b.host.models.get('formula').snapshot(),blankMath('bad').snapshot());await pump(network,a,b);assert.deepEqual(Y.encodeStateVector(a.session.doc),vector);
  editMath(a,'formula',model=>model.insert('host'));await pump(network,a,b);assert.equal(b.host.models.get('formula').exportLatex(),'xhost');
});
test('revoking a guest before Slate flushes a local keystroke preserves recovery without replaying that buffered edit',async t=>{
  const {a,b,network}=await pair(t,[paragraph('main'),formula(blankMath('x'))]);
  b.host.editor.tf.insertText(' buffered',{at:{path:[0,0],offset:4}});
  assert.equal(prose(b.host.editor),'main buffered\n');assert.equal(b.host.lastState.pending,0);
  a.session.setPeerPermission(b.transport.peerId,'view');
  // Deliver the permission reset before calling session.flush() or yielding to Slate's onChange.
  network.flush();await pump(network,a,b);
  assert.equal(prose(a.host.editor),'main\n');assert.equal(prose(b.host.editor),'main\n');assert.equal(b.session.writable,false);
  assert.equal(b.host.recoveries.length,1);assert.equal(prose({children:b.host.recoveries[0].value}),'main buffered\n');
  a.session.setPeerPermission(b.transport.peerId,'edit');await pump(network,a,b);
  assert.equal(prose(a.host.editor),'main\n');assert.equal(prose(b.host.editor),'main\n');
});
test('host exit ends the session and locks every guest without promoting any participant',async t=>{
  const {a,others,network}=await pair(t,[paragraph('Article'),formula(blankMath('x'))],undefined,{guests:2});a.session.destroy();await pump(network,...others);
  for(const b of others){assert.equal(b.session.writable,false);assert.equal(b.host.lastState.role,'guest');assert.equal(b.host.lastState.status,'offline');assert.equal(prose(b.host.editor),'Article\n');}
});
test('cited bibliography records, source macros and style synchronize without sharing the private library remainder',async t=>{
  const libraries=[{id:'library',name:'full-local.bib',source:'@string{journal={A Journal}}\n@article{cited,title={Shared title},journal=journal,year={2026}}\n@book{private,title={UNSHARED_LIBRARY_ENTRY}}'}];
  const {a,b,network}=await pair(t,[paragraph('Read ',citation('cited'))],{libraries,style:'acs'});
  assert.equal(b.host.style,'acs');assert.equal(b.host.libraries.length,1);assert.match(b.host.libraries[0].source,/Shared title/);assert.match(b.host.libraries[0].source,/A Journal/);assert.doesNotMatch(b.host.libraries[0].source,/UNSHARED_LIBRARY_ENTRY/);
  b.host.style='aip';b.session.publishSettings();await pump(network,a,b);assert.equal(a.host.style,'aip');const edited=clone(b.host.libraries);edited[0].source=edited[0].source.replace('Shared title','Updated shared title');b.host.libraries=edited;b.session.publishSettings();await pump(network,a,b);
  assert.match(a.host.libraries[0].source,/Updated shared title/);assert.match(b.host.libraries[0].source,/Updated shared title/);
});
test('view-only names and relative cursors are authenticated ephemeral presence, not persistent edits',async t=>{
  const {a,b,network}=await pair(t,[paragraph('abcd'),formula(blankMath('xy'))],undefined,{grant:false});const beforeA=Y.encodeStateVector(a.session.doc),beforeB=Y.encodeStateVector(b.session.doc);
  b.session.setName('Reader');b.host.editor.tf.select({path:[0,0],offset:2});b.session.publishPresence();await pump(network,a,b);
  assert.deepEqual(Y.encodeStateVector(a.session.doc),beforeA);assert.deepEqual(Y.encodeStateVector(b.session.doc),beforeB);
  const participant=a.host.lastState.peers.find(peer=>peer.transportPeerId===b.transport.peerId);assert.equal(participant.name,'Reader');assert.equal(participant.permission,'view');
  const cursor=a.session.remoteCursors().find(cursor=>cursor.clientId===b.session.doc.clientID);assert.equal(cursor.range.anchor.offset,2);
  const hostPeer=b.host.lastState.peers.find(peer=>peer.transportPeerId===a.transport.peerId);assert.equal(hostPeer.host,true);assert.doesNotMatch(JSON.stringify(b.session.awareness.getLocalState()),/snapshot|pendingFont|texExpression/);
});
test('a reconnect clears local undo and obtains current native structures rather than old guest content',async t=>{
  const {a,b,network}=await pair(t,[paragraph('Article'),formula(blankMath('x'))]);editMath(b,'formula',model=>model.insert('A'));await pump(network,a,b);assert.ok(b.session.prose.undoManager.undoStack.length);
  network.disconnect(a.transport,b.transport);editMath(a,'formula',model=>{model.setCursor(model.root.id,model.root.items.length);model.insertStructure('sqrt');model.insert('new');});await pump(network,a,b);
  network.connect(a.transport,b.transport);await pump(network,a,b);assert.equal(b.session.prose.undoManager.undoStack.length,0);
  assert.equal(b.host.models.get('formula').exportLatex(),a.host.models.get('formula').exportLatex());assert.match(b.host.models.get('formula').exportLatex(),/\\sqrt\{new\}/);assert.equal(b.host.lastState.pending,0);
});

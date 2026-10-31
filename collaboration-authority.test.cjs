const test=require('node:test');
const assert=require('node:assert/strict');
const Y=require('yjs');
const encoding=require('lib0/encoding');
const decoding=require('lib0/decoding');
const {buildSync}=require('esbuild');
const bundled=buildSync({entryPoints:['src/collaboration-authority.ts'],bundle:true,write:false,format:'cjs',platform:'node',external:['yjs']}).outputFiles[0].text;
const compiled={exports:{}};new Function('require','module','exports',bundled)(require,compiled,compiled.exports);
const {AuthoritativeDocumentChannel,MAX_AUTHORITY_UPDATE_BYTES}=compiled.exports;

class Network {
  endpoints=new Map();queue=[];record=[];
  endpoint(peerId,role){
    const network=this;
    const endpoint={peerId,role,available:true,peers:new Set(),listeners:new Set(),messages:new Set(),ended:false,
      getState(){return{available:this.available,peers:[...this.peers],ended:this.ended};},
      subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);},
      onMessage(fn){this.messages.add(fn);return()=>this.messages.delete(fn);},
      send(to,bytes){if(!this.available||!this.peers.has(to))return false;const frame={from:peerId,to,bytes:new Uint8Array(bytes)};network.queue.push(frame);network.record.push(frame);return true;},
      emit(){for(const fn of this.listeners)fn();},
    };this.endpoints.set(peerId,endpoint);return endpoint;
  }
  connect(a,b){a.available=b.available=true;a.peers.add(b.peerId);b.peers.add(a.peerId);a.emit();b.emit();}
  disconnect(a,b){a.peers.delete(b.peerId);b.peers.delete(a.peerId);a.emit();b.emit();}
  deliver(frame,force=false){const target=this.endpoints.get(frame.to);if(!target)return;if(!force&&(!target.available||!target.peers.has(frame.from)))return;for(const fn of target.messages)fn(frame.from,frame.bytes);}
  flush(){for(let count=0;this.queue.length;count++){assert.ok(count<1000,'protocol must settle');this.deliver(this.queue.shift());}}
}
const text=peer=>peer.channel.document.getText('body').toString();
function fixture(t,{guests=1,initial='x',hostSetup=()=>{},authorityOptions={}}={}){
  const network=new Network(),doc=new Y.Doc();doc.getText('body').insert(0,initial);
  hostSetup(doc);
  const make=(peerId,role)=>{
    const transport=network.endpoint(peerId,role),peer={transport,recovery:[],documents:[],states:[],presence:[]};
    peer.channel=new AuthoritativeDocumentChannel(transport,{...authorityOptions,...(role==='host'?{hostDocument:doc}:{}),
      onDocument:value=>peer.documents.push(value),onState:value=>peer.states.push(value),
      onRecovery:(value,reason)=>peer.recovery.push({text:value.getText('body').toString(),reason}),
      onPresence:(peerId,update)=>peer.presence.push({peerId,update}),
    });return peer;
  };
  const host=make('host','host'),peers=Array.from({length:guests},(_,index)=>make('guest-'+index,'guest'));
  t.after(()=>{host.channel.destroy();for(const peer of peers)peer.channel.destroy();doc.destroy();});
  for(const peer of peers)network.connect(host.transport,peer.transport);network.flush();
  const allow=peer=>{host.channel.setPeerPermission(peer.transport.peerId,'edit');network.flush();};
  return{network,doc,host,peers,guest:peers[0],allow};
}
function proposalFields(frame){
  const decoder=decoding.createDecoder(frame.bytes);assert.equal(decoding.readVarUint(decoder),1);assert.equal(decoding.readVarUint(decoder),4);
  return{epoch:decoding.readVarString(decoder),nonce:decoding.readVarString(decoder),seq:decoding.readVarUint(decoder)};
}
function forgedProposal(frame,update,override={}){
  const fields={...proposalFields(frame),...override},encoder=encoding.createEncoder();encoding.writeVarUint(encoder,1);encoding.writeVarUint(encoder,4);
  encoding.writeVarString(encoder,fields.epoch);encoding.writeVarString(encoder,fields.nonce);encoding.writeVarUint(encoder,fields.seq);encoding.writeVarUint8Array(encoder,update);
  return{...frame,bytes:encoding.toUint8Array(encoder)};
}

test('new participants receive the host document as view-only and cannot write through a missed UI guard',t=>{
  const {network,host,guest,allow}=fixture(t,{initial:'Main'});
  assert.equal(text(guest),'Main');assert.equal(guest.channel.getState().initialized,true);
  assert.equal(guest.channel.getState().permission,'view');assert.equal(guest.channel.getState().writable,false);
  guest.channel.document.getText('body').insert(0,'LOCAL ');network.flush();
  assert.equal(text(host),'Main');assert.equal(guest.recovery.length,1);
  const previous=guest.channel.document;
  allow(guest);
  assert.notEqual(guest.channel.document,previous);assert.equal(text(guest),'Main');
  assert.equal(guest.channel.getState().writable,true);assert.equal(guest.channel.getState().permission,'edit');
  assert.throws(()=>guest.channel.setPeerPermission('host','view'),/Only the host/);
});

test('online edits from host and two editors are accepted centrally and converge, without direct guest links',t=>{
  const {network,host,peers,allow}=fixture(t,{guests:2});for(const peer of peers)allow(peer);
  peers[0].channel.document.getText('body').insert(1,'A');
  peers[1].channel.document.getText('body').insert(1,'B');
  host.channel.document.getText('body').insert(0,'H');
  assert.equal(peers[0].channel.getState().pending,1);assert.equal(peers[1].channel.getState().pending,1);
  network.flush();
  const main=text(host);for(const peer of peers){assert.equal(text(peer),main);assert.equal(peer.channel.getState().pending,0);assert.deepEqual([...peer.transport.peers],['host']);}
  assert.match(main,/A/);assert.match(main,/B/);assert.match(main,/H/);assert.equal(main.length,4);
});

test('disconnect stops proposals; reconnect replaces the guest document without replaying offline changes',t=>{
  const {network,host,guest,allow}=fixture(t);allow(guest);
  guest.channel.document.getText('body').insert(1,'unconfirmed');
  const outgoing=network.queue.splice(0),old=guest.channel.document;
  network.disconnect(host.transport,guest.transport);
  assert.equal(guest.channel.getState().writable,false);assert.equal(guest.recovery.length,1);assert.match(guest.recovery[0].text,/unconfirmed/);
  old.getText('body').insert(0,'OFFLINE ');assert.equal(network.queue.length,0);
  host.channel.document.getText('body').insert(1,'main');
  network.connect(host.transport,guest.transport);network.flush();
  assert.notEqual(guest.channel.document,old);assert.equal(text(guest),'xmain');assert.equal(text(host),'xmain');
  assert.equal(guest.channel.getState().writable,true);
  for(const frame of outgoing)network.deliver(frame,true);network.flush();
  assert.equal(text(host),'xmain','an old connection nonce cannot inject a delayed proposal');
});

test('an accepted update with lost acknowledgement is recovered from the host snapshot exactly once',t=>{
  const {network,host,guest,allow}=fixture(t);allow(guest);
  guest.channel.document.getText('body').insert(1,'A');
  const proposal=network.queue.shift();network.deliver(proposal);network.queue=[];
  assert.equal(text(host),'xA');assert.equal(guest.channel.getState().pending,1);
  network.disconnect(host.transport,guest.transport);network.connect(host.transport,guest.transport);network.flush();
  assert.equal(text(guest),'xA');assert.equal(text(host),'xA');assert.equal(guest.channel.getState().pending,0);
  assert.equal(guest.recovery.length,1);
  guest.channel.document.getText('body').insert(2,'B');network.flush();assert.equal(text(host),'xAB');
});

test('revocation is enforced before an in-flight proposal touches the main copy and regrant starts from a new lease',t=>{
  const {network,host,guest,allow}=fixture(t);allow(guest);
  guest.channel.document.getText('body').insert(1,'REVOKED');const proposal=network.queue.shift();
  host.channel.setPeerPermission(guest.transport.peerId,'view');
  network.deliver(proposal,true);network.flush();
  assert.equal(text(host),'x');assert.equal(text(guest),'x');assert.equal(guest.channel.getState().permission,'view');assert.equal(guest.channel.getState().writable,false);
  assert.equal(guest.recovery.length,1);
  allow(guest);network.deliver(proposal,true);network.flush();assert.equal(text(host),'x');
  guest.channel.document.getText('body').insert(1,'accepted');network.flush();assert.equal(text(host),'xaccepted');
});

test('permission belongs to the host and survives a reconnect of the same identity; new identities start view-only',t=>{
  const {network,host,peers,allow}=fixture(t,{guests:2}),[a,b]=peers;allow(a);
  network.disconnect(host.transport,a.transport);network.connect(host.transport,a.transport);network.flush();
  assert.equal(a.channel.getState().permission,'edit');assert.equal(a.channel.getState().writable,true);
  assert.equal(b.channel.getState().permission,'view');assert.equal(b.channel.getState().writable,false);
  assert.deepEqual(host.channel.getState().peers.map(peer=>[peer.peerId,peer.permission]),[['guest-1','view'],['guest-0','edit']]);
});

test('duplicate proposals are idempotent and an old guest cannot become an authority after host exit',t=>{
  const {network,host,guest,allow}=fixture(t);allow(guest);
  guest.channel.document.getText('body').insert(1,'A');const proposal=network.queue.shift();network.deliver(proposal);network.deliver(proposal,true);network.flush();
  assert.equal(text(host),'xA');assert.equal(text(guest),'xA');
  host.channel.destroy();network.flush();assert.equal(guest.channel.getState().ended,true);assert.equal(guest.channel.getState().writable,false);
  network.disconnect(host.transport,guest.transport);network.connect(host.transport,guest.transport);network.flush();
  assert.equal(guest.channel.getState().writable,false);assert.equal(guest.channel.getState().role,'guest');assert.equal(text(guest),'xA');
});

test('host continues normal local editing when there are no participants or the network is unavailable',t=>{
  const {network,host,guest}=fixture(t);network.disconnect(host.transport,guest.transport);
  host.transport.available=false;host.transport.emit();
  assert.equal(host.channel.getState().writable,true);host.channel.document.getText('body').insert(1,'local');assert.equal(text(host),'xlocal');
  assert.equal(guest.channel.getState().writable,false);
});

test('view-only presence is relayed by the host and removed when its direct peer disconnects',t=>{
  const {network,host,peers}=fixture(t,{guests:2}),[a,b]=peers;
  host.channel.sendPresence(Uint8Array.of(10));a.channel.sendPresence(Uint8Array.of(20));network.flush();
  assert.deepEqual(host.presence.at(-1),{peerId:'guest-0',update:Uint8Array.of(20)});
  assert.ok(b.presence.some(value=>value.peerId==='host'&&value.update[0]===10));
  assert.ok(b.presence.some(value=>value.peerId==='guest-0'&&value.update[0]===20));
  network.disconnect(host.transport,a.transport);network.flush();
  assert.deepEqual(host.presence.at(-1),{peerId:'guest-0',update:null});assert.deepEqual(b.presence.at(-1),{peerId:'guest-0',update:null});
});

test('a newly joining peer obtains missed commits during its initial handshake before it can edit',t=>{
  const {network,host,guest,allow}=fixture(t);allow(guest);
  network.disconnect(host.transport,guest.transport);network.connect(host.transport,guest.transport);
  // Deliver HELLO and SNAPSHOT, then edit the host before READY reaches it.
  network.deliver(network.queue.shift());network.deliver(network.queue.shift());
  host.channel.document.getText('body').insert(1,'later');network.flush();
  assert.equal(text(guest),'xlater');assert.equal(guest.channel.getState().writable,true);
});

test('destroy restores ownership boundaries and unsubscribes without destroying the host document',t=>{
  const {network,doc,host,guest}=fixture(t);const guestDoc=guest.channel.document;
  guest.channel.destroy();assert.equal(guest.transport.messages.size,0);assert.equal(guest.transport.listeners.size,0);
  host.channel.destroy();assert.equal(doc.isDestroyed,false);assert.equal(guestDoc.isDestroyed,true);
  network.flush();doc.getText('body').insert(1,'kept');assert.equal(doc.getText('body').toString(),'xkept');
});

test('malformed and unknown-root proposals are rejected atomically before any change reaches the host',t=>{
  const {network,host,guest,allow}=fixture(t);allow(guest);
  const baseline=Y.encodeStateAsUpdate(host.channel.document);
  guest.channel.document.transact(()=>{
    guest.channel.document.getText('body').insert(1,'must-not-partially-apply');
    guest.channel.document.getMap('unknown-root').set('value','poison');
  });
  network.flush();
  assert.equal(text(host),'x');assert.equal(host.channel.document.share.has('unknown-root'),false);
  assert.deepEqual(Y.encodeStateAsUpdate(host.channel.document),baseline);assert.equal(text(guest),'x');assert.equal(guest.recovery.length,1);
  guest.channel.document.getText('body').insert(1,'valid');const frame=network.queue.shift();
  network.deliver(forgedProposal(frame,Uint8Array.of(1,2,3,4)),true);network.flush();
  assert.equal(text(host),'x');assert.equal(text(guest),'x');assert.equal(guest.recovery.length,2);
  assert.equal(host.channel.document.store.pendingStructs,null);assert.equal(host.channel.document.store.pendingDs,null);
});

test('oversized update traffic is rejected before decoding or mutating the main document',t=>{
  const {network,host,guest,allow}=fixture(t);allow(guest);
  guest.channel.document.getText('body').insert(1,'pending');const frame=network.queue.shift();
  network.deliver({...frame,bytes:new Uint8Array(MAX_AUTHORITY_UPDATE_BYTES+1025)},true);network.flush();
  assert.equal(text(host),'x');assert.equal(text(guest),'x');assert.equal(guest.recovery.length,1);
  guest.channel.document.getText('body').insert(1,'works');network.flush();assert.equal(text(host),'xworks');
});

test('a proposal with missing prior item history cannot poison host pending structs',t=>{
  const {network,host,guest,allow}=fixture(t);allow(guest);
  guest.channel.document.getText('body').insert(1,'template');const frame=network.queue.shift();
  const attacker=new Y.Doc();t.after(()=>attacker.destroy());Y.applyUpdate(attacker,Y.encodeStateAsUpdate(host.channel.document));
  attacker.getText('body').insert(1,'not-sent');const vector=Y.encodeStateVector(attacker);attacker.getText('body').insert(1,'dependent');
  const incomplete=Y.encodeStateAsUpdate(attacker,vector);
  network.deliver(forgedProposal(frame,incomplete),true);network.flush();
  assert.equal(text(host),'x');assert.equal(host.channel.document.store.pendingStructs,null);assert.equal(host.channel.document.store.pendingDs,null);
});

test('protected protocol keys cannot be replaced or deleted through existing-map origin references',t=>{
  const {network,host,guest,allow}=fixture(t,{hostSetup:doc=>doc.getMap('protocol').set('version',1),authorityOptions:{immutableRootKeys:{protocol:['version']}}});allow(guest);
  guest.channel.document.getMap('protocol').set('version',999);network.flush();
  assert.equal(host.channel.document.getMap('protocol').get('version'),1);assert.equal(guest.channel.document.getMap('protocol').get('version'),1);
  guest.channel.document.getMap('protocol').delete('version');network.flush();
  assert.equal(host.channel.document.getMap('protocol').get('version'),1);assert.equal(guest.channel.document.getMap('protocol').get('version'),1);
  assert.equal(guest.recovery.length,2);
});

test('a subdocument cannot enter an ordinary shared root through an otherwise valid Yjs update',t=>{
  const {network,host,guest,allow}=fixture(t,{hostSetup:doc=>doc.getMap('metadata').set('name','article')});allow(guest);
  const subdoc=new Y.Doc();t.after(()=>subdoc.destroy());guest.channel.document.getMap('metadata').set('external',subdoc);network.flush();
  assert.equal(host.channel.document.getMap('metadata').has('external'),false);assert.equal(text(host),'x');assert.equal(guest.recovery.length,1);
});

test('revoking and regranting editing before a delayed old proposal arrives never reauthorizes that proposal',t=>{
  const {network,host,guest,allow}=fixture(t);allow(guest);
  guest.channel.document.getText('body').insert(1,'old');const stale=network.queue.shift();
  host.channel.setPeerPermission(guest.transport.peerId,'view');network.flush();
  host.channel.setPeerPermission(guest.transport.peerId,'edit');network.flush();
  assert.equal(guest.channel.getState().writable,true);network.deliver(stale,true);network.flush();assert.equal(text(host),'x');
  guest.channel.document.getText('body').insert(1,'new');network.flush();assert.equal(text(host),'xnew');
});

test('multiple optimistic edits remain detached after disconnect, including an accepted prefix with lost ACK',t=>{
  const {network,host,guest,allow}=fixture(t);allow(guest);
  for(const value of ['a','b','c'])guest.channel.document.getText('body').insert(guest.channel.document.getText('body').length,value);
  assert.equal(guest.channel.getState().pending,3);const first=network.queue.shift();network.deliver(first);
  network.queue=[];network.disconnect(host.transport,guest.transport);
  assert.equal(guest.recovery.length,1);assert.equal(guest.recovery[0].text,'xabc');assert.equal(text(host),'xa');
  network.connect(host.transport,guest.transport);network.flush();assert.equal(text(guest),'xa');assert.equal(guest.channel.getState().pending,0);
});

test('a view-only client cannot bypass permission checks by forging a proposal packet itself',t=>{
  const {network,host,guest,allow}=fixture(t);allow(guest);
  guest.channel.document.getText('body').insert(1,'template');const editPacket=network.queue.shift();
  host.channel.setPeerPermission(guest.transport.peerId,'view');network.flush();
  // Read the current view lease from its Snapshot message; knowing it must not grant edit rights.
  const snapshot=[...network.record].reverse().find(frame=>{
    const decoder=decoding.createDecoder(frame.bytes);return frame.from==='host'&&decoding.readVarUint(decoder)===1&&decoding.readVarUint(decoder)===1;
  });
  const decoder=decoding.createDecoder(snapshot.bytes);decoding.readVarUint(decoder);decoding.readVarUint(decoder);
  const epoch=decoding.readVarString(decoder),nonce=decoding.readVarString(decoder);
  const forgedDoc=new Y.Doc();t.after(()=>forgedDoc.destroy());Y.applyUpdate(forgedDoc,Y.encodeStateAsUpdate(host.channel.document));
  const before=Y.encodeStateVector(forgedDoc);forgedDoc.getText('body').insert(1,'forged');
  network.deliver(forgedProposal(editPacket,Y.encodeStateAsUpdate(forgedDoc,before),{epoch,nonce,seq:1}),true);network.flush();
  assert.equal(text(host),'x');assert.equal(host.channel.getState().peers[0].permission,'view');assert.equal(guest.channel.getState().writable,false);
});

test('host shutdown sends any already-applied main edit before closing the guest stream',t=>{
  const {network,host,guest}=fixture(t);host.channel.document.getText('body').insert(1,'final');host.channel.destroy();network.flush();
  assert.equal(text(guest),'xfinal');assert.equal(guest.channel.getState().ended,true);assert.equal(guest.channel.getState().pending,0);
});

test('replayed old handshakes and duplicate current handshakes cannot replace an active guest lease',t=>{
  const {network,host,guest,allow}=fixture(t);allow(guest);
  const hellos=()=>network.record.filter(frame=>{
    const decoder=decoding.createDecoder(frame.bytes);return frame.from===guest.transport.peerId&&decoding.readVarUint(decoder)===1&&decoding.readVarUint(decoder)===0;
  });
  const old=hellos().at(-1);
  network.disconnect(host.transport,guest.transport);network.connect(host.transport,guest.transport);network.flush();
  const current=hellos().at(-1);network.deliver(old,true);network.deliver(current,true);network.flush();
  guest.channel.document.getText('body').insert(1,'current');network.flush();assert.equal(text(host),'xcurrent');assert.equal(text(guest),'xcurrent');assert.equal(guest.channel.getState().pending,0);
});

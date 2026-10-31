const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const source=buildSync({stdin:{contents:"export * from './src/collaboration-invite';export * from './src/collaboration-transport';",resolveDir:__dirname,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text;
const compiled={exports:{}};new Function('require','module','exports',source)(require,compiled,compiled.exports);
const api=compiled.exports;
const enc=new TextEncoder(),dec=new TextDecoder();
const wait=async(predicate,label='condition')=>{const until=Date.now()+4000;while(!predicate()){if(Date.now()>until)throw Error('Timed out: '+label);await new Promise(resolve=>setTimeout(resolve,5));}};
async function signalingKey(invite){const material=await crypto.subtle.importKey('raw',enc.encode(invite.password),'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode(invite.room),info:enc.encode('Vulgar Notes hosted signaling v2')},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function decodeSignal(invite,publish){const wire=JSON.parse(publish.data);return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:api.collaborationBytes(wire.iv)},await signalingKey(invite),api.collaborationBytes(wire.data))));}
async function injectSignal(invite,signaling,message,key){
  if(key)message.signature=api.collaborationBase64(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,enc.encode(JSON.stringify(message)))));
  const iv=crypto.getRandomValues(new Uint8Array(12)),data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await signalingKey(invite),enc.encode(JSON.stringify(message))));
  const publish={type:'publish',topic:'vulgar-host-v2:'+invite.room,data:JSON.stringify({v:2,iv:api.collaborationBase64(iv),data:api.collaborationBase64(data)})};for(const socket of signaling.sockets)socket.onmessage?.({data:JSON.stringify(publish)});
}

class Signaling {
  sockets=new Set();published=[];
  create=()=>{
    const server=this,socket={readyState:0,topics:new Set(),onopen:null,onmessage:null,onclose:null,onerror:null,
      send(raw){assert.equal(this.readyState,1);const message=JSON.parse(raw);if(message.type==='subscribe')for(const topic of message.topics)this.topics.add(topic);
        if(message.type==='publish'){server.published.push(message);for(const recipient of server.sockets)if(recipient.readyState===1&&recipient.topics.has(message.topic))queueMicrotask(()=>{if(recipient.readyState===1)recipient.onmessage?.({data:JSON.stringify(message)});});}},
      close(){if(this.readyState===3)return;this.readyState=3;server.sockets.delete(this);this.onclose?.({});},
    };this.sockets.add(socket);queueMicrotask(()=>{if(socket.readyState===0){socket.readyState=1;socket.onopen?.({});}});return socket;
  };
}
class Channel {
  label='vulgar-v2';readyState='connecting';bufferedAmount=0;bufferedAmountLowThreshold=0;sent=[];held=[];hold=false;
  send(buffer){
    if(this.readyState!=='open')throw Error('closed');const copy=buffer.slice(0);this.sent.push(copy);this.bufferedAmount+=copy.byteLength;
    const deliver=()=>{if(this.remote.readyState==='open')this.remote.onmessage?.({data:copy});const previous=this.bufferedAmount;this.bufferedAmount-=copy.byteLength;if(previous>this.bufferedAmountLowThreshold&&this.bufferedAmount<=this.bufferedAmountLowThreshold)this.onbufferedamountlow?.({});};
    if(this.hold)this.held.push(deliver);else queueMicrotask(deliver);
  }
  release(){this.hold=false;for(const deliver of this.held.splice(0))queueMicrotask(deliver);}
  close(){if(this.readyState==='closed')return;this.readyState='closed';this.onclose?.({});if(this.remote&&this.remote.readyState!=='closed'){this.remote.readyState='closed';this.remote.onclose?.({});}}
}
class RTC {
  pcs=new Map();serial=0;
  create=configuration=>{
    const rtc=this,id=String(++this.serial),pc={id,configuration,connectionState:'new',iceConnectionState:'new',remoteDescription:null,localDescription:null,candidates:[],channel:null,remote:null,
      createDataChannel(label,options){assert.equal(label,'vulgar-v2');assert.equal(options.ordered,true);this.channel=new Channel();return this.channel;},
      async createOffer(){return{type:'offer',sdp:JSON.stringify({id:this.id})};},async createAnswer(){return{type:'answer',sdp:JSON.stringify({id:this.id})};},
      async setLocalDescription(description){this.localDescription=description;this.onicecandidate?.({candidate:{toJSON:()=>({candidate:'candidate:'+this.id})}});},
      async setRemoteDescription(description){
        this.remoteDescription=description;const other=rtc.pcs.get(JSON.parse(description.sdp).id);assert.ok(other);this.remote=other;
        if(description.type==='answer'){
          const host=this,guest=other,a=host.channel,b=new Channel();assert.ok(a);a.remote=b;b.remote=a;guest.channel=b;
          guest.ondatachannel?.({channel:b});
          queueMicrotask(()=>{for(const node of [host,guest]){node.connectionState='connected';node.iceConnectionState='connected';node.onconnectionstatechange?.({});}for(const channel of [a,b]){channel.readyState='open';channel.onopen?.({});}});
        }
      },
      async addIceCandidate(candidate){assert.ok(this.remoteDescription,'ICE is queued until the remote SDP exists');this.candidates.push(candidate);},
      close(){if(this.connectionState==='closed')return;this.connectionState='closed';this.iceConnectionState='closed';this.onconnectionstatechange?.({});this.channel?.close();},
    };this.pcs.set(id,pc);return pc;
  };
}
class Browser extends EventTarget {navigator={onLine:true};offline(){this.navigator.onLine=false;this.dispatchEvent(new Event('offline'));}online(){this.navigator.onLine=true;this.dispatchEvent(new Event('online'));}page(name,persisted=false){const event=new Event(name);Object.defineProperty(event,'persisted',{value:persisted});this.dispatchEvent(event);}}
async function setup(t,count=1){
  const credentials=await api.createHostedInvite(),signaling=new Signaling(),rtc=new RTC(),transports=[],browsers=[];
  const create=async(options={})=>{
    const browser=new Browser();browsers.push(browser);
    const transport=await api.createHostedTransport(credentials.invite,{webSocketFactory:signaling.create,peerConnectionFactory:rtc.create,browser,reconnectDelayMs:20,...options});transports.push(transport);return transport;
  };
  t.after(()=>{for(const transport of transports)transport.destroy();});
  const host=await create({hostKey:credentials.hostKey}),guests=[];for(let index=0;index<count;index++)guests.push(await create());
  await wait(()=>host.getState().peers.length===count&&guests.every(guest=>guest.getState().available),'authenticated star');
  return{...credentials,host,guests,signaling,rtc,browsers,create};
}

test('version 2 invitations pin a non-exportable host key and reject old mesh invitations',async()=>{
  const {invite,hostKey}=await api.createHostedInvite();assert.equal(invite.version,2);assert.equal(hostKey.extractable,false);assert.match(invite.hostPublicKey,/^[A-Za-z0-9_-]{87}$/);
  const link=api.collaborationInviteUrl(invite,'https://user:pass@example.test/editor?document=private');assert.deepEqual(api.parseCollaborationInvite(link),invite);
  const url=new URL(link);assert.equal(url.search,'');assert.equal(url.username,'');assert.equal(url.password,'');assert.equal(api.parseCollaborationInvite('https://example.test/'),null);
  const old={version:1,room:invite.room,password:invite.password};assert.throws(()=>api.parseCollaborationInvite('https://example.test/#collab='+encodeURIComponent(JSON.stringify(old))),/invalid/);
  assert.doesNotMatch(JSON.stringify(invite),/private|hostKey/);
});
test('the host key must match the public key in the invitation',async()=>{
  const a=await api.createHostedInvite(),b=await api.createHostedInvite();await assert.rejects(api.createHostedTransport(a.invite,{hostKey:b.hostKey}),/secure collaboration connection/);
});
test('native data channels form a star, authenticate SDP, and never give guests a document or a peer-to-peer route',async t=>{
  const {host,guests,rtc,signaling}=await setup(t,2);assert.equal(host.role,'host');assert.equal(host.getState().available,true);
  for(const guest of guests){assert.equal(guest.role,'guest');assert.deepEqual(guest.getState().peers,[host.peerId]);assert.equal(guest.send(guests.find(item=>item!==guest).peerId,enc.encode('not allowed')),false);assert.equal('doc' in guest,false);}
  assert.equal(rtc.pcs.size,4);assert.equal([...rtc.pcs.values()].filter(pc=>pc.localDescription.type==='offer').length,2);
  await wait(()=>[...rtc.pcs.values()].every(pc=>pc.candidates.length>0),'trickled ICE');
  assert.ok(signaling.published.every(message=>!JSON.stringify(message).includes('candidate:')&&!JSON.stringify(message).includes('"sdp"')),'SDP and ICE are encrypted on public signaling');
});
test('ordered framing transfers large binary documents with backpressure and bounded SCTP packets',async t=>{
  const {host,guests:[guest],rtc}=await setup(t),received=[];guest.onMessage((from,message)=>received.push({from,message}));
  const hostChannel=[...rtc.pcs.values()].find(pc=>pc.localDescription.type==='offer').channel;hostChannel.hold=true;
  const large=new Uint8Array(1024*1024+31);for(let index=0;index<large.length;index++)large[index]=index%251;
  assert.equal(host.send(guest.peerId,large),true);assert.equal(host.send(guest.peerId,enc.encode('second')),true);assert.ok(hostChannel.bufferedAmount<=256*1024+16*1024);assert.equal(received.length,0);
  hostChannel.release();await wait(()=>received.length===2,'framed large message');assert.equal(received[0].from,host.peerId);assert.deepEqual(received[0].message,large);assert.equal(dec.decode(received[1].message),'second');
  assert.ok(hostChannel.sent.every(frame=>frame.byteLength<=16*1024));
  const back=[];host.onMessage((from,message)=>back.push([from,dec.decode(message)]));assert.equal(guest.send(host.peerId,enc.encode('proposal')),true);await wait(()=>back.length);assert.deepEqual(back,[[guest.peerId,'proposal']]);
});
test('offline immediately freezes a guest, reconnect keeps its identity and creates a fresh channel',async t=>{
  const {host,guests:[guest],browsers,rtc}=await setup(t),id=guest.peerId,firstConnections=rtc.pcs.size;
  browsers[1].offline();assert.equal(guest.getState().available,false);assert.equal(guest.send(host.peerId,enc.encode('offline edit')),false);assert.equal(host.getState().available,true);
  browsers[1].online();await wait(()=>guest.getState().available&&host.getState().peers.length===1,'fresh guest connection');assert.equal(guest.peerId,id);assert.equal(rtc.pcs.size,firstConnections+2);
});
test('signaling failure does not terminate an authenticated direct channel',async t=>{
  const {host,guests:[guest],signaling}=await setup(t);const first=[...signaling.sockets];for(const socket of first)socket.close();
  assert.equal(guest.getState().available,true);const messages=[];host.onMessage((from,bytes)=>messages.push(dec.decode(bytes)));assert.equal(guest.send(host.peerId,enc.encode('direct')),true);await wait(()=>messages.length);assert.deepEqual(messages,['direct']);
  await wait(()=>signaling.sockets.size===2,'signaling reconnect');assert.equal(guest.getState().peers.length,1);
});
test('beforeunload cancellation preserves the connection; confirmed host pagehide ends the session',async t=>{
  const {host,guests:[guest],browsers}=await setup(t);browsers[0].dispatchEvent(new Event('beforeunload'));assert.equal(host.getState().available,true);assert.equal(guest.getState().available,true);
  browsers[0].page('pagehide',true);assert.equal(host.getState().ended,true);assert.equal(host.getState().available,false);await wait(()=>!guest.getState().available);
  browsers[0].page('pageshow',true);assert.equal(host.getState().available,false);assert.equal(host.getState().ended,true);
});
test('guests cannot end the host session with a forged transport-control message',async t=>{
  const {host,guests:[guest],rtc}=await setup(t),guestChannel=[...rtc.pcs.values()].find(pc=>pc.localDescription.type==='answer').channel;
  const frame=new Uint8Array(16),view=new DataView(frame.buffer);view.setUint16(0,0x564e);frame[2]=2;frame[3]=4;guestChannel.send(frame.buffer);await wait(()=>guestChannel.readyState==='closed');
  assert.equal(host.getState().available,true);assert.notEqual(host.getState().ended,true);
});
test('knowing the invitation password does not allow forging a host SDP signature',async t=>{
  const {invite}=await api.createHostedInvite(),rogue=await api.createHostedInvite(),signaling=new Signaling(),rtc=new RTC();
  const guest=await api.createHostedTransport(invite,{webSocketFactory:signaling.create,peerConnectionFactory:rtc.create,browser:new Browser(),reconnectDelayMs:20});t.after(()=>guest.destroy());
  await wait(()=>signaling.published.length>0,'guest hello');
  const hello=await decodeSignal(invite,signaling.published[0]);assert.equal(hello.kind,'hello');
  const from=api.randomCollaborationId(),message={v:2,room:invite.room,kind:'offer',from,to:guest.peerId,nonce:hello.nonce,session:'1'.repeat(32),sdp:'malicious SDP'};
  await injectSignal(invite,signaling,message,rogue.hostKey);
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(rtc.pcs.size,0);assert.equal(guest.getState().available,false);assert.equal(guest.getState().peers.length,0);
});
test('old channel close callbacks cannot remove the replacement connection',async t=>{
  const {host,guests:[guest],rtc,browsers}=await setup(t),old=[...rtc.pcs.values()].find(pc=>pc.localDescription.type==='answer').channel;
  const lateClose=old.onclose;browsers[1].offline();browsers[1].online();await wait(()=>guest.getState().available,'new connection');
  lateClose({});assert.equal(guest.getState().available,true);assert.deepEqual(guest.getState().peers,[host.peerId]);
});
test('an invitation holder cannot impersonate an already-authorized guest identity',async t=>{
  const {invite,host,guests:[guest],signaling,rtc}=await setup(t),rogue=await api.createHostedInvite(),originalCount=rtc.pcs.size;
  const hello=(await Promise.all(signaling.published.map(publication=>decodeSignal(invite,publication)))).find(message=>message.kind==='hello'&&message.from===guest.peerId);assert.ok(hello);
  const {signature,...forged}=hello;forged.nonce=api.randomCollaborationId();
  // The real guest public key is retained, but the impersonator has no private key.
  await injectSignal(invite,signaling,forged,rogue.hostKey);await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(rtc.pcs.size,originalCount);assert.equal(guest.getState().available,true);assert.deepEqual(host.getState().peers,[guest.peerId]);
});

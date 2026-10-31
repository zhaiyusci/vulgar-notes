// SPDX-License-Identifier: GPL-3.0-or-later
import {assertCollaborationInvite,collaborationBase64,collaborationBytes,randomCollaborationId,type CollaborationInvite} from './collaboration-invite';

export const DEFAULT_SIGNALING:readonly string[]=Object.freeze(['wss://y-webrtc-eu.fly.dev']);
export const DEFAULT_ICE_SERVERS:readonly RTCIceServer[]=Object.freeze([{urls:'stun:stun.cloudflare.com:3478'},{urls:'stun:stun.l.google.com:19302'}]);
export interface HostedTransportState {available:boolean;peers:readonly string[];error?:string;ended?:boolean}
export interface HostedTransport {
  readonly peerId:string;readonly role:'host'|'guest';
  getState():HostedTransportState;
  subscribe(listener:()=>void):()=>void;
  onMessage(listener:(peerId:string,message:Uint8Array)=>void):()=>void;
  send(peerId:string,message:Uint8Array):boolean;
  destroy():void;
}
type Browser=EventTarget&{navigator?:{onLine?:boolean}};
export interface HostedTransportOptions {
  hostKey?:CryptoKey;signaling?:readonly string[];iceServers?:readonly RTCIceServer[];
  webSocketFactory?:(url:string)=>WebSocket;
  peerConnectionFactory?:(configuration:RTCConfiguration)=>RTCPeerConnection;
  browser?:Browser|null;reconnectDelayMs?:number;heartbeatIntervalMs?:number;heartbeatTimeoutMs?:number;
}
type Wire={v:2;room:string;kind:'host'|'hello'|'offer'|'answer'|'ice'|'bye';from:string;to?:string;nonce?:string;session?:string;sdp?:string;candidate?:RTCIceCandidateInit;guestPublicKey?:string;signature?:string};
type Queued={bytes:Uint8Array;id:number;offset:number};
type Connection={id:string;nonce:string;session:string;pc:RTCPeerConnection;publicKey?:CryptoKey;channel?:RTCDataChannel;ready:boolean;closed:boolean;localSent:boolean;ice:RTCIceCandidateInit[];remoteIce:RTCIceCandidateInit[];queue:Queued[];queuedBytes:number;nextMessage:number;received?:{id:number;bytes:Uint8Array;offset:number};lastReceived:number;heartbeat?:ReturnType<typeof setInterval>;flushTimer?:ReturnType<typeof setTimeout>};
const encoder=new TextEncoder(),decoder=new TextDecoder();
const FRAME_BYTES=16*1024,HEADER_BYTES=16,MAX_MESSAGE_BYTES=128*1024*1024,MAX_QUEUED_BYTES=256*1024*1024;
const HIGH_BUFFER=256*1024,LOW_BUFFER=64*1024;
const transportError='The collaboration connection was interrupted.';
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{32}$/.test(value);
const copyBuffer=(bytes:Uint8Array):ArrayBuffer=>new Uint8Array(bytes).buffer;
const keyFingerprint=async(raw:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',copyBuffer(raw))).subarray(0,16),byte=>byte.toString(16).padStart(2,'0')).join('');

/** No document is attached to this transport. Only the host can connect guests. */
class StarTransport implements HostedTransport {
  readonly peerId:string;
  readonly role:'host'|'guest';
  private readonly connections=new Map<string,Connection>();
  private readonly listeners=new Set<()=>void>();
  private readonly messages=new Set<(peerId:string,message:Uint8Array)=>void>();
  private readonly browser:Browser|null;
  private socket:WebSocket|undefined;
  private socketGeneration=0;
  private signalReady=false;
  private outgoing=Promise.resolve();
  private incoming=Promise.resolve();
  private retry:ReturnType<typeof setTimeout>|undefined;
  private destroyed=false;
  private ended=false;
  private hostId:string|undefined;
  private joinNonce=randomCollaborationId();
  private state:HostedTransportState=Object.freeze({available:false,peers:Object.freeze([])});
  private error:string|undefined;
  private endEnvelope:string|undefined;
  private readonly networkOffline=()=>{this.closeSignaling();this.dropAll();this.refresh();};
  private readonly networkOnline=()=>{if(!this.destroyed&&!this.ended)this.connectSignaling();};
  private readonly pageHide=()=>{
    if(this.role==='host'){this.ended=true;this.notifyEnd();this.dropAll(true);this.closeSignaling();}
    else{this.closeSignaling();this.dropAll();}
    this.refresh();
  };
  private readonly pageShow=(event:Event)=>{if((event as PageTransitionEvent).persisted&&!this.ended&&!this.destroyed)this.connectSignaling();};
  constructor(private invite:CollaborationInvite,private options:HostedTransportOptions,private encryptionKey:CryptoKey,private publicKey:CryptoKey,private signingKey:CryptoKey,private identityPublicKey?:string,identityId?:string){
    this.peerId=identityId??randomCollaborationId();
    this.role=options.hostKey?'host':'guest';this.browser=options.browser===undefined?(typeof window==='undefined'?null:window):options.browser;
    this.browser?.addEventListener('offline',this.networkOffline);this.browser?.addEventListener('online',this.networkOnline);
    this.browser?.addEventListener('pagehide',this.pageHide);this.browser?.addEventListener('pageshow',this.pageShow);
    // Prepare the signed end notice in advance: pagehide cannot await crypto.
    if(this.role==='host')void this.envelope({kind:'bye',from:this.peerId}).then(value=>{this.endEnvelope=value;},()=>{});
    this.refresh();this.connectSignaling();
  }
  getState=()=>this.state;
  subscribe=(listener:()=>void)=>{if(!this.destroyed)this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  onMessage=(listener:(peerId:string,message:Uint8Array)=>void)=>{if(!this.destroyed)this.messages.add(listener);return()=>{this.messages.delete(listener);};};
  private online(){return this.browser?.navigator?.onLine!==false;}
  private current(connection:Connection){return !connection.closed&&this.connections.get(connection.id)===connection&&!this.destroyed&&!this.ended;}
  private refresh(){
    const peers=[...this.connections.values()].filter(connection=>connection.ready&&!connection.closed).map(connection=>connection.id).sort();
    const available=!this.destroyed&&!this.ended&&(this.role==='host'||this.online()&&peers.length===1);
    if(available===this.state.available&&this.ended===!!this.state.ended&&this.error===this.state.error&&peers.length===this.state.peers.length&&peers.every((id,index)=>id===this.state.peers[index]))return;
    this.state=Object.freeze({available,peers:Object.freeze(peers),...(this.error?{error:this.error}:{}),...(this.ended?{ended:true}:{})});
    for(const listener of this.listeners)listener();
  }
  private closeSignaling(){
    this.socketGeneration++;this.signalReady=false;if(this.retry!==undefined)clearTimeout(this.retry);this.retry=undefined;
    const socket=this.socket;this.socket=undefined;try{socket?.close();}catch{/* A failed signaling socket has no document data. */}
  }
  private connectSignaling(){
    if(this.destroyed||this.ended||!this.online()||this.socket)return;
    const generation=++this.socketGeneration;
    let socket:WebSocket;
    try{socket=(this.options.webSocketFactory??(url=>new WebSocket(url)))((this.options.signaling??DEFAULT_SIGNALING)[0]);}
    catch{this.error=transportError;this.refresh();this.scheduleRetry();return;}
    this.socket=socket;
    socket.onopen=()=>{
      if(this.socket!==socket||generation!==this.socketGeneration)return;
      this.signalReady=true;this.error=undefined;
      socket.send(JSON.stringify({type:'subscribe',topics:[this.topic()]}));
      if(this.role==='host')this.publish({kind:'host',from:this.peerId});else this.hello();
      this.refresh();
    };
    socket.onmessage=event=>{
      this.incoming=this.incoming.then(async()=>{
        if(this.socket!==socket||generation!==this.socketGeneration||typeof event.data!=='string'||event.data.length>256*1024)return;
        try{
          const envelope=JSON.parse(event.data);
          if(envelope.type!=='publish'||envelope.topic!==this.topic()||typeof envelope.data!=='string')return;
          const encrypted=JSON.parse(envelope.data);
          if(encrypted.v!==2||typeof encrypted.iv!=='string'||typeof encrypted.data!=='string')return;
          const iv=collaborationBytes(encrypted.iv);if(iv.length!==12)return;
          const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:copyBuffer(iv)},this.encryptionKey,copyBuffer(collaborationBytes(encrypted.data)));
          if(this.socket!==socket||generation!==this.socketGeneration)return;
          const message:Wire=JSON.parse(decoder.decode(plaintext));await this.receiveSignal(message);
        }catch{/* Ignore unauthenticated or malformed signaling without echoing it. */}
      });
    };
    const failed=()=>{
      if(this.socket!==socket||generation!==this.socketGeneration)return;
      this.socket=undefined;this.signalReady=false;this.error=transportError;
      // A direct authenticated data channel remains usable if only discovery
      // goes away. RTC and application heartbeats independently detect loss.
      this.refresh();this.scheduleRetry();
    };
    socket.onclose=failed;socket.onerror=()=>{failed();try{socket.close();}catch{}};
  }
  private scheduleRetry(){
    if(this.destroyed||this.ended||!this.online()||this.retry!==undefined)return;
    this.retry=setTimeout(()=>{this.retry=undefined;this.connectSignaling();},this.options.reconnectDelayMs??1500);
  }
  private topic(){return 'vulgar-host-v2:'+this.invite.room;}
  private async envelope(fields:Omit<Wire,'v'|'room'>):Promise<string>{
    const message:Wire={v:2,room:this.invite.room,...fields};
    message.signature=collaborationBase64(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},this.signingKey,encoder.encode(JSON.stringify(message)))));
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},this.encryptionKey,encoder.encode(JSON.stringify(message)));
    return JSON.stringify({type:'publish',topic:this.topic(),data:JSON.stringify({v:2,iv:collaborationBase64(iv),data:collaborationBase64(new Uint8Array(data))})});
  }
  private notifyEnd(){if(this.endEnvelope&&this.signalReady&&this.socket)try{this.socket.send(this.endEnvelope);}catch{}}
  private publish(fields:Omit<Wire,'v'|'room'>){
    const socket=this.socket,generation=this.socketGeneration;
    this.outgoing=this.outgoing.then(async()=>{
      if(this.destroyed||!socket||this.socket!==socket||generation!==this.socketGeneration||!this.signalReady)return;
      const envelope=await this.envelope(fields);
      if(this.destroyed||this.socket!==socket||generation!==this.socketGeneration||!this.signalReady)return;
      socket.send(envelope);
    }).catch(()=>{if(!this.destroyed){this.error=transportError;this.refresh();}});
  }
  private hello(){this.publish({kind:'hello',from:this.peerId,...(this.hostId?{to:this.hostId}:{}),nonce:this.joinNonce,guestPublicKey:this.identityPublicKey});}
  private async authentic(message:Wire,key=this.publicKey){
    if(typeof message.signature!=='string'||message.signature.length>256)return false;
    const {signature,...signed}=message;
    return crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,copyBuffer(collaborationBytes(signature)),encoder.encode(JSON.stringify(signed)));
  }
  private async receiveSignal(message:Wire){
    if(!message||message.v!==2||message.room!==this.invite.room||!validId(message.from)||message.from===this.peerId||message.to!==undefined&&message.to!==this.peerId||this.destroyed||this.ended||!this.online())return;
    if(this.role==='host'){
      if(message.kind==='hello'&&validId(message.nonce)){
        if(typeof message.guestPublicKey!=='string'||!/^[A-Za-z0-9_-]{87}$/.test(message.guestPublicKey))return;
        const raw=collaborationBytes(message.guestPublicKey);if(await keyFingerprint(raw)!==message.from)return;
        const guestKey=await crypto.subtle.importKey('raw',copyBuffer(raw),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
        if(!await this.authentic(message,guestKey))return;
        const existing=this.connections.get(message.from);if(existing&&existing.nonce===message.nonce)return;
        if(existing)this.drop(existing);
        const connection=this.createConnection(message.from,message.nonce,randomCollaborationId());
        connection.publicKey=guestKey;
        const channel=connection.pc.createDataChannel('vulgar-v2',{ordered:true});this.bindChannel(connection,channel);
        const offer=await connection.pc.createOffer();if(!this.current(connection))return;
        await connection.pc.setLocalDescription(offer);if(!this.current(connection))return;
        this.publish({kind:'offer',from:this.peerId,to:connection.id,nonce:connection.nonce,session:connection.session,sdp:connection.pc.localDescription?.sdp??offer.sdp});
        connection.localSent=true;this.sendIce(connection);
      }else{
        const connection=this.connections.get(message.from);
        if(!connection||connection.nonce!==message.nonce||connection.session!==message.session)return;
        if(!connection.publicKey||!await this.authentic(message,connection.publicKey))return;
        if(message.kind==='answer'&&typeof message.sdp==='string'){
          if(connection.pc.remoteDescription)return;
          await connection.pc.setRemoteDescription({type:'answer',sdp:message.sdp});await this.receiveIce(connection);
        }else if(message.kind==='ice'&&message.candidate){await this.addIce(connection,message.candidate);}
      }
      return;
    }
    if(!['host','offer','ice','bye'].includes(message.kind)||!await this.authentic(message))return;
    if(message.kind==='host'){
      if(this.hostId&&this.hostId!==message.from)return;this.hostId=message.from;this.hello();return;
    }
    if(this.hostId&&this.hostId!==message.from)return;
    if(message.kind==='bye'){this.ended=true;this.dropAll();this.closeSignaling();this.refresh();return;}
    if(message.nonce!==this.joinNonce||!validId(message.session))return;
    if(message.kind==='offer'&&typeof message.sdp==='string'){
      this.hostId=message.from;
      const existing=this.connections.get(message.from);
      if(existing?.session===message.session)return;if(existing)this.drop(existing,false);
      const connection=this.createConnection(message.from,this.joinNonce,message.session);
      connection.pc.ondatachannel=event=>this.bindChannel(connection,event.channel);
      await connection.pc.setRemoteDescription({type:'offer',sdp:message.sdp});if(!this.current(connection))return;
      const answer=await connection.pc.createAnswer();if(!this.current(connection))return;
      await connection.pc.setLocalDescription(answer);if(!this.current(connection))return;
      this.publish({kind:'answer',from:this.peerId,to:connection.id,nonce:connection.nonce,session:connection.session,sdp:connection.pc.localDescription?.sdp??answer.sdp});
      connection.localSent=true;this.sendIce(connection);await this.receiveIce(connection);
    }else if(message.kind==='ice'&&message.candidate){
      const connection=this.connections.get(message.from);if(connection?.session===message.session)await this.addIce(connection,message.candidate);
    }
  }
  private createConnection(id:string,nonce:string,session:string):Connection {
    const pc=(this.options.peerConnectionFactory??(configuration=>new RTCPeerConnection(configuration)))({iceServers:[...(this.options.iceServers??DEFAULT_ICE_SERVERS)].map(server=>({...server}))});
    const connection:Connection={id,nonce,session,pc,ready:false,closed:false,localSent:false,ice:[],remoteIce:[],queue:[],queuedBytes:0,nextMessage:1,lastReceived:Date.now()};
    this.connections.set(id,connection);
    pc.onicecandidate=event=>{if(!this.current(connection)||!event.candidate)return;connection.ice.push(event.candidate.toJSON());this.sendIce(connection);};
    const stateChanged=()=>{if(this.current(connection)&&(['failed','disconnected','closed'].includes(pc.connectionState)||['failed','disconnected','closed'].includes(pc.iceConnectionState)))this.drop(connection);};
    pc.onconnectionstatechange=stateChanged;pc.oniceconnectionstatechange=stateChanged;return connection;
  }
  private sendIce(connection:Connection){
    if(!connection.localSent||!this.current(connection))return;
    for(const candidate of connection.ice.splice(0))this.publish({kind:'ice',from:this.peerId,to:connection.id,nonce:connection.nonce,session:connection.session,candidate});
  }
  private async addIce(connection:Connection,candidate:RTCIceCandidateInit){
    if(typeof candidate.candidate!=='string'||candidate.candidate.length>16384)return;
    if(!connection.pc.remoteDescription){connection.remoteIce.push(candidate);return;}
    if(this.current(connection))await connection.pc.addIceCandidate(candidate);
  }
  private async receiveIce(connection:Connection){for(const candidate of connection.remoteIce.splice(0))if(this.current(connection))await connection.pc.addIceCandidate(candidate);}
  private bindChannel(connection:Connection,channel:RTCDataChannel){
    if(!this.current(connection)||connection.channel&&connection.channel!==channel||channel.label!=='vulgar-v2'){channel.close();return;}
    connection.channel=channel;channel.binaryType='arraybuffer';channel.bufferedAmountLowThreshold=LOW_BUFFER;
    const opened=()=>{
      if(!this.current(connection)||connection.ready)return;
      connection.ready=true;connection.lastReceived=Date.now();this.error=undefined;
      connection.heartbeat=setInterval(()=>{
        if(!this.current(connection))return;
        if(Date.now()-connection.lastReceived>(this.options.heartbeatTimeoutMs??20000)){this.drop(connection);return;}
        this.control(connection,2);
      },this.options.heartbeatIntervalMs??5000);
      this.refresh();this.flush(connection);
    };
    channel.onopen=opened;channel.onbufferedamountlow=()=>this.flush(connection);
    channel.onclose=()=>{if(this.current(connection))this.drop(connection);};channel.onerror=()=>{if(this.current(connection))this.drop(connection);};
    channel.onmessage=event=>{
      if(!this.current(connection))return;
      try{
        if(!(event.data instanceof ArrayBuffer)){this.drop(connection);return;}
        this.receiveFrame(connection,new Uint8Array(event.data));
      }catch{this.drop(connection);}
    };
    if(channel.readyState==='open')opened();
  }
  private control(connection:Connection,kind:number){
    if(!connection.ready||connection.channel?.readyState!=='open')return;
    const bytes=new Uint8Array(HEADER_BYTES),view=new DataView(bytes.buffer);view.setUint16(0,0x564e);bytes[2]=2;bytes[3]=kind;
    try{connection.channel.send(bytes.buffer);}catch{this.drop(connection);}
  }
  send(peerId:string,message:Uint8Array):boolean {
    const connection=this.connections.get(peerId);
    if(!connection||!this.current(connection)||!connection.ready||!this.state.available||message.byteLength>MAX_MESSAGE_BYTES||connection.queuedBytes+message.byteLength>MAX_QUEUED_BYTES)return false;
    connection.queue.push({bytes:new Uint8Array(message),id:connection.nextMessage++>>>0,offset:0});connection.queuedBytes+=message.byteLength;this.flush(connection);return true;
  }
  private flush(connection:Connection){
    const channel=connection.channel;if(!this.current(connection)||!connection.ready||channel?.readyState!=='open')return;
    while(connection.queue.length&&channel.bufferedAmount<HIGH_BUFFER){
      const item=connection.queue[0],length=Math.min(FRAME_BYTES-HEADER_BYTES,item.bytes.length-item.offset),frame=new Uint8Array(HEADER_BYTES+length),view=new DataView(frame.buffer);
      view.setUint16(0,0x564e);frame[2]=2;frame[3]=1;view.setUint32(4,item.id);view.setUint32(8,item.bytes.length);view.setUint32(12,item.offset);frame.set(item.bytes.subarray(item.offset,item.offset+length),HEADER_BYTES);
      try{channel.send(frame.buffer);}catch{
        if(channel.readyState!=='open'){this.drop(connection);return;}
        break;
      }
      item.offset+=length;if(item.offset===item.bytes.length){connection.queue.shift();connection.queuedBytes-=item.bytes.length;}
    }
    if(connection.queue.length&&connection.flushTimer===undefined)connection.flushTimer=setTimeout(()=>{connection.flushTimer=undefined;this.flush(connection);},50);
  }
  private receiveFrame(connection:Connection,bytes:Uint8Array){
    if(bytes.length<HEADER_BYTES||bytes.length>FRAME_BYTES)return this.drop(connection);
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(view.getUint16(0)!==0x564e||bytes[2]!==2)return this.drop(connection);
    connection.lastReceived=Date.now();
    if(bytes[3]===2){this.control(connection,3);return;}if(bytes[3]===3)return;
    if(bytes[3]===4){if(this.role==='host')return this.drop(connection);this.ended=true;this.dropAll();this.closeSignaling();this.refresh();return;}
    if(bytes[3]!==1)return this.drop(connection);
    const id=view.getUint32(4),total=view.getUint32(8),offset=view.getUint32(12),length=bytes.length-HEADER_BYTES;
    if(total>MAX_MESSAGE_BYTES||offset+length>total||length===0&&total!==0)return this.drop(connection);
    if(!connection.received){if(offset!==0)return this.drop(connection);connection.received={id,bytes:new Uint8Array(total),offset:0};}
    const receiving=connection.received;
    if(receiving.id!==id||receiving.bytes.length!==total||receiving.offset!==offset)return this.drop(connection);
    receiving.bytes.set(bytes.subarray(HEADER_BYTES),offset);receiving.offset+=length;
    if(receiving.offset===total){connection.received=undefined;for(const listener of this.messages)listener(connection.id,receiving.bytes);}
  }
  private drop(connection:Connection,renew=true){
    if(connection.closed)return;connection.closed=true;
    if(connection.heartbeat!==undefined)clearInterval(connection.heartbeat);if(connection.flushTimer!==undefined)clearTimeout(connection.flushTimer);
    connection.queue=[];connection.queuedBytes=0;connection.received=undefined;
    const current=this.connections.get(connection.id)===connection;if(current)this.connections.delete(connection.id);
    try{connection.channel?.close();}catch{}try{connection.pc.close();}catch{}
    if(current&&this.role==='guest'&&renew&&!this.destroyed&&!this.ended){this.joinNonce=randomCollaborationId();if(this.signalReady)this.hello();}
    this.refresh();
  }
  private dropAll(ending=false){for(const connection of [...this.connections.values()]){if(ending)this.control(connection,4);this.drop(connection,false);}if(this.role==='guest')this.joinNonce=randomCollaborationId();}
  destroy(){
    if(this.destroyed)return;this.destroyed=true;this.ended=this.role==='host'||this.ended;if(this.role==='host')this.notifyEnd();this.dropAll(this.role==='host');this.closeSignaling();
    this.browser?.removeEventListener('offline',this.networkOffline);this.browser?.removeEventListener('online',this.networkOnline);
    this.browser?.removeEventListener('pagehide',this.pageHide);this.browser?.removeEventListener('pageshow',this.pageShow);
    this.refresh();this.listeners.clear();this.messages.clear();
  }
}
export async function createHostedTransport(invite:CollaborationInvite,options:HostedTransportOptions={}):Promise<HostedTransport> {
  assertCollaborationInvite(invite);
  try{
    const publicKey=await crypto.subtle.importKey('raw',copyBuffer(collaborationBytes(invite.hostPublicKey)),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    if(options.hostKey){
      const challenge=crypto.getRandomValues(new Uint8Array(32)),signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},options.hostKey,challenge);
      if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,signature,challenge))throw Error();
    }
    const material=await crypto.subtle.importKey('raw',encoder.encode(invite.password),{name:'HKDF'},false,['deriveKey']);
    const key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode(invite.room),info:encoder.encode('Vulgar Notes hosted signaling v2')},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    let signingKey=options.hostKey,identityPublicKey:string|undefined,identityId:string|undefined;
    if(!signingKey){
      const identity=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);signingKey=identity.privateKey;
      const raw=new Uint8Array(await crypto.subtle.exportKey('raw',identity.publicKey));identityPublicKey=collaborationBase64(raw);identityId=await keyFingerprint(raw);
    }
    return new StarTransport(invite,options,key,publicKey,signingKey,identityPublicKey,identityId);
  }catch{throw Error('Unable to establish a secure collaboration connection.');}
}

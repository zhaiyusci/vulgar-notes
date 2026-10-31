// SPDX-License-Identifier: GPL-3.0-or-later
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

/** A direct, authenticated host connection; document history never enters it automatically. */
export interface AuthorityTransport {
  readonly peerId:string;
  readonly role:'host'|'guest';
  getState():{available:boolean;peers:readonly string[];error?:string;ended?:boolean};
  subscribe(listener:()=>void):()=>void;
  onMessage(listener:(peerId:string,message:Uint8Array)=>void):()=>void;
  send(peerId:string,message:Uint8Array):boolean;
}
export type CollaborationPermission='view'|'edit';
export interface AuthorityPeer {peerId:string;permission:CollaborationPermission}
export interface AuthorityState {
  role:'host'|'guest';writable:boolean;initialized:boolean;pending:number;revision:number;
  permission:CollaborationPermission;hostConnected:boolean;peers:readonly AuthorityPeer[];
  hostEpoch?:string;ended:boolean;error?:string;
}
export interface AuthorityOptions {
  /** Only the host supplies a durable canonical document. Guests always start from a new document. */
  hostDocument?:Y.Doc;
  /** An application's shared roots are fixed when the host starts the session. */
  allowedRoots?:readonly string[];
  /** Protocol/session identifiers are readable by guests but are not editable content. */
  immutableRootKeys?:Readonly<Record<string,readonly string[]>>;
  onDocument(doc:Y.Doc):void;
  onState?(state:AuthorityState):void;
  /** Capture a detached recovery copy now; this document will never be replayed on reconnect. */
  onRecovery?(doc:Y.Doc,reason:string):void;
  /** null removes all Awareness clients previously associated with this transport peer. */
  onPresence?(peerId:string,update:Uint8Array|null):void;
}

const VERSION=1;
export const MAX_AUTHORITY_UPDATE_BYTES=64*1024*1024;
const enum Message {Hello,Snapshot,Ready,Open,Proposal,Commit,Ack,Reset,Presence,RelayedPresence,Ended,PeerLeft}
const remoteOrigin={authority:true};
const randomToken=()=>{
  const bytes=new Uint8Array(16);globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
};
type Lease={nonce:string;ready:boolean;seq:number;baseline:Uint8Array;permission:CollaborationPermission};
const freezeState=(state:AuthorityState):AuthorityState=>Object.freeze({...state,peers:Object.freeze(state.peers.map(peer=>Object.freeze(peer)))});

/** Decode first: Yjs transactions do not roll back if malformed bytes throw midway. */
function preflightUpdate(doc:Y.Doc,update:Uint8Array,options:AuthorityOptions):void {
  if(update.byteLength>MAX_AUTHORITY_UPDATE_BYTES)throw Error('The collaboration update is too large.');
  const decoded=Y.decodeUpdate(update),known=Y.decodeStateVector(Y.encodeStateVector(doc));
  const allowed=new Set(options.allowedRoots??doc.share.keys());
  const ranges=new Map<number,{clock:number;length:number}[]>();
  for(const struct of decoded.structs){
    const clientRanges=ranges.get(struct.id.client)??[];clientRanges.push({clock:struct.id.clock,length:struct.length});ranges.set(struct.id.client,clientRanges);
    if(struct instanceof Y.Item){
      if(struct.content instanceof Y.ContentDoc)throw Error('Shared subdocuments are not supported.');
      if(typeof struct.parent==='string'){
        if(!allowed.has(struct.parent))throw Error('Unknown shared document root.');
        if(struct.parentSub&&options.immutableRootKeys?.[struct.parent]?.includes(struct.parentSub))throw Error('The collaboration protocol is not editable.');
      }
    }
  }
  // Every new item must follow known history or an earlier item in this update.
  // This prevents an incomplete proposal from poisoning pendingStructs/pendingDs.
  const available=new Map(known);
  for(const [client,items] of ranges){
    let end=known.get(client)??0;
    for(const item of items.sort((a,b)=>a.clock-b.clock)){
      if(item.clock>end)throw Error('The collaboration update has missing history.');
      end=Math.max(end,item.clock+item.length);
    }
    available.set(client,end);
  }
  const availableId=(id:Y.ID|null)=>!id||id.clock<(available.get(id.client)??0);
  for(const struct of decoded.structs)if(struct instanceof Y.Item){
    const parent=struct.parent;
    if(!availableId(struct.origin)||!availableId(struct.rightOrigin)||parent instanceof Y.ID&&!availableId(parent))throw Error('The collaboration update has missing history.');
  }
  for(const [client,deletions] of decoded.ds.clients)for(const deletion of deletions){
    if(deletion.clock+deletion.len>(available.get(client)??0))throw Error('The collaboration deletion has missing history.');
    for(const [root,keys] of Object.entries(options.immutableRootKeys??{})){
      const type=doc.share.get(root);if(!type)continue;
      for(const key of keys){
        const item=type._map.get(key);
        if(item&&item.id.client===client&&item.id.clock<deletion.clock+deletion.len&&item.id.clock+item.length>deletion.clock)throw Error('The collaboration protocol is not editable.');
      }
    }
  }
}

/**
 * Online Yjs concurrency is accepted by the host, in order. Guest history is never
 * loaded from storage or used to resynchronize a disconnected connection.
 */
export class AuthoritativeDocumentChannel {
  private currentDocument:Y.Doc|undefined;
  private stagingDocument:Y.Doc|undefined;
  private hostPeer:string|undefined;
  private hostEpoch:string|undefined;
  private nonce:string|undefined;
  private initialized=false;
  private opened=false;
  private permission:CollaborationPermission;
  private readonly permissions=new Map<string,CollaborationPermission>();
  private readonly leases=new Map<string,Lease>();
  private readonly retiredNonces=new Map<string,Set<string>>();
  private readonly presence=new Map<string,Uint8Array>();
  private localPresence:Uint8Array|undefined;
  private readonly pending=new Set<number>();
  private seq=0;
  private revision=0;
  private disposed=false;
  private ended=false;
  private recoveryReported=false;
  private error:string|undefined;
  private unsubscribeTransport:()=>void;
  private unsubscribeMessages:()=>void;
  private state:AuthorityState;
  private readonly listeners=new Set<()=>void>();
  private applyingProposal:{peerId:string;seq:number}|undefined;

  constructor(readonly transport:AuthorityTransport,private readonly options:AuthorityOptions){
    this.permission=transport.role==='host'?'edit':'view';
    this.state=freezeState({role:transport.role,writable:false,initialized:false,pending:0,revision:0,permission:this.permission,hostConnected:false,peers:[],ended:false});
    if(transport.role==='host'){
      if(!options.hostDocument)throw Error('The host document is required.');
      this.hostEpoch=randomToken();this.currentDocument=options.hostDocument;this.initialized=true;this.opened=true;
      this.currentDocument.on('update',this.documentUpdated);
      options.onDocument(this.currentDocument);
    }else if(options.hostDocument)throw Error('A participant cannot provide a host document.');
    this.unsubscribeMessages=transport.onMessage(this.receive);
    this.unsubscribeTransport=transport.subscribe(this.refresh);
    this.refresh();
  }

  get document():Y.Doc|undefined{return this.currentDocument;}
  getState=():AuthorityState=>this.state;
  subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
  private writable():boolean {
    return !this.disposed&&!this.ended&&!this.error&&this.opened&&this.initialized&&
      (this.transport.role==='host'||this.permission==='edit'&&this.connected());
  }
  private connected():boolean {
    const network=this.transport.getState();
    return !this.ended&&network.available&&!!this.hostPeer&&network.peers.includes(this.hostPeer);
  }
  private emit():void {
    if(this.disposed)return;
    const network=this.transport.getState();
    const peers=this.transport.role==='host'?network.peers.map(peerId=>({peerId,permission:this.permissions.get(peerId)??'view' as const})):network.peers.map(peerId=>({peerId,permission:'edit' as const}));
    const next=freezeState({role:this.transport.role,writable:this.writable(),initialized:this.initialized,pending:this.pending.size,revision:this.revision,permission:this.permission,hostConnected:this.transport.role==='host'||this.connected(),peers,hostEpoch:this.hostEpoch,ended:this.ended,...(this.error||network.error?{error:this.error??network.error}:{})});
    if(JSON.stringify(next)===JSON.stringify(this.state))return;
    this.state=next;this.options.onState?.(next);for(const listener of this.listeners)listener();
  }
  private packet(kind:Message,write?:(encoder:encoding.Encoder)=>void):Uint8Array {
    const encoder=encoding.createEncoder();encoding.writeVarUint(encoder,VERSION);encoding.writeVarUint(encoder,kind);write?.(encoder);return encoding.toUint8Array(encoder);
  }
  private envelope(encoder:encoding.Encoder,nonce:string):void {
    encoding.writeVarString(encoder,this.hostEpoch!);encoding.writeVarString(encoder,nonce);
  }
  private send(peerId:string,kind:Message,write?:(encoder:encoding.Encoder)=>void):boolean {
    try{return this.transport.send(peerId,this.packet(kind,write));}catch{return false;}
  }
  private sendForLease(peerId:string,kind:Message,write?:(encoder:encoding.Encoder)=>void):boolean {
    const lease=this.leases.get(peerId);if(!lease)return false;
    return this.send(peerId,kind,encoder=>{this.envelope(encoder,lease.nonce);write?.(encoder);});
  }
  private reportRecovery(reason:string):void {
    if(!this.currentDocument||this.recoveryReported)return;
    this.recoveryReported=true;this.options.onRecovery?.(this.currentDocument,reason);
  }
  private freezeGuest(reason:string):void {
    if(this.pending.size)this.reportRecovery(reason);
    this.opened=false;this.pending.clear();this.seq=0;this.nonce=undefined;
    this.stagingDocument?.destroy();this.stagingDocument=undefined;
    for(const peerId of this.presence.keys())this.options.onPresence?.(peerId,null);
    this.presence.clear();this.localPresence=undefined;
  }
  private beginHandshake():void {
    if(!this.hostPeer||!this.connected()||this.nonce||this.disposed||this.ended)return;
    this.nonce=randomToken();this.recoveryReported=false;
    if(!this.send(this.hostPeer,Message.Hello,encoder=>encoding.writeVarString(encoder,this.nonce!))){this.freezeGuest('connection-lost');}
  }
  refresh=():void=>{
    if(this.disposed)return;
    const network=this.transport.getState();
    if(this.transport.role==='host'){
      const online=new Set(network.available?network.peers:[]);
      for(const peerId of this.leases.keys())if(!online.has(peerId))this.removePeer(peerId);
    }else{
      if(network.ended){this.ended=true;this.freezeGuest('session-ended');}
      const peer=network.available&&!this.ended?network.peers[0]:undefined;
      if(!peer||peer!==this.hostPeer){
        this.freezeGuest('connection-lost');this.hostPeer=peer;
      }
      if(peer)this.beginHandshake();
    }
    this.emit();
  };
  private removePeer(peerId:string):void {
    this.retireLease(peerId);this.removePresence(peerId);
  }
  private retireLease(peerId:string):void {
    const lease=this.leases.get(peerId);if(!lease)return;
    const retired=this.retiredNonces.get(peerId)??new Set<string>();retired.add(lease.nonce);this.retiredNonces.set(peerId,retired);
    this.leases.delete(peerId);
  }
  private removePresence(peerId:string):void {
    if(this.presence.delete(peerId))this.options.onPresence?.(peerId,null);
    for(const [target,lease] of this.leases)if(target!==peerId&&lease.ready)this.sendForLease(target,Message.PeerLeft,encoder=>encoding.writeVarString(encoder,peerId));
  }

  /** Editing permission is enforced on the host before any proposal touches the main document. */
  setPeerPermission(peerId:string,permission:CollaborationPermission):void {
    if(this.transport.role!=='host')throw Error('Only the host can change editing permission.');
    if(permission!=='view'&&permission!=='edit')throw Error('Invalid collaboration permission.');
    if(this.disposed||this.ended)return;
    if((this.permissions.get(peerId)??'view')===permission)return;
    this.permissions.set(peerId,permission);
    const lease=this.leases.get(peerId);
    if(lease){this.sendForLease(peerId,Message.Reset,encoder=>encoding.writeVarString(encoder,'permission-changed'));this.retireLease(peerId);this.removePresence(peerId);}
    this.emit();
  }

  private readonly documentUpdated=(update:Uint8Array,origin:unknown):void=>{
    if(this.disposed||origin===remoteOrigin)return;
    if(this.transport.role==='host'){
      this.revision++;
      const proposal=this.applyingProposal;
      for(const [peerId,lease] of this.leases)if(lease.ready)this.sendForLease(peerId,Message.Commit,encoder=>{
        encoding.writeVarUint(encoder,this.revision);encoding.writeVarString(encoder,proposal?.peerId??'');encoding.writeVarUint(encoder,proposal?.seq??0);encoding.writeVarUint8Array(encoder,update);
      });
      this.emit();return;
    }
    if(!this.writable()){
      // A missed UI guard must still never turn a readonly/offline change into a proposal.
      this.reportRecovery('editing-disabled');this.emit();return;
    }
    const seq=++this.seq;this.pending.add(seq);
    const sent=this.send(this.hostPeer!,Message.Proposal,encoder=>{
      this.envelope(encoder,this.nonce!);encoding.writeVarUint(encoder,seq);encoding.writeVarUint8Array(encoder,update);
    });
    if(!sent)this.freezeGuest('connection-lost');
    this.emit();
  };
  private validGuestEnvelope(peerId:string,decoder:decoding.Decoder):Lease|undefined {
    const epoch=decoding.readVarString(decoder),nonce=decoding.readVarString(decoder),lease=this.leases.get(peerId);
    if(epoch!==this.hostEpoch||nonce!==lease?.nonce||!lease.ready)return;
    const network=this.transport.getState();if(!network.available||!network.peers.includes(peerId))return;
    return lease;
  }
  private validHostEnvelope(peerId:string,decoder:decoding.Decoder):boolean {
    const epoch=decoding.readVarString(decoder),nonce=decoding.readVarString(decoder);
    return this.connected()&&peerId===this.hostPeer&&nonce===this.nonce&&epoch===this.hostEpoch;
  }
  private receive=(peerId:string,bytes:Uint8Array):void=>{
    if(this.disposed||this.ended)return;
    try{
      if(bytes.byteLength>MAX_AUTHORITY_UPDATE_BYTES+1024){
        if(this.transport.role==='host')this.rejectGuest(peerId,'update-too-large');
        else throw Error('The host collaboration message is too large.');
        return;
      }
      const decoder=decoding.createDecoder(bytes);
      if(decoding.readVarUint(decoder)!==VERSION)return;
      const kind=decoding.readVarUint(decoder);
      if(this.transport.role==='host')this.receiveGuest(peerId,kind,decoder);
      else this.receiveHost(peerId,kind,decoder);
    }catch{
      // Malformed or stale peer traffic is never treated as document state.
      if(this.transport.role==='guest'&&peerId===this.hostPeer){this.error='Invalid host collaboration message.';this.freezeGuest('invalid-host-message');this.emit();}
      else if(this.transport.role==='host')this.rejectGuest(peerId,'invalid-collaboration-message');
    }
  };
  private rejectGuest(peerId:string,reason:string):void {
    if(!this.leases.has(peerId))return;
    this.sendForLease(peerId,Message.Reset,encoder=>encoding.writeVarString(encoder,reason));this.retireLease(peerId);this.removePresence(peerId);this.emit();
  }
  private receiveGuest(peerId:string,kind:Message,decoder:decoding.Decoder):void {
    const network=this.transport.getState();if(!network.available||!network.peers.includes(peerId))return;
    if(kind===Message.Hello){
      const nonce=decoding.readVarString(decoder);if(!/^[0-9a-f]{32}$/.test(nonce))return;
      if(this.retiredNonces.get(peerId)?.has(nonce))return;
      const previous=this.leases.get(peerId);if(previous?.nonce===nonce&&previous.ready)return;
      const permission=this.permissions.get(peerId)??'view';this.permissions.set(peerId,permission);
      if(previous){if(previous.nonce!==nonce)this.retireLease(peerId);this.removePresence(peerId);}
      this.leases.set(peerId,{nonce,ready:false,seq:0,baseline:Y.encodeStateVector(this.currentDocument!),permission});
      this.sendForLease(peerId,Message.Snapshot,encoder=>{encoding.writeVarUint(encoder,permission==='edit'?1:0);encoding.writeVarUint(encoder,this.revision);encoding.writeVarUint8Array(encoder,Y.encodeStateAsUpdate(this.currentDocument!));});
      this.emit();return;
    }
    if(kind===Message.Ready){
      const epoch=decoding.readVarString(decoder),nonce=decoding.readVarString(decoder),lease=this.leases.get(peerId);
      if(epoch!==this.hostEpoch||nonce!==lease?.nonce||lease.ready)return;
      lease.ready=true;
      this.sendForLease(peerId,Message.Open,encoder=>{encoding.writeVarUint(encoder,lease.permission==='edit'?1:0);encoding.writeVarUint(encoder,this.revision);encoding.writeVarUint8Array(encoder,Y.encodeStateAsUpdate(this.currentDocument!,lease.baseline));});
      for(const [source,update] of this.presence)if(source!==peerId)this.sendForLease(peerId,Message.RelayedPresence,encoder=>{encoding.writeVarString(encoder,source);encoding.writeVarUint8Array(encoder,update);});
      if(this.localPresence)this.sendForLease(peerId,Message.RelayedPresence,encoder=>{encoding.writeVarString(encoder,this.transport.peerId);encoding.writeVarUint8Array(encoder,this.localPresence!);});
      this.emit();return;
    }
    const lease=this.validGuestEnvelope(peerId,decoder);if(!lease)return;
    if(kind===Message.Proposal){
      const seq=decoding.readVarUint(decoder),update=decoding.readVarUint8Array(decoder);
      if((this.permissions.get(peerId)??'view')!=='edit'||lease.permission!=='edit'){
        this.rejectGuest(peerId,'editing-not-allowed');return;
      }
      if(seq===lease.seq){this.sendForLease(peerId,Message.Ack,encoder=>{encoding.writeVarUint(encoder,seq);encoding.writeVarUint(encoder,this.revision);});return;}
      if(seq!==lease.seq+1){this.rejectGuest(peerId,'invalid-proposal-sequence');return;}
      preflightUpdate(this.currentDocument!,update,this.options);
      lease.seq=seq;this.applyingProposal={peerId,seq};
      try{Y.applyUpdate(this.currentDocument!,update,this);}finally{this.applyingProposal=undefined;}
      this.sendForLease(peerId,Message.Ack,encoder=>{encoding.writeVarUint(encoder,seq);encoding.writeVarUint(encoder,this.revision);});
    }else if(kind===Message.Presence){
      const update=decoding.readVarUint8Array(decoder);this.presence.set(peerId,update);this.options.onPresence?.(peerId,update);
      for(const [target,targetLease] of this.leases)if(target!==peerId&&targetLease.ready)this.sendForLease(target,Message.RelayedPresence,encoder=>{encoding.writeVarString(encoder,peerId);encoding.writeVarUint8Array(encoder,update);});
    }
    this.emit();
  }
  private receiveHost(peerId:string,kind:Message,decoder:decoding.Decoder):void {
    if(!this.connected()||peerId!==this.hostPeer)return;
    if(kind===Message.Snapshot){
      if(this.opened)return;
      const epoch=decoding.readVarString(decoder),nonce=decoding.readVarString(decoder);
      if(!/^[0-9a-f]{32}$/.test(epoch)||nonce!==this.nonce)return;
      this.hostEpoch=epoch;this.permission=decoding.readVarUint(decoder)===1?'edit':'view';this.revision=decoding.readVarUint(decoder);
      this.stagingDocument?.destroy();this.stagingDocument=new Y.Doc();
      Y.applyUpdate(this.stagingDocument,decoding.readVarUint8Array(decoder),remoteOrigin);
      if(!this.send(peerId,Message.Ready,encoder=>this.envelope(encoder,this.nonce!)))this.freezeGuest('connection-lost');
      this.emit();return;
    }
    if(!this.validHostEnvelope(peerId,decoder))return;
    if(kind===Message.Open){
      if(!this.stagingDocument||this.opened)return;
      this.permission=decoding.readVarUint(decoder)===1?'edit':'view';this.revision=decoding.readVarUint(decoder);
      Y.applyUpdate(this.stagingDocument,decoding.readVarUint8Array(decoder),remoteOrigin);
      const previous=this.currentDocument;previous?.off('update',this.documentUpdated);
      this.currentDocument=this.stagingDocument;this.stagingDocument=undefined;this.initialized=true;this.opened=true;this.pending.clear();this.seq=0;this.recoveryReported=false;this.error=undefined;
      // Editor attachment may normalize canonical content. Register only after
      // attachment, then submit that live initialization delta for editors.
      const before=Y.encodeStateVector(this.currentDocument);
      this.options.onDocument(this.currentDocument);this.currentDocument.on('update',this.documentUpdated);
      previous?.destroy();
      const normalization=Y.encodeStateAsUpdate(this.currentDocument,before);
      if(normalization.length>2&&this.writable())this.documentUpdated(normalization,this);
    }else if(kind===Message.Commit){
      if(!this.opened||!this.currentDocument)return;
      const revision=decoding.readVarUint(decoder),source=decoding.readVarString(decoder),seq=decoding.readVarUint(decoder),update=decoding.readVarUint8Array(decoder);
      if(revision<=this.revision)return;
      if(revision!==this.revision+1){this.freezeGuest('missing-host-commit');this.beginHandshake();this.emit();return;}
      Y.applyUpdate(this.currentDocument,update,remoteOrigin);this.revision=revision;
      if(source===this.transport.peerId)for(const pending of this.pending)if(pending<=seq)this.pending.delete(pending);
    }else if(kind===Message.Ack){
      const seq=decoding.readVarUint(decoder),revision=decoding.readVarUint(decoder);
      if(revision>this.revision){this.freezeGuest('missing-host-commit');this.beginHandshake();this.emit();return;}
      for(const pending of this.pending)if(pending<=seq)this.pending.delete(pending);
    }else if(kind===Message.Reset){
      const reason=decoding.readVarString(decoder);this.freezeGuest(reason);this.beginHandshake();
    }else if(kind===Message.RelayedPresence){
      const source=decoding.readVarString(decoder),update=decoding.readVarUint8Array(decoder);
      if(source===this.transport.peerId)return;
      this.presence.set(source,update);this.options.onPresence?.(source,update);
    }else if(kind===Message.PeerLeft){
      const source=decoding.readVarString(decoder);if(this.presence.delete(source))this.options.onPresence?.(source,null);
    }else if(kind===Message.Ended){this.ended=true;this.freezeGuest('session-ended');}
    this.emit();
  }
  /** Presence is ephemeral and may be sent by view-only guests. */
  sendPresence(update:Uint8Array):void {
    if(this.disposed||this.ended)return;
    this.localPresence=new Uint8Array(update);
    if(this.transport.role==='host'){
      for(const [target,lease] of this.leases)if(lease.ready)this.sendForLease(target,Message.RelayedPresence,encoder=>{encoding.writeVarString(encoder,this.transport.peerId);encoding.writeVarUint8Array(encoder,update);});
    }else if(this.opened&&this.connected())this.send(this.hostPeer!,Message.Presence,encoder=>{this.envelope(encoder,this.nonce!);encoding.writeVarUint8Array(encoder,update);});
  }
  destroy():void {
    if(this.disposed)return;
    if(this.transport.role==='host'){
      for(const [peerId,lease] of this.leases)if(lease.ready)this.sendForLease(peerId,Message.Ended);
    }else if(this.pending.size)this.reportRecovery('session-closed');
    this.disposed=true;this.unsubscribeMessages();this.unsubscribeTransport();
    this.currentDocument?.off('update',this.documentUpdated);this.stagingDocument?.destroy();
    if(this.transport.role==='guest')this.currentDocument?.destroy();
    this.listeners.clear();this.leases.clear();this.retiredNonces.clear();this.presence.clear();
  }
}

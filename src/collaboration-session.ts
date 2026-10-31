// SPDX-License-Identifier: GPL-3.0-or-later
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import {Awareness,applyAwarenessUpdate,encodeAwarenessUpdate,removeAwarenessStates} from 'y-protocols/awareness';
import {slateRangeToRelativeRange,relativeRangeToSlateRange,YjsEditor} from '@slate-yjs/core';
import type {Value} from 'platejs';
import type {PlateEditor} from 'platejs/react';
import {setMathIdNamespace} from './editor-model';
import {CollaborativeProseBinding} from './collaboration-prose';
import {CollaborativeMathStore,type MathCursorHandle} from './collaboration-math';
import {CollaborativeBibliography} from './collaboration-bibliography';
import {AuthoritativeDocumentChannel,type AuthorityState,type CollaborationPermission} from './collaboration-authority';
import {createHostedTransport,type HostedTransport,type HostedTransportOptions} from './collaboration-transport';
import type {CollaborationInvite} from './collaboration-invite';
import type {CollaborationState,CollaborationRemoteCursor,CollaborationPeer} from './collaboration-types';
import type {BibLibrary} from './bibtex';
import {citedReferenceKeys} from './references';
import {isBibliographyStyle,type BibliographyStyle} from './bibliography-style';

export interface CollaborationAdapter {
  editor:PlateEditor;
  data():{value:Value;libraries:readonly BibLibrary[];style:BibliographyStyle};
  snapshots():Map<string,string>;
  activeSnapshot?():[string,string]|undefined;
  applying(value:boolean):void;
  replace?():void;
  recover?(reason:string):void;
  reconcile(math:CollaborativeMathStore,cursors:ReadonlyMap<string,MathCursorHandle>,libraries:readonly BibLibrary[],style:BibliographyStyle,changedMath?:ReadonlySet<string>):void;
  state(value:CollaborationState):void;
}
export interface CollaborationSessionOptions {
  hostKey?:CryptoKey;
  transportFactory?:(invite:CollaborationInvite,options:HostedTransportOptions)=>Promise<HostedTransport>|HostedTransport;
}
interface DocumentBinding {
  doc:Y.Doc;awareness:Awareness;prose:CollaborativeProseBinding;math:CollaborativeMathStore;
  bibliography:CollaborativeBibliography;metadata:Y.Map<unknown>;unsubscribeMath:()=>void;
}
const presenceOrigin={presence:true};
const historyEvents=['stack-item-added','stack-item-popped','stack-cleared'] as const;
const colors=['#2563eb','#b45309','#15803d','#9333ea','#be123c','#0f766e'];
const waitingMessage='Wait for the shared document before connecting the editor.';

/** Only the host owns the canonical document. Guests always receive a fresh baseline. */
export class DocumentCollaborationSession {
  readonly origin={};
  transport:HostedTransport|undefined;
  authority:AuthoritativeDocumentChannel|undefined;
  private binding:DocumentBinding|undefined;
  private hostDocument:Y.Doc|undefined;
  private authorityState:AuthorityState|undefined;
  private role:'host'|'guest';
  private disposed=false;
  private started=false;
  private initializing=true;
  private applying=false;
  private reconciling=false;
  private reconcilePending=false;
  private bindingGeneration=0;
  private flushing=false;
  private cursors=new Map<string,MathCursorHandle>();
  private changedMath=new Set<string>();
  private peerClients=new Map<string,number>();
  private pendingPresence=new Map<string,Uint8Array>();
  private name='Collaborator';
  private failure:string|undefined;
  private lastPresence='';
  private recoveryAvailable=false;
  ready=false;

  constructor(readonly invite:CollaborationInvite,private adapter:CollaborationAdapter,private options:CollaborationSessionOptions={}){
    this.role=options.hostKey?'host':'guest';
  }
  private current():DocumentBinding {if(!this.binding)throw Error(waitingMessage);return this.binding;}
  get doc():Y.Doc{return this.current().doc;}
  get awareness():Awareness{return this.current().awareness;}
  get prose():CollaborativeProseBinding{return this.current().prose;}
  get math():CollaborativeMathStore{return this.current().math;}
  get bibliography():CollaborativeBibliography{return this.current().bibliography;}
  get metadata():Y.Map<unknown>{return this.current().metadata;}
  get writable():boolean{return !this.disposed&&!this.failure&&this.ready&&this.authorityState?.writable===true;}
  private setApplying(value:boolean):void {this.applying=value;this.adapter.applying(value);}
  private readonly historyChanged=()=>this.emit();
  private readonly beforeTransaction=(transaction:Y.Transaction)=>{
    if(!this.ready||transaction.origin===this.origin||this.initializing||this.disposed)return;
    this.setApplying(true);
    const active=this.adapter.activeSnapshot?.();
    for(const [id,snapshot] of active?[active]:this.adapter.activeSnapshot?[]:this.adapter.snapshots()){
      const cursor=this.math.captureCursor(id,snapshot);if(cursor&&!this.cursors.has(id))this.cursors.set(id,cursor);
    }
  };
  private readonly afterTransaction=(transaction:Y.Transaction)=>{
    if(this.initializing||this.disposed||transaction.origin===this.origin)return;this.scheduleReconcile();
  };
  private readonly awarenessUpdated=(changes:{added:number[];updated:number[];removed:number[]})=>{
    const binding=this.binding;if(!binding||this.disposed)return;
    if([...changes.added,...changes.updated,...changes.removed].includes(binding.doc.clientID))this.sendOwnPresence();
    this.emit();
  };

  async start(creator:boolean):Promise<void> {
    if(this.started||this.disposed)return;this.started=true;
    if(creator!==!!this.options.hostKey)throw Error('The host signing key is required to start collaboration.');
    this.role=creator?'host':'guest';
    try{
      const transport=await (this.options.transportFactory??createHostedTransport)(this.invite,{hostKey:this.options.hostKey});
      if(this.disposed){transport.destroy();return;}
      this.transport=transport;if(transport.role!==this.role)throw Error('The collaboration connection has an invalid role.');
      if(creator){
        const data=this.adapter.data(),snapshots=this.adapter.snapshots();
        this.hostDocument=new Y.Doc();this.attachDocument(this.hostDocument,false);
        this.doc.transact(()=>{
          for(const [id,snapshot] of snapshots)this.math.ensure(id,snapshot);
          this.prose.seed(data.value);this.bibliography.publish(data.libraries,citedReferenceKeys(data.value));
          this.metadata.set('bibliographyStyle',data.style);this.metadata.set('protocol',1);
        });
        this.initializing=false;this.reconcile();
      }
      this.authority=new AuthoritativeDocumentChannel(transport,{
        ...(this.hostDocument?{hostDocument:this.hostDocument}:{}),
        allowedRoots:['content','vulgar-math-v1','vulgar-bibliography-v1','vulgar-document-v1'],
        immutableRootKeys:{'vulgar-document-v1':['protocol']},
        onDocument:doc=>{
          if(this.disposed||this.binding?.doc===doc)return;
          try{this.attachDocument(doc,true);this.initializing=false;this.reconcile();}
          catch(error){this.failure=error instanceof Error?error.message:String(error);this.setApplying(false);this.emit();throw error;}
        },
        onState:state=>this.updateAuthorityState(state),
        onRecovery:(_doc,reason)=>this.captureRecovery(reason),
        onPresence:(peerId,update)=>this.receivePresence(peerId,update),
      });
      this.updateAuthorityState(this.authority.getState());this.setName(this.name);this.sendOwnPresence();this.emit();
    }catch(error){this.destroy();throw error;}
  }
  private attachDocument(doc:Y.Doc,replace:boolean):void {
    this.initializing=true;
    if(replace&&this.role==='guest'&&this.hasBufferedProse())this.captureRecovery('connection-reset');
    if(replace)this.adapter.replace?.();
    this.detachBinding();this.failure=undefined;this.lastPresence='';setMathIdNamespace(doc.guid);
    const awareness=new Awareness(doc);
    const prose=new CollaborativeProseBinding(this.adapter.editor,doc,this.origin,{
      canEdit:()=>this.initializing||this.applying||this.writable,
      beforeRemote:()=>this.setApplying(true),
      afterRemote:()=>{if(!this.initializing)this.scheduleReconcile();},
    });
    const math=new CollaborativeMathStore(doc,this.origin,prose.undoManager);
    const bibliography=new CollaborativeBibliography(doc,this.origin,prose.undoManager);
    const metadata=doc.getMap<unknown>('vulgar-document-v1');prose.undoManager.addToScope(metadata);
    const unsubscribeMath=math.subscribe(ids=>{for(const id of ids)this.changedMath.add(id);});
    this.binding={doc,awareness,prose,math,bibliography,metadata,unsubscribeMath};
    for(const event of historyEvents)prose.undoManager.on(event,this.historyChanged);
    doc.on('beforeTransaction',this.beforeTransaction);doc.on('afterTransaction',this.afterTransaction);
    awareness.on('update',this.awarenessUpdated);this.setName(this.name);
    const pending=this.pendingPresence;this.pendingPresence=new Map();
    for(const [peerId,update] of pending)this.receivePresence(peerId,update);
  }
  private detachBinding():void {
    this.bindingGeneration++;this.reconcilePending=false;this.ready=false;
    this.cursors.clear();this.changedMath.clear();this.peerClients.clear();
    const binding=this.binding;if(!binding)return;
    binding.doc.off('beforeTransaction',this.beforeTransaction);binding.doc.off('afterTransaction',this.afterTransaction);
    binding.awareness.off('update',this.awarenessUpdated);
    for(const event of historyEvents)binding.prose.undoManager.off(event,this.historyChanged);
    binding.unsubscribeMath();binding.bibliography.destroy();binding.math.destroy();binding.prose.destroy();
    binding.awareness.destroy();this.binding=undefined;
  }
  private updateAuthorityState(state:AuthorityState):void {
    if(this.disposed)return;
    const lostWrite=this.authorityState?.writable===true&&!state.writable;this.authorityState=state;
    // A final buffered online operation belongs only in recovery after loss.
    if(lostWrite&&this.role==='guest'&&this.binding&&!this.flushing){
      this.flushing=true;try{this.binding.prose.flush();}finally{this.flushing=false;}
    }
    this.emit();
  }
  private captureRecovery(reason:string):void {
    if(this.disposed||!this.binding)return;this.recoveryAvailable=true;this.adapter.recover?.(reason);this.emit();
  }
  private hasBufferedProse():boolean {
    return !!this.binding&&YjsEditor.isYjsEditor(this.adapter.editor)&&YjsEditor.localChanges(this.adapter.editor).length>0;
  }
  private peers():CollaborationPeer[] {
    const authority=this.authorityState,transport=this.transport;if(!authority||!transport)return [];
    const ids=new Set([...authority.peers.map(peer=>peer.peerId),...this.peerClients.keys()]);
    return [...ids].sort().map(peerId=>{
      const clientId=this.peerClients.get(peerId)??this.placeholderId(peerId),value=this.binding?.awareness.getStates().get(clientId)?.user;
      const rawName=value&&typeof value==='object'&&typeof value.name==='string'?value.name:'';
      const name=rawName.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,80)||'Collaborator';
      const color=value&&typeof value==='object'&&typeof value.color==='string'&&/^#[0-9a-f]{6}$/i.test(value.color)?value.color:colors[clientId%colors.length];
      const host=this.role==='guest'&&transport.getState().peers.includes(peerId);
      const permission=host?'edit':authority.peers.find(peer=>peer.peerId===peerId)?.permission;
      return {clientId,name,color,transportPeerId:peerId,...(host?{host:true}:{}),...(permission?{permission}:{} )};
    });
  }
  private placeholderId(peerId:string):number {
    let hash=2166136261;for(const character of peerId)hash=Math.imul(hash^character.charCodeAt(0),16777619);return 0x100000000+(hash>>>0);
  }
  getState():CollaborationState {
    const authority=this.authorityState,network=this.transport?.getState(),peers=this.peers();
    const status=this.failure||authority?.ended||network?.ended?'offline':
      this.role==='host'?(network?.available===false?'offline':peers.length?'online':this.ready?'waiting':'connecting'):
      authority?.hostConnected?(this.ready?'online':'connecting'):!this.ready&&!network?.error?'connecting':network?'offline':'connecting';
    return {active:true,ready:this.ready&&!this.failure,role:this.role,writable:this.writable,pending:authority?.pending??0,
      recoveryAvailable:this.recoveryAvailable,permission:authority?.permission??(this.role==='host'?'edit':'view'),hostConnected:authority?.hostConnected??false,ended:authority?.ended??!!network?.ended,
      status,peers,invite:this.invite,name:this.name,...(this.failure||authority?.error?{error:this.failure??authority?.error}:{})};
  }
  private emit():void {if(!this.disposed)this.adapter.state(this.getState());}
  setName(name:string):void {
    this.name=name.trim().slice(0,80)||'Collaborator';
    if(this.binding)this.awareness.setLocalStateField('user',{name:this.name,color:colors[this.doc.clientID%colors.length]});this.emit();
  }
  private sendOwnPresence():void {if(this.binding&&!this.disposed)this.authority?.sendPresence(encodeAwarenessUpdate(this.awareness,[this.doc.clientID]));}
  private receivePresence(peerId:string,update:Uint8Array|null):void {
    if(this.disposed)return;
    if(!this.binding){if(update)this.pendingPresence.set(peerId,new Uint8Array(update));else this.pendingPresence.delete(peerId);return;}
    const awareness=this.awareness,previous=this.peerClients.get(peerId);
    if(!update){if(previous!==undefined)removeAwarenessStates(awareness,[previous],presenceOrigin);this.peerClients.delete(peerId);this.emit();return;}
    try{
      if(update.byteLength>256*1024)return;
      const decoder=decoding.createDecoder(update);if(decoding.readVarUint(decoder)!==1)return;
      const clientId=decoding.readVarUint(decoder);decoding.readVarUint(decoder);JSON.parse(decoding.readVarString(decoder));
      if(decoder.pos!==decoder.arr.length||clientId===this.doc.clientID||!Number.isSafeInteger(clientId))return;
      if([...this.peerClients].some(([owner,id])=>owner!==peerId&&id===clientId))return;
      if(previous!==undefined&&previous!==clientId)removeAwarenessStates(awareness,[previous],presenceOrigin);
      this.peerClients.set(peerId,clientId);applyAwarenessUpdate(awareness,update,presenceOrigin);this.emit();
    }catch{/* Malformed ephemeral presence never changes the document. */}
  }
  publishPresence():void {
    if(!this.ready||this.disposed||this.failure||!this.binding)return;
    let cursor:unknown=null;const active=this.adapter.activeSnapshot?.();
    if(active){
      const handle=this.math.captureCursor(...active);
      if(handle)cursor={kind:'math',formulaId:active[0],region:handle.region,offset:Y.relativePositionToJSON(handle.offset),anchor:Y.relativePositionToJSON(handle.anchor)};
    }else if(this.adapter.editor.selection){
      try{const range=slateRangeToRelativeRange(this.prose.sharedRoot,this.adapter.editor,this.adapter.editor.selection);cursor={kind:'prose',anchor:Y.relativePositionToJSON(range.anchor),focus:Y.relativePositionToJSON(range.focus)};}catch{/* Deleted selection. */}
    }
    const key=JSON.stringify(cursor);if(key===this.lastPresence)return;this.lastPresence=key;this.awareness.setLocalStateField('cursor',cursor);
  }
  remoteCursors():CollaborationRemoteCursor[]{
    if(!this.ready||!this.binding)return [];
    return this.peers().flatMap<CollaborationRemoteCursor>(peer=>{
      const cursor=this.awareness.getStates().get(peer.clientId)?.cursor;if(!cursor||typeof cursor!=='object')return [];
      try{
        if(cursor.kind==='prose'){
          const range=relativeRangeToSlateRange(this.prose.sharedRoot,this.adapter.editor,{anchor:Y.createRelativePositionFromJSON(cursor.anchor),focus:Y.createRelativePositionFromJSON(cursor.focus)});return range?[{...peer,range}]:[];
        }
        if(cursor.kind==='math'&&typeof cursor.formulaId==='string'&&typeof cursor.region==='string'){
          const formula=this.math.sharedRoot.get(cursor.formulaId),regions=formula?.get('regions');if(!(regions instanceof Y.Map))return [];
          const target=regions.get(cursor.region);if(!(target instanceof Y.Array))return [];
          const offset=Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(cursor.offset),this.doc),anchor=Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(cursor.anchor),this.doc);
          if(offset?.type!==target||anchor?.type!==target)return [];
          return [{...peer,range:null,math:{formulaId:cursor.formulaId,region:cursor.region,offset:offset.index,anchor:anchor.index}}];
        }
      }catch{/* Ignore malformed or obsolete ephemeral presence. */}
      return [];
    });
  }
  private scheduleReconcile():void {
    if(this.reconcilePending||this.disposed||!this.binding)return;this.reconcilePending=true;const generation=this.bindingGeneration;
    queueMicrotask(()=>{
      if(this.disposed||generation!==this.bindingGeneration)return;this.reconcilePending=false;
      try{this.reconcile();}catch(error){this.setApplying(false);this.failure=error instanceof Error?error.message:String(error);this.emit();}
    });
  }
  private reconcile():void {
    if(!this.binding||this.reconciling||this.disposed)return;
    const protocol=this.metadata.get('protocol');if(protocol===undefined){this.setApplying(false);this.emit();return;}
    if(protocol!==1)throw Error('This collaboration room uses an unsupported document version.');
    this.reconciling=true;this.setApplying(true);
    try{
      const first=!this.ready;if(first){this.prose.connect();this.ready=true;this.prose.undoManager.clear();}
      const style=this.metadata.get('bibliographyStyle');
      this.adapter.reconcile(this.math,this.cursors,this.bibliography.read(),isBibliographyStyle(style)?style:'simple',first?undefined:this.changedMath);
      this.changedMath.clear();this.cursors.clear();
    }finally{this.reconciling=false;this.setApplying(false);}
    this.publishPresence();this.emit();
  }
  publishMath(id:string,before:string,after:string):void {
    if(!this.writable)return;this.doc.transact(()=>this.math.publish(id,before,after),this.origin);this.cursors.delete(id);this.scheduleReconcile();
  }
  ensureMath(id:string,snapshot:string):void {if(this.writable)this.doc.transact(()=>this.math.ensure(id,snapshot),this.origin);}
  refreshMath(ids:Iterable<string>):void {if(!this.binding)return;for(const id of ids)this.changedMath.add(id);this.scheduleReconcile();}
  flush():void {if(this.writable&&this.binding)this.prose.flush();}
  publishSettings():void {
    if(!this.writable)return;const data=this.adapter.data();
    this.doc.transact(()=>{if(this.metadata.get('bibliographyStyle')!==data.style)this.metadata.set('bibliographyStyle',data.style);this.bibliography.publish(data.libraries,citedReferenceKeys(data.value));},this.origin);
  }
  undo():void {if(this.writable){this.prose.flush();this.prose.undo();}}
  redo():void {if(this.writable){this.prose.flush();this.prose.redo();}}
  setPeerPermission(peerId:string,permission:CollaborationPermission):void {this.authority?.setPeerPermission(peerId,permission);}
  refresh():void {this.authority?.refresh();}
  destroy():void {
    if(this.disposed)return;this.flush();if(this.role==='guest'&&((this.authorityState?.pending??0)>0||this.hasBufferedProse()))this.captureRecovery('session-closed');
    this.disposed=true;this.detachBinding();this.authority?.destroy();this.transport?.destroy();this.hostDocument?.destroy();
    this.pendingPresence.clear();setMathIdNamespace();this.setApplying(false);
  }
}

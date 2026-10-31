// SPDX-License-Identifier: GPL-3.0-or-later
import {slateNodesToInsertDelta,withYHistory,withYjs,YHistoryEditor,YjsEditor} from '@slate-yjs/core';
import {NodeApi,type Value} from 'platejs';
import type {PlateEditor} from 'platejs/react';
import type {Editor as SlateEditor,Operation} from 'slate';
import * as Y from 'yjs';

export interface CollaborativeProseHooks {
  beforeRemote?:()=>void;
  afterRemote?:()=>void;
  /** Block every local transform while a guest is paused or view-only. */
  canEdit?:()=>boolean;
}

type NativeMathFields={snapshot:string;texExpression?:unknown};
const isMath=(node:Record<string,unknown>)=>node.type==='equation'||node.type==='inline_equation';
const isNativeMath=(node:Record<string,unknown>)=>isMath(node)&&typeof node.snapshot==='string';
const derivedKeys=new Set(['snapshot','texExpression']);

/** Native math trees live in their own CRDT, rather than atomic Slate attributes. */
export function collaborationProseValue(value:Value):Value {
  const clone=(node:Record<string,unknown>):Record<string,unknown>=>{
    const copy={...node};
    if(isNativeMath(node))for(const key of derivedKeys)delete copy[key];
    if(Array.isArray(node.children))copy.children=node.children.map(child=>clone(child as Record<string,unknown>));
    return copy;
  };
  return value.map(node=>clone(node)) as Value;
}

/** Bind Slate operations to Yjs without replacing document or formula snapshots. */
export class CollaborativeProseBinding {
  readonly sharedRoot:Y.XmlText;
  readonly undoManager:Y.UndoManager;
  private readonly bound:YHistoryEditor;
  private readonly originalProperties=new Map<string,PropertyDescriptor|undefined>();
  private readonly originalTransforms:Record<string,unknown>;
  private readonly originalApi:Record<string,unknown>;
  private readonly originalWithoutSaving:(fn:()=>void)=>void;
  private readonly originalHistory:PlateEditor['history'];
  private readonly nativeFields=new Map<string,NativeMathFields>();
  private connected=false;
  private destroyed=false;
  private seeded=false;

  constructor(readonly editor:PlateEditor,readonly doc:Y.Doc,origin:unknown,private readonly hooks:CollaborativeProseHooks={}) {
    if(YjsEditor.isYjsEditor(editor)&&YjsEditor.connected(editor))throw Error('This editor is already connected to a shared document.');
    this.sharedRoot=doc.get('content',Y.XmlText);
    const methods=['apply','onChange','undo','redo','withoutSaving','sharedRoot','localOrigin','positionStorageOrigin','applyRemoteEvents','storeLocalChange','flushLocalChanges','isLocalOrigin','connect','disconnect','undoManager','withoutSavingOrigin'];
    for(const key of methods)this.originalProperties.set(key,Object.getOwnPropertyDescriptor(editor,key));
    this.originalTransforms={apply:editor.tf.apply,undo:editor.tf.undo,redo:editor.tf.redo,withoutSaving:editor.tf.withoutSaving};
    this.originalApi={onChange:editor.api.onChange};
    this.originalWithoutSaving=editor.tf.withoutSaving;
    this.originalHistory=editor.history;
    this.rememberNativeFields(editor.children);

    // The existing Slate history must neither record local collaborative edits
    // nor remote operations. Y.UndoManager owns the local collaborative history.
    // Plate retains these Slate-compatible legacy methods at runtime while its
    // public type deliberately exposes the modern tf/api facade instead.
    const legacy=editor as unknown as SlateEditor,originalApply=legacy.apply;
    legacy.apply=(operation:Operation)=>this.originalWithoutSaving(()=>originalApply(operation));
    this.bound=withYHistory(withYjs(legacy,this.sharedRoot,{autoConnect:false,localOrigin:origin}));
    this.undoManager=this.bound.undoManager;
    const storeLocalChange=this.bound.storeLocalChange;
    this.bound.storeLocalChange=operation=>{
      const sharedOperation=this.sharedOperation(operation);
      if(sharedOperation)storeLocalChange(sharedOperation);
    };
    const applyRemoteEvents=this.bound.applyRemoteEvents;
    this.bound.applyRemoteEvents=(events,transactionOrigin)=>{
      try{this.hooks.beforeRemote?.();applyRemoteEvents(events,transactionOrigin);}
      finally{this.hooks.afterRemote?.();}
    };
    const apply=this.bound.apply;
    this.bound.apply=operation=>{
      if(operation.type!=='set_selection'&&this.connected&&YjsEditor.isLocal(this.bound)&&this.hooks.canEdit?.()===false)return;
      apply(operation);
    };
    const undo=this.bound.undo,redo=this.bound.redo;
    this.bound.undo=()=>{if(this.hooks.canEdit?.()!==false)undo();};
    this.bound.redo=()=>{if(this.hooks.canEdit?.()!==false)redo();};
    editor.tf.apply=this.bound.apply as typeof editor.tf.apply;
    editor.tf.undo=this.bound.undo as typeof editor.tf.undo;
    editor.tf.redo=this.bound.redo as typeof editor.tf.redo;
    editor.tf.withoutSaving=fn=>this.withoutSaving(fn);
    editor.withoutSaving=editor.tf.withoutSaving;
    editor.api.onChange=this.bound.onChange as typeof editor.api.onChange;
  }

  private rememberNativeFields(value:Value):void {
    for(const [node] of NodeApi.nodes({children:value} as PlateEditor)){
      if(isNativeMath(node)&&typeof node.id==='string')this.nativeFields.set(node.id,{snapshot:node.snapshot as string,...('texExpression' in node?{texExpression:node.texExpression}:{})});
    }
  }

  private sharedOperation(operation:Operation):Operation|null {
    if(operation.type==='set_selection')return null;
    if(operation.type==='insert_node'){
      this.rememberNativeFields([operation.node] as Value);
      return {...operation,node:collaborationProseValue([operation.node] as Value)[0]} as Operation;
    }
    if(operation.type!=='set_node')return operation;
    const node=NodeApi.get(this.editor,operation.path) as Record<string,unknown>;
    const next:Record<string,unknown>={...node,...operation.newProperties};
    // A native formula arrives as a skeleton with no TeX attribute. Plate's
    // equation normalizer may fill that local derived field before the math
    // store hydrates its snapshot; that must not become shared source either.
    const nativeSkeleton=isMath(node)&&(typeof node.texExpression!=='string'||typeof node.id==='string'&&this.nativeFields.has(node.id));
    if(!isNativeMath(node)&&!isNativeMath(next)&&!nativeSkeleton)return operation;
    if(typeof next.id==='string'&&isNativeMath(next))this.nativeFields.set(next.id,{snapshot:next.snapshot as string,...('texExpression' in next?{texExpression:next.texExpression}:{})});
    const strip=(properties:object)=>Object.fromEntries(Object.entries(properties).filter(([key])=>!derivedKeys.has(key)));
    const properties=strip(operation.properties),newProperties=strip(operation.newProperties);
    // Converting an editable source formula to native math transfers authority
    // to the math store; remove its previous atomic source from the prose CRDT.
    if(!isNativeMath(node)&&isNativeMath(next)&&'texExpression' in node)properties.texExpression=node.texExpression;
    return Object.keys(properties).length||Object.keys(newProperties).length?{...operation,properties,newProperties} as Operation:null;
  }

  /** Only the creator calls seed; joiners wait for the creator's shared state. */
  seed(value:Value):void {
    this.assertAlive();
    if(this.connected||this.seeded||this.sharedRoot.length>0)throw Error('The shared document is already initialized.');
    this.seeded=true;this.rememberNativeFields(value);
    this.doc.transact(()=>this.sharedRoot.applyDelta(slateNodesToInsertDelta(collaborationProseValue(value))),this);
  }

  connect():void {
    this.assertAlive();if(this.connected)return;
    if(!this.sharedRoot.length)throw Error('Wait for the shared document before connecting the editor.');
    this.originalHistory.undos=[];this.originalHistory.redos=[];
    try{
      this.hooks.beforeRemote?.();
      // connect replaces the entire Slate tree. A caret next to a newly
      // inserted void can point at a leaf omitted by Yjs normalization; clear
      // it before replacement so toolbar selectors never read a stale path.
      this.editor.tf.deselect();
      YjsEditor.connect(this.bound);this.connected=true;
      // Connecting replaces Slate children from the shared root. Retain the
      // creator's local derived fields until the math CRDT hydrates its nodes.
      this.withoutSaving(()=>{
        for(const [node,path] of NodeApi.nodes(this.editor)){
          if(!isMath(node)||typeof node.id!=='string')continue;
          const fields=this.nativeFields.get(node.id);
          if(fields)this.editor.tf.setNodes(fields,{at:path});
        }
      });
      this.flush();this.undoManager.clear();
    }catch(error){
      if(YjsEditor.connected(this.bound))YjsEditor.disconnect(this.bound);
      this.connected=false;throw error;
    }finally{this.hooks.afterRemote?.();}
  }

  flush():void {
    if(!this.destroyed&&this.connected)YjsEditor.flushLocalChanges(this.bound);
  }

  withoutSaving<T>(fn:()=>T):T {
    this.assertAlive();
    let value!:T,error:unknown,failed=false;
    // slate-yjs restores its origin after the callback returns; catch here so a
    // failed local transform cannot leave future edits with the no-undo origin.
    YHistoryEditor.withoutSaving(this.bound,()=>{
      try{this.originalWithoutSaving(()=>{value=fn();});}catch(caught){error=caught;failed=true;}
    });
    if(failed)throw error;return value;
  }

  undo():void {this.assertAlive();this.bound.undo();}
  redo():void {this.assertAlive();this.bound.redo();}

  destroy():void {
    if(this.destroyed)return;
    try{if(YjsEditor.connected(this.bound))YjsEditor.disconnect(this.bound);}
    finally{
      this.connected=false;this.destroyed=true;this.undoManager.destroy();
      const editor=this.editor as unknown as Record<string,unknown>;
      for(const [key,descriptor] of this.originalProperties){if(descriptor)Object.defineProperty(editor,key,descriptor);else delete editor[key];}
      Object.assign(this.editor.tf,this.originalTransforms);Object.assign(this.editor.api,this.originalApi);
      this.editor.history=this.originalHistory;this.originalHistory.undos=[];this.originalHistory.redos=[];
    }
  }

  private assertAlive():void {if(this.destroyed)throw Error('The collaborative editor binding has been destroyed.');}
}

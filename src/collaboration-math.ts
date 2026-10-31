import * as Y from 'yjs';
import {EditorModel,type Cursor,type MathItem,type MathNode,type Region,type ScriptSlot} from './editor-model';

type SequenceItem=string|{nodeId:string};
interface NodeShape {id:string;type:string;regions:string[];atom?:boolean;operatorLayout?:boolean;rows?:number;columns?:number;texOptions?:string}
interface Snapshot {root:Region;cursor:Cursor;pendingFont?:string}
interface FlatSnapshot {snapshot:Snapshot;regions:Map<string,Region>;nodes:Map<string,NodeShape>}
interface RegionBaseline {
  target:Y.Array<SequenceItem>;
  values:SequenceItem[];
  boundaries:Y.RelativePosition[];
  items:{start:Y.RelativePosition;end:Y.RelativePosition}[];
}
interface FormulaBaseline {regions:Map<string,RegionBaseline>}
interface SequencePatch {target:Y.Array<SequenceItem>;deletions:number[];boundary:Y.RelativePosition;inserted:SequenceItem[]}
type FormulaMap=Y.Map<unknown>;
export interface MathCursorHandle {
  readonly region:string;
  readonly offset:Y.RelativePosition;
  readonly anchor:Y.RelativePosition;
  readonly fallback:Cursor;
}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const sequence=(region:Region):SequenceItem[]=>region.items.map(item=>typeof item==='string'?item:{nodeId:item.id});
const contentKey=(value:FlatSnapshot)=>JSON.stringify(value.snapshot.root,(key,value)=>key==='label'?undefined:
  value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
function flat(snapshot:string):FlatSnapshot {
  const model=new EditorModel();model.restore(snapshot);
  const regions=new Map<string,Region>(),nodes=new Map<string,NodeShape>();
  const visit=(region:Region)=>{
    regions.set(region.id,region);
    for(const item of region.items)if(typeof item!=='string'){
      const {regions:children,...attributes}=item;
      nodes.set(item.id,{...attributes,regions:children.map(child=>child.id)});
      children.forEach(visit);
    }
  };
  visit(model.root);
  return {snapshot:{root:model.root,cursor:model.cursor,...(model.pendingFont?{pendingFont:model.pendingFont}:{})},regions,nodes};
}
function mapOffset(before:readonly SequenceItem[],after:readonly SequenceItem[],offset:number):number {
  let prefix=0,suffix=0;
  while(prefix<before.length&&prefix<after.length&&same(before[prefix],after[prefix]))prefix++;
  while(suffix<before.length-prefix&&suffix<after.length-prefix&&same(before[before.length-1-suffix],after[after.length-1-suffix]))suffix++;
  if(offset<=prefix)return offset;
  if(offset>=before.length-suffix)return Math.max(prefix,Math.min(after.length,offset+after.length-before.length));
  return Math.min(after.length-suffix,prefix);
}

/** Formula arguments are CRDT sequences; exported snapshots remain normal files. */
export class CollaborativeMathStore {
  readonly sharedRoot:Y.Map<FormulaMap>;
  readonly undoManager:Y.UndoManager;
  private readonly ownsUndoManager:boolean;
  private readonly initializeOrigin={};
  private readonly baselines=new Map<string,Map<string,FormulaBaseline>>();
  private readonly listeners=new Set<(ids:readonly string[],local:boolean)=>void>();
  private readonly observe=(events:Y.YEvent<Y.AbstractType<any>>[],transaction:Y.Transaction)=>{
    const ids=new Set<string>();
    for(const event of events){
      if(event.path.length&&typeof event.path[0]==='string')ids.add(event.path[0]);
      else if(event.target===this.sharedRoot&&event instanceof Y.YMapEvent)for(const id of event.keysChanged)ids.add(id);
    }
    // The first received state is a valid starting view even if no user cursor
    // has been placed yet. Later remote states never overwrite a pending IME
    // baseline: only an explicit read marks them as a newly visible view.
    for(const id of ids)if(!this.baselines.has(id)&&this.sharedRoot.has(id)){
      try{this.read(id);}catch{/* The host reports invalid incoming content. */}
    }
    if(ids.size)for(const listener of this.listeners)listener([...ids],transaction.local);
  };
  constructor(readonly doc:Y.Doc,readonly origin:unknown,existingUndoManager?:Y.UndoManager){
    this.sharedRoot=doc.getMap<FormulaMap>('vulgar-math-v1');
    this.ownsUndoManager=!existingUndoManager;
    this.undoManager=existingUndoManager??new Y.UndoManager(this.sharedRoot,{trackedOrigins:new Set([origin])});
    if(existingUndoManager){existingUndoManager.addToScope(this.sharedRoot);existingUndoManager.addTrackedOrigin(origin);}
    this.sharedRoot.observeDeep(this.observe);
  }
  subscribe(listener:(ids:readonly string[],local:boolean)=>void):()=>void {
    this.listeners.add(listener);return ()=>this.listeners.delete(listener);
  }
  ensure(id:string,snapshot:string):void {
    if(this.sharedRoot.has(id)){this.remember(id,flat(snapshot));return;}
    const before=flat(snapshot);
    this.doc.transact(()=>{
      if(this.sharedRoot.has(id))return;
      const formula=new Y.Map<unknown>();
      formula.set('rootId',before.snapshot.root.id);
      formula.set('regions',new Y.Map<Y.Array<SequenceItem>>());
      formula.set('regionProps',new Y.Map<{slot?:ScriptSlot}>());
      formula.set('nodes',new Y.Map<NodeShape>());
      this.sharedRoot.set(id,formula);
      this.writeNew(formula,before);
    },this.initializeOrigin);
    this.remember(id,before);
  }
  private parts(formula:FormulaMap){
    const regions=formula.get('regions'),props=formula.get('regionProps'),nodes=formula.get('nodes');
    if(!(regions instanceof Y.Map)||!(props instanceof Y.Map)||!(nodes instanceof Y.Map))throw Error('Invalid shared formula.');
    return {regions:regions as Y.Map<Y.Array<SequenceItem>>,props:props as Y.Map<{slot?:ScriptSlot}>,nodes:nodes as Y.Map<NodeShape>};
  }
  private writeNew(formula:FormulaMap,value:FlatSnapshot):void {
    const {regions,props,nodes}=this.parts(formula);
    for(const [id,region] of value.regions)if(!regions.has(id)){
      const content=new Y.Array<SequenceItem>();content.insert(0,sequence(region));regions.set(id,content);
      props.set(id,region.slot?{slot:region.slot}:{});
    }
    for(const [id,node] of value.nodes)if(!nodes.has(id))nodes.set(id,node);
  }
  private remember(id:string,value:FlatSnapshot,refresh=false):void {
    const formula=this.sharedRoot.get(id);if(!formula)return;
    const key=contentKey(value),known=this.baselines.get(id);
    if(!refresh&&known?.has(key))return;
    const {regions,nodes}=this.parts(formula);
    if(formula.get('rootId')!==value.snapshot.root.id)return;
    for(const [nodeId,node] of value.nodes)if(!same(nodes.get(nodeId),node))return;
    for(const [regionId,region] of value.regions){
      const target=regions.get(regionId);if(!(target instanceof Y.Array)||!same(target.toArray(),sequence(region)))return;
    }
    const baseline:FormulaBaseline={regions:new Map()};
    for(const [regionId,region] of value.regions){
      const target=regions.get(regionId)!,values=sequence(region);
      baseline.regions.set(regionId,{target,values,
        boundaries:Array.from({length:values.length+1},(_,index)=>Y.createRelativePositionFromTypeIndex(target,index,0)),
        items:values.map((_,index)=>({start:Y.createRelativePositionFromTypeIndex(target,index,0),end:Y.createRelativePositionFromTypeIndex(target,index+1,-1)}))});
    }
    const retained=known??new Map<string,FormulaBaseline>();
    if(retained.has(key))retained.delete(key);retained.set(key,baseline);
    while(retained.size>64)retained.delete(retained.keys().next().value!);
    this.baselines.set(id,retained);
  }
  private plan(target:Y.Array<SequenceItem>,old:SequenceItem[],next:SequenceItem[],baseline:RegionBaseline|undefined):SequencePatch {
    if(!baseline||baseline.target!==target||!same(baseline.values,old))throw Error('The formula edit has no valid shared baseline. Please finish composition after the shared formula has synchronized.');
    let prefix=0,suffix=0;
    while(prefix<old.length&&prefix<next.length&&same(old[prefix],next[prefix]))prefix++;
    while(suffix<old.length-prefix&&suffix<next.length-prefix&&same(old[old.length-1-suffix],next[next.length-1-suffix]))suffix++;
    const deletions:number[]=[];
    for(let index=prefix;index<old.length-suffix;index++){
      const original=baseline.items[index];
      // Start and end both identify this exact original item. Deleted original
      // characters resolve to an empty range even if a peer inserted the same
      // glyph beside the tombstone while native composition was in progress.
      const start=Y.createAbsolutePositionFromRelativePosition(original.start,this.doc,false),end=Y.createAbsolutePositionFromRelativePosition(original.end,this.doc,false);
      if(!start&&!end)continue;
      if(start?.type!==target||end?.type!==target)throw Error('The shared formula region is no longer available.');
      if(start.index===end.index)continue;
      if(end.index!==start.index+1||!same(target.get(start.index),old[index]))throw Error('The original shared formula item could not be identified safely.');
      deletions.push(start.index);
    }
    const boundary=baseline.boundaries[prefix],inserted=next.slice(prefix,next.length-suffix);
    if(inserted.length&&Y.createAbsolutePositionFromRelativePosition(boundary,this.doc,false)?.type!==target)throw Error('The shared formula insertion point is no longer available.');
    return {target,deletions:[...new Set(deletions)].sort((a,b)=>b-a),boundary,inserted};
  }
  publish(id:string,beforeSnapshot:string,afterSnapshot:string):void {
    const before=flat(beforeSnapshot),after=flat(afterSnapshot);
    if(!this.sharedRoot.has(id))this.ensure(id,beforeSnapshot);
    const formula=this.sharedRoot.get(id)!;
    const baseline=this.baselines.get(id)?.get(contentKey(before)),{regions}=this.parts(formula),patches:SequencePatch[]=[];
    if(contentKey(before)!==contentKey(after)&&!baseline)throw Error('The formula edit has no valid shared baseline. Please finish composition after the shared formula has synchronized.');
    // Yjs transactions do not roll back on exceptions, so identify every old
    // item and insertion anchor before adding any structures or changing data.
    for(const [regionId,region] of after.regions){
      const previous=before.regions.get(regionId);if(!previous)continue;
      const old=sequence(previous),next=sequence(region);if(same(old,next))continue;
      const target=regions.get(regionId);if(!(target instanceof Y.Array))throw Error('The shared formula region is no longer available.');
      patches.push(this.plan(target,old,next,baseline?.regions.get(regionId)));
    }
    this.doc.transact(()=>{
      this.writeNew(formula,after);
      const {props,nodes}=this.parts(formula);
      if(before.snapshot.root.id!==after.snapshot.root.id)formula.set('rootId',after.snapshot.root.id);
      for(const [regionId,region] of after.regions){
        const previous=before.regions.get(regionId);if(!previous)continue;
        if(previous.slot!==region.slot)props.set(regionId,region.slot?{slot:region.slot}:{});
      }
      for(const {target,deletions,boundary,inserted} of patches){
        for(const index of deletions)target.delete(index,1);
        if(inserted.length){
          const point=Y.createAbsolutePositionFromRelativePosition(boundary,this.doc,false)!;
          target.insert(point.index,inserted);
        }
      }
      // Type, arity and layout change together. Concurrent edits within the
      // referenced argument sequences remain independent of this descriptor.
      for(const [nodeId,node] of after.nodes)if(!same(before.nodes.get(nodeId),node)&&!same(nodes.get(nodeId),node))nodes.set(nodeId,node);
    },this.origin);
    if(contentKey(before)!==contentKey(after))this.remember(id,after,true);
  }
  captureCursor(id:string,snapshot:string):MathCursorHandle|undefined {
    const formula=this.sharedRoot.get(id);if(!formula)return;
    const value=flat(snapshot);this.remember(id,value);
    const {cursor}=value.snapshot,baseline=this.baselines.get(id)?.get(contentKey(value))?.regions.get(cursor.region);
    if(!baseline)return;
    return {region:cursor.region,offset:baseline.boundaries[cursor.offset],anchor:baseline.boundaries[cursor.anchor],fallback:{...cursor}};
  }
  read(id:string,localSnapshot?:string,handle?:MathCursorHandle):string|undefined {
    const formula=this.sharedRoot.get(id);if(!formula)return;
    const {regions,props,nodes}=this.parts(formula),rootId=formula.get('rootId');
    if(typeof rootId!=='string')throw Error('Invalid shared formula root.');
    const seen=new Set<string>(),allRegions=new Map<string,Region>();
    const region=(id:string,depth:number):Region=>{
      if(depth>200||seen.has(id))throw Error('Invalid shared formula structure.');seen.add(id);
      const content=regions.get(id);if(!(content instanceof Y.Array))throw Error('Missing shared formula region.');
      const r:Region={id,label:'',items:[],...(props.get(id)?.slot?{slot:props.get(id)!.slot}:{})};allRegions.set(id,r);
      r.items=content.toArray().map((item):MathItem=>{
        if(typeof item==='string')return item;
        if(!item||typeof item.nodeId!=='string'||seen.has(item.nodeId))throw Error('Invalid shared formula item.');
        seen.add(item.nodeId);const shape=nodes.get(item.nodeId);if(!shape||!Array.isArray(shape.regions))throw Error('Missing shared formula node.');
        return {...shape,regions:shape.regions.map(child=>region(child,depth+1))} as MathNode;
      });
      return r;
    };
    const root=region(rootId,0),local=localSnapshot?flat(localSnapshot):undefined;
    let cursor:Cursor={region:root.id,offset:root.items.length,anchor:root.items.length};
    if(handle&&allRegions.has(handle.region)){
      const target=regions.get(handle.region)!;
      const offset=Y.createAbsolutePositionFromRelativePosition(handle.offset,this.doc),anchor=Y.createAbsolutePositionFromRelativePosition(handle.anchor,this.doc);
      cursor={region:handle.region,offset:offset?.type===target?offset.index:Math.min(target.length,handle.fallback.offset),anchor:anchor?.type===target?anchor.index:Math.min(target.length,handle.fallback.anchor)};
    }else if(local&&allRegions.has(local.snapshot.cursor.region)){
      const previous=local.regions.get(local.snapshot.cursor.region)!,next=allRegions.get(previous.id)!;
      cursor={region:previous.id,offset:mapOffset(sequence(previous),sequence(next),local.snapshot.cursor.offset),anchor:mapOffset(sequence(previous),sequence(next),local.snapshot.cursor.anchor)};
    }
    const model=new EditorModel();model.restore(JSON.stringify({version:2,root,cursor,...(local?.snapshot.pendingFont?{pendingFont:local.snapshot.pendingFont}:{})}));
    const snapshot=model.snapshot();this.remember(id,flat(snapshot),true);return snapshot;
  }
  stopCapturing():void {this.undoManager.stopCapturing();}
  undo():boolean {return this.undoManager.undo()!==null;}
  redo():boolean {return this.undoManager.redo()!==null;}
  destroy():void {this.sharedRoot.unobserveDeep(this.observe);this.listeners.clear();this.baselines.clear();if(this.ownsUndoManager)this.undoManager.destroy();}
}

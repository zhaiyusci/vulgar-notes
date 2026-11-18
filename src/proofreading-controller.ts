// SPDX-License-Identifier: GPL-3.0-or-later
import {NodeApi,type Descendant,type TElement} from 'platejs';
import type {PlateEditor} from 'platejs/react';
import {Path,Point,Range as RangeApi,type Operation,type Range as SlateRange} from 'slate';
import {locale,t} from './i18n';
import {checkProofreading,ProofreadingServiceError,type ProofreadingIssue} from './proofreading-provider';
import {readProofreadingSettings,subscribeProofreadingSettings} from './proofreading-settings';
import {ProofreadingHighlights} from './proofreading-highlights';
import type {ProofreadingClient,ProofreadingRow,ProofreadingState} from './proofreading-client';
export type {ProofreadingRow,ProofreadingState} from './proofreading-client';

const proseTypes=new Set(['p','h1','h2','h3','h4','h5','h6','blockquote','callout','toggle','metadata_entry','float_caption']);
const protectedTypes=new Set(['code_block','code_line','inline_equation','equation','tex_reference','tex_label','footnoteReference','mention','date']);
type Projection={text:string;runs:{path:number[];start:number;end:number}[]};
type RecordState={key:string;node:TElement;path:number[];generation:number;text?:string;projection?:Projection;issues:ProofreadingIssue[];ids:string[];checked:boolean;cached?:{text:string;issues:ProofreadingIssue[]}};
type Options={check?:typeof checkProofreading;highlights?:ProofreadingHighlights};

/** Read natural-language leaves, preserving a boundary for every protected atom. */
export function projectProofreadingText(editor:PlateEditor,node:TElement,path:number[]):Projection {
  let text='';const runs:Projection['runs']=[];
  const visit=(child:Descendant,at:number[])=>{
    if(typeof child.text==='string'){
      if(child.code){if(child.text)text+='\uFFFC';return;}
      const start=text.length;text+=child.text;runs.push({path:at,start,end:text.length});return;
    }
    const element=child as TElement;
    if(protectedTypes.has(element.type)||editor.api.isVoid(element)){text+='\uFFFC';return;}
    element.children.forEach((item,index)=>visit(item,[...at,index]));
  };
  node.children.forEach((child,index)=>visit(child,[...path,index]));
  return {text,runs};
}

export function proofreadingRange(projection:Projection,start:number,end:number):SlateRange|undefined {
  if(projection.text.slice(start,end).includes('\uFFFC'))return;
  return projectedRange(projection,start,end);
}

/** Dependency ranges may contain protected atoms; editable ranges may not. */
function projectedRange(projection:Projection,start:number,end:number):SlateRange|undefined {
  if(start<0||end<=start||end>projection.text.length)return;
  const first=projection.runs.find(run=>run.start<=start&&run.end>start);
  const last=projection.runs.find(run=>run.start<end&&run.end>=end);
  if(first&&last)return {anchor:{path:first.path,offset:start-first.start},focus:{path:last.path,offset:end-last.start}};
}

/** Follow the original occurrence through edits; never search for another matching word. */
function transformSuggestion(range:SlateRange,operations:readonly Operation[],includeEdges=false):SlateRange|null {
  let current:SlateRange|null=range;
  for(const operation of operations){
    const [start,end]=RangeApi.edges(current);
    if(operation.type==='insert_text'&&operation.text){
      const at={path:operation.path,offset:operation.offset};
      if(includeEdges?Point.compare(at,start)>=0&&Point.compare(at,end)<=0:Point.compare(at,start)>0&&Point.compare(at,end)<0)return null;
    }else if(operation.type==='remove_text'&&operation.text){
      const from={path:operation.path,offset:operation.offset},to={path:operation.path,offset:operation.offset+operation.text.length};
      if(Point.compare(from,end)<0&&Point.compare(to,start)>0)return null;
    }
    current=RangeApi.transform(current,operation,{affinity:'inward'});
    if(!current||RangeApi.isCollapsed(current))return null;
  }
  return current;
}

function projectedOffset(projection:Projection,point:Point):number|undefined {
  const run=projection.runs.find(run=>Path.equals(run.path,point.path));
  if(run&&point.offset>=0&&point.offset<=run.end-run.start)return run.start+point.offset;
}

/** Retain identical text and its marks; never split a surrogate or grapheme. */
function minimalReplacement(original:string,replacement:string):{start:number;end:number;text:string} {
  if(typeof Intl.Segmenter!=='function')return {start:0,end:original.length,text:replacement};
  const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
  const boundaries=(text:string)=>new Set([0,text.length,...Array.from(segmenter.segment(text),part=>part.index)]);
  const before=boundaries(original),after=boundaries(replacement);
  let prefix=0,suffix=0;
  while(prefix<Math.min(original.length,replacement.length)&&original[prefix]===replacement[prefix])prefix++;
  while(!before.has(prefix)||!after.has(prefix))prefix--;
  while(suffix<Math.min(original.length,replacement.length)-prefix&&original[original.length-1-suffix]===replacement[replacement.length-1-suffix])suffix++;
  while(!before.has(original.length-suffix)||!after.has(replacement.length-suffix))suffix--;
  return {start:prefix,end:original.length-suffix,text:replacement.slice(prefix,replacement.length-suffix)};
}

function insertionRange(projection:Projection,offset:number,forward:boolean):SlateRange|undefined {
  const run=forward?projection.runs.find(run=>run.start<=offset&&run.end>offset):projection.runs.find(run=>run.start<offset&&run.end>=offset);
  if(!run)return;
  const point={path:run.path,offset:offset-run.start};return {anchor:point,focus:point};
}

/** One controller per editor. No per-paragraph React subscriptions or saved marks. */
export class ProofreadingController implements ProofreadingClient {
  private records=new Map<string,RecordState>();
  private pending=new Map<string,RecordState>();
  private listeners=new Set<()=>void>();
  private settings=readProofreadingSettings();
  private unsubscribe:()=>void;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private request?:{record:RecordState;abort:AbortController;generation:number;epoch:number};
  private epoch=0;
  private issueSequence=0;
  private disposed=false;
  private composing=false;
  private error='';
  private menu:ProofreadingState['menu'];
  private paintFrame:number|undefined;
  private paintRecords=new Set<RecordState>();
  private readonly check:typeof checkProofreading;
  private readonly highlights:ProofreadingHighlights;
  private state:ProofreadingState;
  private value:readonly Descendant[];
  constructor(readonly editor:PlateEditor,private mount:HTMLElement,private readOnly:()=>boolean,options:Options={}){
    this.check=options.check??checkProofreading;
    this.value=editor.children;
    this.state={enabled:this.settings.enabled,pending:0,checking:false,error:'',checked:0,issues:[]};
    this.highlights=options.highlights??new ProofreadingHighlights(editor,mount,(id,x,y)=>{this.menu={id,x,y};this.publish();});
    this.unsubscribe=subscribeProofreadingSettings(()=>{this.settings=readProofreadingSettings();this.reset();});
    mount.addEventListener('compositionstart',this.compositionStart,true);
    mount.addEventListener('compositionend',this.compositionEnd,true);
  }
  getSnapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
  private compositionStart=()=>{
    this.composing=true;if(this.timer!==undefined)clearTimeout(this.timer);this.timer=undefined;
  };
  private compositionEnd=()=>{this.composing=false;this.schedule();if(this.paintRecords.size)this.paint();};
  private publish(){
    if(this.disposed)return;
    const rows:ProofreadingRow[]=[];let checked=0;
    for(const record of this.records.values()){if(record.checked)checked++;record.issues.forEach((issue,index)=>rows.push({...issue,id:record.ids[index]}));}
    const previous=this.state;
    if(previous.enabled===this.settings.enabled&&previous.pending===this.pending.size&&previous.checking===!!this.request&&
      previous.error===this.error&&previous.menu===this.menu&&previous.checked===checked&&
      previous.issues.length===rows.length&&previous.issues.every((row,index)=>row.id===rows[index].id&&row.start===rows[index].start&&row.end===rows[index].end))return;
    this.state={enabled:this.settings.enabled,pending:this.pending.size,checking:!!this.request,error:this.error,checked,issues:rows,menu:this.menu};
    for(const listener of this.listeners)listener();
  }
  private nodeAt(path:number[]):TElement|undefined {
    try{const node=NodeApi.get(this.editor,path);return Array.isArray(node?.children)?node as TElement:undefined;}catch{return;}
  }
  private blockAt(path:number[]):[TElement,number[]]|undefined {
    let result:[TElement,number[]]|undefined;
    for(let length=1;length<=path.length;length++){
      const at=path.slice(0,length),node=this.nodeAt(at);if(!node)continue;
      if(protectedTypes.has(node.type)||this.editor.api.isVoid(node))return result;
      if(proseTypes.has(node.type)&&!node.children.some(child=>Array.isArray(child.children)&&!this.editor.api.isInline(child as TElement)))result=[node,at];
    }
    return result;
  }
  private livePath(record:RecordState):number[]|undefined {
    if(this.nodeAt(record.path)===record.node)return record.path;
    try{
      const path=this.editor.api.findPath(record.node);
      if(path&&this.nodeAt(path)===record.node){record.path=path;return path;}
    }catch{/* Removed or replaced paragraphs are not valid correction targets. */}
  }
  private removeMarks(record:RecordState){
    for(const id of record.ids)this.highlights.remove(id);
    if(record.ids.includes(this.menu?.id??''))this.menu=undefined;
  }
  /** Preserve untouched suggestions, including those moved by a paragraph split/merge. */
  private reconcile(records:readonly RecordState[],operations:readonly Operation[]):void {
    const survivors:{id:string;issue:ProofreadingIssue;range:SlateRange;context?:SlateRange}[]=[];
    for(const record of records){
      const projection=record.projection??projectProofreadingText(this.editor,record.node,record.path);
      record.issues.forEach((issue,index)=>{
        const range=proofreadingRange(projection,issue.start,issue.end),mapped=range&&transformSuggestion(range,operations);
        if(!mapped)return;
        let context:SlateRange|undefined;
        if(issue.kind==='grammar'&&issue.context){
          const dependency=projectedRange(projection,issue.context.start,issue.context.end);
          const mappedDependency=dependency&&transformSuggestion(dependency,operations,true);
          if(!mappedDependency||projection.text.slice(issue.context.start,issue.context.end)!==issue.context.original)return;
          context=mappedDependency;
        }
        survivors.push({id:record.ids[index],issue,range:mapped,context});
      });
    }
    const plans=records.map(record=>{
      let path:number[]|null=record.path;
      for(const operation of operations){path=Path.transform(path,operation);if(!path)break;}
      const block=path&&this.blockAt(path),node=block&&Path.equals(block[1],path!)?block[0]:undefined;
      return {record,path,node,key:node&&path?(typeof node.id==='string'?node.id:'path:'+path.join('.')):undefined};
    });
    // Path-based keys may swap or shift into one another. Remove old keys as a
    // batch before registering their destinations, preserving queue order.
    const queued=plans.some(plan=>plan.key!==plan.record.key)?[...this.pending.values()]:undefined;
    const cancelledRecords=new Set<RecordState>();
    if(queued)this.pending.clear();
    for(const {record,key} of plans)if(key!==record.key)this.records.delete(record.key);
    for(const {record,path,node,key} of plans){
      this.removeMarks(record);this.paintRecords.delete(record);
      if(!node||node!==record.node){
        this.pending.delete(record.key);cancelledRecords.add(record);record.generation++;
        if(this.request?.record===record){this.request.abort.abort();this.request=undefined;}
      }
      if(!node||!path||key===undefined)continue;
      record.key=key;this.records.set(key,record);
      const projection=projectProofreadingText(this.editor,node,path);
      record.checked=record.checked&&record.text===projection.text;
      record.node=node;record.path=path;record.text=projection.text;record.projection=projection;
      record.issues=[];record.ids=[];
    }
    if(queued)for(const record of queued)if(!cancelledRecords.has(record))this.pending.set(record.key,record);
    const boundaries=new Map<RecordState,Set<number>>(),word=/[\p{Script=Latin}\p{M}\p{N}_]/u;
    for(const {id,issue,range,context} of survivors){
      const [first,last]=RangeApi.edges(range),startBlock=this.blockAt(first.path),endBlock=this.blockAt(last.path);
      if(!startBlock||!endBlock||!Path.equals(startBlock[1],endBlock[1]))continue;
      const [node,path]=startBlock,key=typeof node.id==='string'?node.id:'path:'+path.join('.');
      let record=this.records.get(key);
      if(!record){
        const projection=projectProofreadingText(this.editor,node,path);
        record={key,node,path,generation:0,issues:[],ids:[],checked:false,text:projection.text,projection};this.records.set(key,record);
      }
      const projection=record.projection!,text=projection.text,start=projectedOffset(projection,first),end=projectedOffset(projection,last);
      if(start===undefined||end===undefined||end<=start||text.slice(start,end)!==issue.original||!proofreadingRange(projection,start,end))continue;
      let dependency=issue.context;
      if(context&&dependency){
        const [contextFirst,contextLast]=RangeApi.edges(context),contextStart=projectedOffset(projection,contextFirst),contextEnd=projectedOffset(projection,contextLast);
        if(contextStart===undefined||contextEnd===undefined||contextStart>start||contextEnd<end||text.slice(contextStart,contextEnd)!==dependency.original)continue;
        dependency={...dependency,start:contextStart,end:contextEnd};
      }
      // An edit immediately beside a word can change that word without entering
      // its inward-affinity range (e.g. appending "s" to the old typo "teh").
      if(start>0&&word.test(issue.original[0])&&word.test(text[start-1])||end<text.length&&word.test(issue.original.at(-1)!)&&word.test(text[end]))continue;
      if(typeof Intl.Segmenter==='function'){
        let edges=boundaries.get(record);
        if(!edges){edges=new Set([text.length]);for(const part of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text))edges.add(part.index);boundaries.set(record,edges);}
        if(!edges.has(start)||!edges.has(end))continue;
      }
      // Cache entries retain their original text and offsets for an explicit recheck.
      record.issues.push({...issue,start,end,...(dependency?{context:dependency}:{})});record.ids.push(id);this.paintRecords.add(record);
    }
    this.paint();this.publish();
  }
  /** Only the two explicit check actions may create a task. */
  private enqueue(node:TElement,path:number[]):boolean {
    const key=typeof node.id==='string'?node.id:'path:'+path.join('.');
    let record=this.records.get(key);
    if(record?.node===node&&(this.pending.has(key)||this.request?.record===record||record.checked))return false;
    let notify=!this.pending.has(key);
    if(record){
      notify ||= record.issues.length>0;this.removeMarks(record);
      record.node=node;record.path=path;record.generation++;record.checked=false;record.issues=[];record.ids=[];
      if(this.request?.record===record){this.request.abort.abort();this.request=undefined;}
    }else{
      record={key,node,path,generation:0,issues:[],ids:[],checked:false};this.records.set(key,record);
    }
    this.pending.set(key,record);return notify;
  }
  /** Called once per Slate change; text edits inspect only their ancestor chain. */
  changed(operations:readonly Operation[]):void {
    if(this.disposed||!this.settings.enabled){this.value=this.editor.children;return;}
    const content=operations.filter(operation=>operation.type!=='set_selection');
    if(!content.length){if(!operations.length&&this.value!==this.editor.children)this.reset();this.value=this.editor.children;return;}
    this.value=this.editor.children;
    const structural=content.some(operation=>['insert_node','remove_node','move_node','split_node','merge_node'].includes(operation.type));
    const affected=new Set<RecordState>();
    if(structural){for(const record of this.records.values())affected.add(record);}
    else for(const operation of content){
      if(!('path' in operation))continue;
      for(let length=1;length<=operation.path.length;length++){
        const path=operation.path.slice(0,length),node=this.nodeAt(path);
        if(!node)continue;
        const key=typeof node.id==='string'?node.id:'path:'+path.join('.'),record=this.records.get(key);
        if(record&&record.node!==node)affected.add(record);
      }
      if(operation.type==='set_node'&&'id' in operation.properties&&typeof operation.properties.id==='string'){
        const record=this.records.get(operation.properties.id);if(record)affected.add(record);
      }
    }
    if(affected.size)this.reconcile([...affected],content);
    // Continue only still-valid paragraphs from an explicit check-document request.
    if(!this.readOnly())this.schedule();
  }
  private visitProse(nodes:readonly Descendant[],parent:number[],offset:number,visit:(node:TElement,path:number[])=>void){
    nodes.forEach((raw,index)=>{
      if(!Array.isArray(raw.children))return;
      const node=raw as TElement,path=[...parent,index+offset];
      if(protectedTypes.has(node.type)||this.editor.api.isVoid(node))return;
      if(proseTypes.has(node.type)&&!node.children.some(child=>Array.isArray(child.children)&&!this.editor.api.isInline(child as TElement)))visit(node,path);
      else this.visitProse(node.children,path,0,visit);
    });
  }
  checkCurrent=()=>{
    if(this.disposed||!this.settings.enabled||this.readOnly())return false;
    const point=this.editor.selection?.focus;if(!point)return false;
    const block=this.blockAt(point.path);if(!block)return false;
    this.error='';const key=typeof block[0].id==='string'?block[0].id:'path:'+block[1].join('.');
    const record=this.records.get(key);if(record)record.checked=false;
    this.enqueue(...block);this.publish();this.schedule();return true;
  };
  checkDocument=()=>{
    if(this.disposed||!this.settings.enabled||this.readOnly())return;
    this.error='';
    this.visitProse(this.editor.children,[],0,(node,path)=>{this.enqueue(node,path);});
    this.publish();this.schedule();
  };
  stop=()=>{this.pending.clear();this.request?.abort.abort();this.request=undefined;if(this.timer!==undefined)clearTimeout(this.timer);this.timer=undefined;this.publish();};
  closeMenu=()=>{this.menu=undefined;this.publish();};
  private schedule(){
    if(this.timer!==undefined)clearTimeout(this.timer);
    this.timer=undefined;
    if(this.disposed||this.composing||!this.settings.enabled||!this.pending.size)return;
    this.timer=setTimeout(()=>{this.timer=undefined;void this.run();},0);
  }
  private async run(){
    if(this.disposed||this.request||this.composing||!this.settings.enabled||this.readOnly())return;
    const record=this.pending.values().next().value as RecordState|undefined;if(!record)return;
    this.pending.delete(record.key);
    const path=this.livePath(record);
    if(!path){this.removeMarks(record);this.records.delete(record.key);this.publish();this.schedule();return;}
    const projection=projectProofreadingText(this.editor,record.node,path);
    record.projection=projection;record.text=projection.text;
    if(!projection.text.replaceAll('\uFFFC','').trim()){record.checked=true;this.publish();this.schedule();return;}
    if(record.cached?.text===projection.text){this.receive(record,record.cached.issues);this.publish();this.schedule();return;}
    const request={record,abort:new AbortController(),generation:record.generation,epoch:this.epoch};this.request=request;this.publish();
    try{
      const issues=await this.check(projection.text,this.settings,request.abort.signal,locale);
      if(this.disposed||this.request!==request||request.epoch!==this.epoch||request.generation!==record.generation||!this.livePath(record))return;
      this.receive(record,issues);this.error='';
    }catch(error){
      if(this.request!==request||request.abort.signal.aborted||this.disposed)return;
      this.error=error instanceof ProofreadingServiceError
        ?t(error.message)+(error.detail?'\n'+t('Service response: {detail}',{detail:error.detail}):'')
        :error instanceof Error?error.message:'Could not connect to the proofreading service.';
      this.pending.clear();
    }finally{
      if(this.request===request){this.request=undefined;this.publish();this.schedule();}
    }
  }
  private receive(record:RecordState,issues:ProofreadingIssue[]){
    const projection=record.projection!;
    record.issues=issues.filter(issue=>projection.text.slice(issue.start,issue.end)===issue.original&&!!proofreadingRange(projection,issue.start,issue.end));
    record.cached={text:projection.text,issues:record.issues};
    // Suggestions can outlive their original paragraph after a split. Never
    // reuse an ID when that paragraph's record is later created again.
    record.ids=record.issues.map(()=>record.key+':'+this.epoch+':'+(++this.issueSequence));
    record.checked=true;this.paintRecords.add(record);this.paint();
  }
  private paint(){
    if(this.paintFrame!==undefined||this.composing)return;
    this.paintFrame=this.mount.ownerDocument.defaultView!.requestAnimationFrame(()=>{
      this.paintFrame=undefined;
      if(this.composing)return;
      let removed=false;
      for(const record of this.paintRecords){
        const path=this.livePath(record);
        if(!path){this.removeMarks(record);this.records.delete(record.key);this.pending.delete(record.key);removed=true;continue;}
        if(!record.issues.length)continue;
        const projection=projectProofreadingText(this.editor,record.node,path);if(projection.text!==record.text)continue;
        record.issues.forEach((issue,index)=>{const range=proofreadingRange(projection,issue.start,issue.end);if(range)this.highlights.set(record.ids[index],range,issue.kind);});
      }
      this.paintRecords.clear();
      if(removed)this.publish();
    });
  }
  private issue(id:string):{record:RecordState;issue:ProofreadingIssue;range:SlateRange;projection:Projection}|undefined {
    for(const record of this.records.values()){
      const index=record.ids.indexOf(id);if(index<0)continue;
      const path=this.livePath(record);if(!path)return;
      const projection=projectProofreadingText(this.editor,record.node,path),issue=record.issues[index];
      if(projection.text!==record.text||projection.text.slice(issue.start,issue.end)!==issue.original)return;
      const range=proofreadingRange(projection,issue.start,issue.end);if(range)return {record,issue,range,projection};
    }
  }
  locate=(id:string)=>{
    const entry=this.issue(id);if(!entry)return false;
    this.editor.tf.select(entry.range);this.editor.tf.focus();
    try{this.editor.api.toDOMRange(entry.range)?.startContainer.parentElement?.scrollIntoView({block:'nearest'});}catch{}
    return true;
  };
  apply=(id:string,replacement:string):boolean=>{
    if(this.readOnly())return false;
    const entry=this.issue(id);if(!entry||!entry.issue.replacements.includes(replacement))return false;
    if(entry.issue.original===replacement)return false;
    const change=minimalReplacement(entry.issue.original,replacement),start=entry.issue.start+change.start,end=entry.issue.start+change.end;
    const range=start===end?insertionRange(entry.projection,start,change.start===0):proofreadingRange(entry.projection,start,end);
    if(!range)return false;
    const index=entry.record.ids.indexOf(id);this.highlights.remove(id);this.menu=undefined;
    entry.record.issues=entry.record.issues.filter((_,at)=>at!==index);entry.record.ids=entry.record.ids.filter((_,at)=>at!==index);
    this.editor.tf.withNewBatch(()=>{this.editor.tf.select(range);this.editor.tf.insertText(change.text);});
    this.editor.tf.focus();this.publish();return true;
  };
  ignore=(id:string)=>{
    for(const record of this.records.values()){
      const index=record.ids.indexOf(id);if(index<0)continue;
      this.highlights.remove(id);record.ids.splice(index,1);record.issues.splice(index,1);break;
    }
    this.menu=undefined;this.publish();
  };
  reset=()=>{
    this.value=this.editor.children;this.epoch++;this.request?.abort.abort();this.request=undefined;this.pending.clear();this.records.clear();this.paintRecords.clear();
    if(this.timer!==undefined)clearTimeout(this.timer);this.timer=undefined;this.highlights.clear();this.menu=undefined;this.error='';this.publish();
  };
  destroy(){
    this.reset();this.disposed=true;this.unsubscribe();this.highlights.destroy();this.listeners.clear();
    if(this.paintFrame!==undefined)this.mount.ownerDocument.defaultView!.cancelAnimationFrame(this.paintFrame);
    this.mount.removeEventListener('compositionstart',this.compositionStart,true);this.mount.removeEventListener('compositionend',this.compositionEnd,true);
  }
}

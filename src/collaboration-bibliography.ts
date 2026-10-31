import * as Y from 'yjs';
import {citedBibRecords,validateBibLibraries,validCitationKey,type BibLibrary,type CitedBibRecord} from './bibtex';

export interface SharedBibRecord extends CitedBibRecord {version:1}
const signature=(value:unknown)=>JSON.stringify(value);
const contentSignature=({key,type,fields,preambles}:CitedBibRecord)=>signature({key,type,fields,preambles});
function record(value:unknown,key:string):SharedBibRecord {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid shared bibliography record.');
  const entry=value as Partial<SharedBibRecord>;
  if(entry.version!==1||!validCitationKey(key)||entry.key!==key||typeof entry.type!=='string'||!entry.type||
    !/^[\p{L}\p{N}_:.-]+$/u.test(entry.type)||typeof entry.libraryId!=='string'||!entry.libraryId.trim()||
    typeof entry.libraryName!=='string'||!entry.libraryName.trim()||!entry.fields||typeof entry.fields!=='object'||Array.isArray(entry.fields)||
    !Object.entries(entry.fields).every(([name,value])=>/^[\p{L}\p{N}_:.-]+$/u.test(name)&&typeof value==='string')||
    !Array.isArray(entry.preambles)||!entry.preambles.every(value=>typeof value==='string'))throw Error('Invalid shared bibliography record.');
  return {version:1,key,type:entry.type,libraryId:entry.libraryId,libraryName:entry.libraryName,
    fields:Object.fromEntries(Object.entries(entry.fields).sort(([a],[b])=>a<b?-1:a>b?1:0)),preambles:[...entry.preambles]};
}
function source(entry:SharedBibRecord):string {
  return '@'+entry.type+'{'+entry.key+',\n'+Object.entries(entry.fields).map(([name,value])=>'  '+name+' = {'+value+'}').join(',\n')+'\n}';
}
function contextId(value:string):string {
  // Contexts only need stable identity, never passwords or authentication.
  let hash=0x6c62272e07bb014262b821756295c58dn;
  for(const character of value){hash^=BigInt(character.codePointAt(0)!);hash=BigInt.asUintN(128,hash*0x1000000000000000000013bn);}
  return hash.toString(16).padStart(32,'0');
}

/** Sharing a document never shares the unrelated records in a local .bib file. */
export class CollaborativeBibliography {
  readonly state:Y.Map<SharedBibRecord>;
  private readonly locallySeen=new Map<string,string>();
  private readonly listeners=new Set<()=>void>();
  private readonly observe=()=>{for(const listener of this.listeners)listener();};
  constructor(readonly doc:Y.Doc,readonly origin:unknown,existingUndoManager?:Y.UndoManager){
    this.state=doc.getMap<SharedBibRecord>('vulgar-bibliography-v1');
    if(existingUndoManager){existingUndoManager.addToScope(this.state);existingUndoManager.addTrackedOrigin(origin);}
    this.state.observe(this.observe);
  }
  subscribe(listener:()=>void):()=>void {this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  publish(libraries:readonly BibLibrary[],citedKeys:readonly string[]):void {
    const records=citedBibRecords(libraries,citedKeys).map(entry=>record({version:1,...entry},entry.key));
    const writes:SharedBibRecord[]=[];
    for(const entry of records){
      const next=contentSignature(entry),before=this.locallySeen.get(entry.key),shared=this.state.get(entry.key);
      // Seeing somebody else's newer record is not a local edit. In particular,
      // a stale library view must not echo its old fields back over that record.
      if(shared===undefined||before!==undefined&&before!==next){
        if(shared===undefined||contentSignature(record(shared,entry.key))!==next)writes.push(entry);
      }
      this.locallySeen.set(entry.key,next);
    }
    if(writes.length)this.doc.transact(()=>{for(const entry of writes)this.state.set(entry.key,entry);},this.origin);
  }
  read():BibLibrary[] {
    const entries=[...this.state.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value])=>record(value,key));
    const groups=new Map<string,{id:string;name:string;preambles:string[];entries:SharedBibRecord[]}>();
    const contexts=new Map<string,Set<string>>();
    for(const entry of entries){
      const context=signature([entry.libraryId,entry.libraryName,entry.preambles]);
      let group=groups.get(context);
      if(!group){group={id:entry.libraryId,name:entry.libraryName,preambles:entry.preambles,entries:[]};groups.set(context,group);}
      group.entries.push(entry);
      const owned=contexts.get(entry.libraryId)??new Set<string>();owned.add(context);contexts.set(entry.libraryId,owned);
    }
    const usedIds=new Map<string,string>(),libraries:BibLibrary[]=[];
    for(const [context,group] of groups){
      let id=contexts.get(group.id)!.size===1?group.id:group.id+':collab-context:'+contextId(context);
      if(usedIds.has(id)&&usedIds.get(id)!==context)id+=':'+encodeURIComponent(context);
      usedIds.set(id,context);
      libraries.push({id,name:group.name,source:[...group.preambles.map(value=>'@preamble{{'+value+'}}'),...group.entries.map(source)].join('\n\n')+'\n'});
    }
    return validateBibLibraries(libraries);
  }
  destroy():void {this.state.unobserve(this.observe);this.listeners.clear();this.locallySeen.clear();}
}

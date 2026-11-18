// SPDX-License-Identifier: GPL-3.0-or-later
import {bibLibrarySourceEntries,parseBibLibrary,validCitationKey,type BibLibrary} from './bibtex';
import type {BibLibraryCslItem,BibLibraryItem} from './generated/bib-library';

type Patch={start:number;end:number;text:string};
type Field={name:string;start:number;end:number;valueStart:number;valueEnd:number};
type Layout={typeStart:number;typeEnd:number;keyStart:number;keyEnd:number;close:number;fields:Field[]};
type Serializer=(items:readonly BibLibraryItem[])=>string;
const identity='vulgar-source-key';
const tagsOf=(value:unknown)=>typeof value==='string'?[...new Set(value.split(/[,，;]/).map(tag=>tag.trim()).filter(Boolean))]:[];
const plainCSL=(item:BibLibraryCslItem)=>{
  const result={...item};delete result[identity];delete result['citation-key'];delete result.keyword;
  return result;
};
const stable=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
function apply(source:string,patches:Patch[]):string {
  let end=source.length;
  for(const patch of [...patches].sort((a,b)=>b.start-a.start||b.end-a.end)){
    if(patch.start<0||patch.end<patch.start||patch.end>end)throw Error('Could not safely update the original BibTeX source.');
    source=source.slice(0,patch.start)+patch.text+source.slice(patch.end);end=patch.start;
  }
  return source;
}

/** Only locate source spans; the established BibTeX parser validates grammar. */
function recordSpans(source:string):{start:number;end:number;input:string}[] {
  const result=[];
  for(let at=0;at<source.length;){
    if(source[at]==='%'){const next=source.indexOf('\n',at);at=next<0?source.length:next+1;continue;}
    if(source[at]!=='@'){at++;continue;}
    const header=/^@([\w-]+)\s*([{(])/.exec(source.slice(at));
    if(!header){at++;continue;}
    const open=header[2],start=at;at+=header[0].length;
    let braces=open==='{'?1:0,quoted=false;
    for(;at<source.length;at++){
      const c=source[at];if(c==='\\'){at++;continue;}
      if(c==='"'&&braces===(open==='{'?1:0)){quoted=!quoted;continue;}
      if(c==='{')braces++;
      else if(c==='}'){
        braces--;if(open==='{'&&braces===0&&!quoted){at++;break;}
      }else if(c===')'&&open==='('&&braces===0&&!quoted){at++;break;}
    }
    if(!['string','comment','preamble'].includes(header[1].toLowerCase()))result.push({start,end:at,input:source.slice(start,at)});
  }
  return result;
}

function layout(input:string):Layout {
  const header=/^@([^\s{(]+)\s*[{(]\s*([^,\s})]+)/.exec(input);
  if(!header)throw Error('Could not safely update the original BibTeX source.');
  const typeStart=1,typeEnd=1+header[1].length,keyEnd=header[0].length,keyStart=keyEnd-header[2].length;
  const close=input.length-1,fields:Field[]=[];
  let at=keyEnd;
  while(at<close){
    if(/[\s,]/.test(input[at])){at++;continue;}
    if(input[at]==='%'){const next=input.indexOf('\n',at);at=next<0?close:next+1;continue;}
    const start=at,field=/^([^\s=,{}()]+)\s*=\s*/.exec(input.slice(at));
    if(!field)throw Error('Could not safely update the original BibTeX source.');
    at+=field[0].length;const valueStart=at;let braces=0,quoted=false;
    for(;at<close;at++){
      const c=input[at];if(c==='\\'){at++;continue;}
      if(c==='"'&&braces===0){quoted=!quoted;continue;}
      if(c==='{')braces++;else if(c==='}')braces--;else if(c===','&&braces===0&&!quoted)break;
    }
    let valueEnd=at;while(valueEnd>valueStart&&/\s/.test(input[valueEnd-1]))valueEnd--;
    if(input[at]===',')at++;
    fields.push({name:field[1].toLowerCase(),start,end:at,valueStart,valueEnd});
  }
  return {typeStart,typeEnd,keyStart,keyEnd,close,fields};
}

const aliases:readonly string[][]=[
  ['journaltitle','journal','booktitle'],['publisher','institution','school','organization'],
  ['date','year'],['location','address'],['issue','number'],['pagetotal','numpages'],
  ['shortjournal','journalabbr','shortjournaltitle'],['origdate','origyear'],
];
const family=(name:string)=>aliases.find(names=>names.includes(name))??[name];
function encoded(item:BibLibraryItem,toBibtex:Serializer):{input:string;type:string;fields:Map<string,string>} {
  const input=toBibtex([{...item,csl:plainCSL(item.csl)}]).trim();
  const parsed=layout(input);
  return {input,type:input.slice(parsed.typeStart,parsed.typeEnd),fields:new Map(parsed.fields.map(field=>[field.name,input.slice(field.valueStart,field.valueEnd)]))};
}

export interface LibraryEditSession {
  initialItems:BibLibraryCslItem[];
  serialize(items:readonly BibLibraryItem[]):string;
}

/** Edit only changed fields. Untouched source, including macros/comments, is data. */
export function createLibraryEditSession(library:BibLibrary,toBibtex:Serializer):LibraryEditSession {
  const entries=parseBibLibrary(library),raw=bibLibrarySourceEntries(library),spans=recordSpans(library.source);
  // The upstream parser may include following comments in entry.input. Keep
  // those outside the editable record span so deleting a record cannot erase them.
  if(spans.length!==raw.length||raw.some((entry,index)=>!entry.input.startsWith(spans[index].input)))throw Error('Could not safely update the original BibTeX source.');
  const initialItems:BibLibraryCslItem[]=entries.map(entry=>({...entry.csl!,id:entry.key,[identity]:entry.key}));
  const originals=new Map(raw.map((entry,index)=>{
    const csl=initialItems[index],tags=tagsOf(csl.keyword);
    const item:BibLibraryItem={id:entry.key,csl,tags,collections:[],addedAt:0,updatedAt:0,source:'bibtex'};
    return [entry.key,{entry,span:spans[index],item}];
  }));
  return {initialItems,serialize(items){
    const ids=new Set<string>(),byOriginal=new Map<string,BibLibraryItem>(),added:BibLibraryItem[]=[];
    for(const item of items){
      if(!validCitationKey(item.id)||ids.has(item.id)||item.csl.id!==item.id)throw Error('The library contains an invalid or duplicate citation key.');
      ids.add(item.id);
      const marked=item.csl[identity],key=typeof marked==='string'&&originals.has(marked)?marked:originals.has(item.id)?item.id:undefined;
      if(key){if(byOriginal.has(key))throw Error('The library contains conflicting source identities.');byOriginal.set(key,item);}else added.push(item);
    }
    const renamed=new Map([...byOriginal].filter(([key,item])=>key!==item.id).map(([key,item])=>[key,item.id]));
    const patches:Patch[]=[];
    for(const [key,{entry,span,item:before}] of originals){
      const item=byOriginal.get(key);if(!item){patches.push({...span,text:''});continue;}
      const current=layout(span.input),edits:Patch[]=[],newFields=new Map<string,string>();
      if(item.id!==key)edits.push({start:current.keyStart,end:current.keyEnd,text:item.id});
      const beforeCSL=plainCSL(before.csl),nextCSL=plainCSL(item.csl);
      // Identity changes alone do not normalize any bibliographic fields.
      nextCSL.id=beforeCSL.id;
      if(stable([beforeCSL,before.tags])!==stable([nextCSL,item.tags])){
        const oldExport=encoded(before,toBibtex),nextExport=encoded(item,toBibtex);
        if(before.csl.type!==item.csl.type)edits.push({start:current.typeStart,end:current.typeEnd,text:nextExport.type});
        const changed=new Set([...oldExport.fields.keys(),...nextExport.fields.keys()].filter(name=>oldExport.fields.get(name)!==nextExport.fields.get(name)));
        const handled=new Set<string>();
        for(const name of changed){
          const names=family(name),group=names.join('|');if(handled.has(group))continue;handled.add(group);
          const outputName=[...nextExport.fields.keys()].find(field=>names.includes(field));
          const value=outputName===undefined?undefined:nextExport.fields.get(outputName);
          const existing=current.fields.filter(field=>names.includes(field.name));
          if(value===undefined){for(const field of existing)edits.push({start:field.start,end:field.end,text:''});}
          else if(existing.length){
            // Update every duplicate spelling of this semantic field; leaving
            // an old preferred alias would conceal the user's new value.
            for(const field of existing)edits.push({start:field.valueStart,end:field.valueEnd,text:value});
          }else newFields.set(outputName!,value);
        }
      }
      for(const field of current.fields.filter(field=>field.name==='crossref'||field.name==='xdata')){
        const previous=entry.fields[field.name],next=previous?.split(',').map(part=>renamed.get(part.trim())??part.trim()).join(', ');
        if(next&&next!==previous&&previous.split(',').some(part=>renamed.has(part.trim())))edits.push({start:field.valueStart,end:field.valueEnd,text:'{'+next+'}'});
      }
      let updated=apply(span.input,edits);
      if(newFields.size){
        const at=updated.length-1,body=updated.slice(0,at).trimEnd();
        const separator=body.endsWith(',')?'':',';
        updated=updated.slice(0,at)+separator+'\n'+[...newFields].map(([name,value])=>'  '+name+' = '+value+',').join('\n')+'\n'+updated.slice(at);
      }
      if(updated!==span.input)patches.push({start:span.start,end:span.end,text:updated});
    }
    let source=apply(library.source,patches);
    if(added.length)source+=(source&&!source.endsWith('\n')?'\n':'')+toBibtex(added.map(item=>({...item,csl:plainCSL(item.csl)})));
    parseBibLibrary({...library,source});
    return source;
  }};
}

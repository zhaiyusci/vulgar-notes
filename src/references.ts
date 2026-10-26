import type {KEYS,TElement,Value} from 'platejs';
import {parseBibLibraries,validCitationKey,type BibLibrary} from './bibtex';

export const referenceKeyPattern=/^[A-Za-z][A-Za-z0-9:._-]*$/;
export const validReferenceKey=(key:unknown):key is string=>typeof key==='string'&&referenceKeyPattern.test(key);
export type ReferenceCommand='ref'|'eqref'|'cite';
export type ReferenceNode=TElement & {command:ReferenceCommand;keys:string[]};
export interface ReferenceTarget {node:TElement;path:number[];kind:'equation'|'heading'|'bibliography'|'anchor'|'endnote';key:string;number:string;description:string;libraryId?:string;identifier?:string}
export type BibliographyItem=ReferenceTarget&{kind:'bibliography'|'endnote'};
const textOf=(node:any):string=>typeof node.text==='string'?node.text:(node.children||[]).map(textOf).join('');
// Keep this pure document query free of Plate runtime/browser side effects,
// while type-checking the persisted node types against the installed package.
const footnoteTypes={reference:'footnoteReference',definition:'footnoteDefinition'} satisfies {
  reference:typeof KEYS.footnoteReference;definition:typeof KEYS.footnoteDefinition;
};

export function citedReferenceKeys(value:Value):string[]{
  const keys=new Set<string>();
  const walk=(nodes:any[])=>{for(const node of nodes){
    if(node.type==='tex_reference'&&node.command==='cite')for(const key of node.keys||[])keys.add(key);
    if(Array.isArray(node.children))walk(node.children);
  }};walk(value);return [...keys];
}

function referenceIndex(value:Value,libraries:readonly BibLibrary[]){
  let equations=0,currentHeading='';
  const headings=[0,0,0,0,0,0],result:ReferenceTarget[]=[],editable:BibliographyItem[]=[];
  const citations=new Map<string,BibliographyItem[]>(),notes=new Map<string,BibliographyItem[]>();
  const add=(map:Map<string,BibliographyItem[]>,key:string,target:BibliographyItem)=>map.set(key,[...(map.get(key)||[]),target]);
  const walk=(nodes:any[],parent:number[])=>nodes.forEach((node,index)=>{
    const path=[...parent,index];
    if(node.type==='bibliography_entry'){
      const target:BibliographyItem={node,path,kind:'bibliography',key:node.citeKey||'',number:'',description:textOf(node)};
      result.push(target);editable.push(target);add(citations,target.key,target);return;
    }
    if(node.type===footnoteTypes.definition){
      const identifier=typeof node.identifier==='string'?node.identifier:'';
      const target:BibliographyItem={node,path,kind:'endnote',key:'endnote:'+identifier,identifier,number:'',description:textOf(node)};
      result.push(target);editable.push(target);add(notes,identifier,target);
    }
    if(/^h[1-3]$/.test(node.type)){
      const level=Number(node.type[1]);headings[level-1]++;headings.fill(0,level);
      currentHeading=headings.slice(0,level).join('.');
      result.push({node,path,kind:'heading',key:node.texLabel||'',number:headings.slice(0,level).join('.'),description:textOf(node)});
    }
    if(node.type==='tex_label'){
      result.push({node,path,kind:'anchor',key:node.texLabel||'',number:currentHeading,description:node.texLabel||''});return;
    }
    if((node.type==='equation'||node.type==='inline_equation'&&node.display)&&node.numbered!==false){
      result.push({node,path,kind:'equation',key:node.texLabel||'',number:String(++equations),description:node.texExpression||''});
    }
    if(Array.isArray(node.children))walk(node.children,path);
  });
  walk(value,[]);
  for(const entry of parseBibLibraries(libraries)){
    const target:BibliographyItem={node:{type:'bibliography_entry',citeKey:entry.key,children:[{text:entry.description}]},path:[],kind:'bibliography',key:entry.key,number:'',description:entry.description,libraryId:entry.libraryId};
    result.push(target);add(citations,entry.key,target);
  }

  const ordered:BibliographyItem[]=[],seen=new Set<BibliographyItem>(),expanded=new Set<BibliographyItem>();
  let number=0;
  const append=(target:BibliographyItem)=>{
    if(seen.has(target))return;
    seen.add(target);ordered.push(target);
    const matches=target.kind==='endnote'?notes.get(target.identifier||''):citations.get(target.key);
    const valid=target.kind==='endnote'?!!target.identifier:validCitationKey(target.key);
    if(valid&&matches?.length===1)target.number=String(++number);
  };
  const visit=(nodes:any[])=>{
    for(const node of nodes){
      // Stored definitions do not become body references merely because they
      // occur earlier in the Slate tree. A note's contents are expanded when
      // its reference is first reached, with cycles stopped by row identity.
      if(node.type==='bibliography_entry'||node.type===footnoteTypes.definition)continue;
      if(node.type==='tex_reference'&&node.command==='cite'){
        for(const key of node.keys||[])for(const target of citations.get(key)||[])append(target);
      }else if(node.type===footnoteTypes.reference){
        const matches=notes.get(node.identifier)||[];
        for(const target of matches)append(target);
        if(matches.length===1)expand(matches[0]);
      }
      if(Array.isArray(node.children))visit(node.children);
    }
  };
  const expand=(target:BibliographyItem)=>{
    if(target.kind!=='endnote'||expanded.has(target))return;
    expanded.add(target);visit(target.node.children);
  };
  visit(value);
  // Older documents may have editable rows with no remaining reference.
  // Retain every row (including duplicates), preserving their relative order.
  for(const target of editable){append(target);expand(target);}
  return {targets:result,items:ordered};
}

/** Shared endnote/citation numbering follows first occurrence in body prose. */
export function bibliographyItems(value:Value,libraries:readonly BibLibrary[]=[]):BibliographyItem[]{
  return referenceIndex(value,libraries).items;
}

/** Recompute from document order; numbers are presentation, keys are identity. */
export function referenceTargets(value:Value,libraries:readonly BibLibrary[]=[]):ReferenceTarget[]{
  return referenceIndex(value,libraries).targets;
}
export function resolveReference(value:Value,reference:ReferenceNode,libraries:readonly BibLibrary[]=[]){
  const targets=referenceTargets(value,libraries),citation=reference.command==='cite';
  const matches=reference.keys.map(key=>targets.filter(target=>target.key===key&&(citation?target.kind==='bibliography':reference.command==='eqref'?target.kind==='equation':target.kind!=='bibliography'&&target.kind!=='endnote')));
  const invalid=matches.some(items=>items.length!==1||!items[0].number)||!matches.length;
  const numbers=matches.map(items=>items.length===1&&items[0].number?items[0].number:'??');
  const text=citation?'['+numbers.join(', ')+']':reference.command==='eqref'?'('+numbers.join(', ')+')':numbers.join(', ');
  return {text,invalid,targets:matches.flatMap(items=>items.length===1?items:[])};
}
export function referenceTex(node:ReferenceNode):string {
  const validKey=node.command==='cite'?validCitationKey:validReferenceKey;
  if(!['ref','eqref','cite'].includes(node.command)||!Array.isArray(node.keys)||!node.keys.length||node.command!=='cite'&&node.keys.length!==1||node.keys.some(key=>!validKey(key)))throw Error('Invalid reference');
  return '\\'+node.command+'{'+node.keys.join(',')+'}';
}

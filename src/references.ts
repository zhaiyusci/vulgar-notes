import type {TElement,Value} from 'platejs';
import {parseBibLibraries,validCitationKey,type BibLibrary} from './bibtex';

export const referenceKeyPattern=/^[A-Za-z][A-Za-z0-9:._-]*$/;
export const validReferenceKey=(key:unknown):key is string=>typeof key==='string'&&referenceKeyPattern.test(key);
export type ReferenceCommand='ref'|'eqref'|'cite';
export type ReferenceNode=TElement & {command:ReferenceCommand;keys:string[]};
export interface ReferenceTarget {node:TElement;path:number[];kind:'equation'|'heading'|'bibliography'|'anchor';key:string;number:string;description:string;libraryId?:string}
const textOf=(node:any):string=>typeof node.text==='string'?node.text:(node.children||[]).map(textOf).join('');

export function citedReferenceKeys(value:Value):string[]{
  const keys=new Set<string>();
  const walk=(nodes:any[])=>{for(const node of nodes){
    if(node.type==='tex_reference'&&node.command==='cite')for(const key of node.keys||[])keys.add(key);
    if(Array.isArray(node.children))walk(node.children);
  }};walk(value);return [...keys];
}

/** Recompute from document order; numbers are presentation, keys are identity. */
export function referenceTargets(value:Value,libraries:readonly BibLibrary[]=[]):ReferenceTarget[]{
  let equations=0,bibliography=0,currentHeading='';
  const headings=[0,0,0,0,0,0],result:ReferenceTarget[]=[],cited=citedReferenceKeys(value);
  const walk=(nodes:any[],parent:number[])=>nodes.forEach((node,index)=>{
    const path=[...parent,index];
    if(node.type==='bibliography_entry'){
      result.push({node,path,kind:'bibliography',key:node.citeKey||'',number:String(++bibliography),description:textOf(node)});return;
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
  const entries=parseBibLibraries(libraries);
  const libraryKeys=new Set(entries.map(entry=>entry.key));
  const counts=new Map<string,number>();
  for(const key of [...result.filter(item=>item.kind==='bibliography').map(item=>item.key),...entries.map(entry=>entry.key)])counts.set(key,(counts.get(key)||0)+1);
  const numbers=new Map<string,string>();
  for(const key of cited)if(counts.get(key)===1&&libraryKeys.has(key))numbers.set(key,String(++bibliography));
  for(const entry of entries)result.push({node:{type:'bibliography_entry',citeKey:entry.key,children:[{text:entry.description}]},path:[],kind:'bibliography',key:entry.key,number:numbers.get(entry.key)||'',description:entry.description,libraryId:entry.libraryId});
  return result;
}
export function resolveReference(value:Value,reference:ReferenceNode,libraries:readonly BibLibrary[]=[]){
  const targets=referenceTargets(value,libraries),citation=reference.command==='cite';
  const matches=reference.keys.map(key=>targets.filter(target=>target.key===key&&(citation?target.kind==='bibliography':reference.command==='eqref'?target.kind==='equation':target.kind!=='bibliography')));
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

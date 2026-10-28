// SPDX-License-Identifier: GPL-3.0-or-later
import {catalog,symbols,type Definition,type Region,type ScriptSlot} from './editor-model';
import type {ParseTexRegion,CreateTexNode,ParsedTexStructure} from './tex-import-environments';

const supportedOperators=new Set('sum prod coprod bigcup bigcap bigsqcup biguplus bigvee bigwedge bigodot bigoplus bigotimes int iint iiint iiiint idotsint oint'.split(' '));
const slots:ScriptSlot[]=['leftLower','leftUpper','lower','upper'];

/** Side scripts belong to their operator; there is no editable operand slot. */
export function registerSideSetStructures(definitions:Definition[]):void {
  // This module also imports the completed model for its parser. Registration
  // can run while that circular import is still being initialized, so its
  // small immutable grammar data must be local rather than top-level bindings.
  const supportedOperators=new Set('sum prod coprod bigcup bigcap bigsqcup biguplus bigvee bigwedge bigodot bigoplus bigotimes int iint iiint iiiint idotsint oint'.split(' '));
  const slots:ScriptSlot[]=['leftLower','leftUpper','lower','upper'];
  const labels=['Left subscript','Left superscript','Right subscript','Right superscript'];
  const existing=definitions.find(entry=>entry.type==='sideset');
  const operators=definitions.filter(entry=>entry.operator&&supportedOperators.has(entry.operatorCommand??'')&&!entry.scriptSlots?.includes('leftLower'));
  for(const operator of operators){
    const command=operator.operatorCommand!,placement=operator.operatorPlacement??'';
    const type='sideset-'+command+(placement==='\\limits'?'-limits':placement==='\\nolimits'?'-nolimits':'');
    if(command==='sum'&&!placement&&existing)continue;
    if(definitions.some(entry=>entry.type===type))continue;
    definitions.push({type,label:command,category:'大型算符',labels:[...labels],selectedIndex:0,
      command:'\\sideset',hidden:true,commandCandidate:false,operator:true,operatorCommand:command,operatorPlacement:placement,
      scriptSlots:[...slots],scriptLabels:[...labels],legacySlots:4,variantOf:operator.variantOf??operator.type,
      render:r=>`\\sideset{_{${r[0]}}^{${r[1]}}}{_{${r[2]}}^{${r[3]}}}\\${command}${placement}`});
  }
}

const whitespace=(source:string,start:number)=>{while(start<source.length&&/\s/.test(source[start]))start++;return start;};
function control(source:string,start:number):{name:string;next:number}|null {
  if(source[start]!=='\\'||start+1>=source.length)return null;
  const name=/^[A-Za-z]+/.exec(source.slice(start+1))?.[0]??source[start+1];return {name,next:start+1+name.length};
}
function group(source:string,start:number):{body:string;next:number}|null {
  if(source[start]!=='{')return null;let depth=1,i=start+1;
  while(i<source.length){
    if(source[i]==='%'){const line=source.indexOf('\n',i);i=line<0?source.length:line+1;continue;}
    if(source[i]==='\\'){const token=control(source,i);if(!token)return null;i=token.next;continue;}
    if(source[i]==='{')depth++;
    else if(source[i]==='}'&&--depth===0)return {body:source.slice(start+1,i),next:i+1};
    i++;
  }
  return null;
}
function scriptArgument(source:string,start:number):{body:string;next:number}|null {
  const i=whitespace(source,start);if(source[i]==='{')return group(source,i);
  const token=control(source,i);
  if(token){
    // An unbraced argument is one non-consuming symbol token, never a macro
    // that may inspect later input or establish a new scope.
    if(!symbols.some(entry=>entry.atom&&entry.command==='\\'+token.name&&entry.category!=='函数名称'))return null;
    return {body:source.slice(i,token.next),next:token.next};
  }
  const char=i<source.length?String.fromCodePoint(source.codePointAt(i)!):'';
  if(!char||/[{}_^%#$&~[\]*]/.test(char))return null;
  return {body:char,next:i+char.length};
}
function scripts(source:string,left:boolean):{slot:ScriptSlot;body:string}[]|null {
  const result:{slot:ScriptSlot;body:string}[]=[],seen=new Set<ScriptSlot>();let i=0;
  while((i=whitespace(source,i))<source.length){
    const marker=source[i++];if(marker!=='_'&&marker!=='^')return null;
    const slot:ScriptSlot=left?(marker==='_'?'leftLower':'leftUpper'):(marker==='_'?'lower':'upper');
    if(seen.has(slot))return null;seen.add(slot);
    const argument=scriptArgument(source,i);if(!argument)return null;i=argument.next;
    // Empty explicit scripts are retained in source rather than normalized to
    // absence: MathJax can emit different script boxes for an empty argument.
    if(!argument.body.trim())return null;
    result.push({slot,body:argument.body});
  }
  return result;
}

/** Strict AMS grammar: two pure script groups, then one supported bare operator. */
export function parseTexSideSet(source:string,start:number,parseRegion:ParseTexRegion,createNode:CreateTexNode):ParsedTexStructure|null {
  const macro=control(source,start);if(macro?.name!=='sideset')return null;
  const left=group(source,whitespace(source,macro.next));if(!left)return null;
  const right=group(source,whitespace(source,left.next));if(!right)return null;
  const operator=control(source,whitespace(source,right.next));if(!operator||!supportedOperators.has(operator.name))return null;
  let next=operator.next,placement='';const possible=control(source,whitespace(source,next));
  if(possible&&['limits','nolimits'].includes(possible.name)){placement='\\'+possible.name;next=possible.next;}
  const following=whitespace(source,next);
  // Those are outer limits of the whole sideset OP, not its right-side slots.
  // A caller must preserve that complete construct as source, not merge them.
  if(source[following]==='_'||source[following]==='^'||source[following]==="'"||possible?.name==='displaylimits')return null;
  const leftScripts=scripts(left.body,true),rightScripts=scripts(right.body,false);if(!leftScripts||!rightScripts)return null;
  const definition=catalog.find(entry=>entry.operatorCommand===operator.name&&(entry.operatorPlacement??'')===placement&&entry.scriptSlots?.includes('leftLower'));
  if(!definition)return null;
  const fields=[...leftScripts,...rightScripts].sort((a,b)=>slots.indexOf(a.slot)-slots.indexOf(b.slot));
  // An empty sideset still creates an OP wrapper in MathJax. With no editable
  // script slots, retaining its original source is safer than erasing that atom.
  if(!fields.length)return null;
  const regions:Region[]=[];
  for(const field of fields){const parsed=parseRegion(field.body);if(!parsed)return null;parsed.slot=field.slot;regions.push(parsed);}
  const node=createNode(definition.type,regions);node.operatorLayout=true;
  return {node,next};
}

// SPDX-License-Identifier: GPL-3.0-or-later
import {catalog,symbols,type Definition,type Region} from './editor-model';
import {parseTexEnvironment,scanTexEnvironment,scanTexDelimiter,type ParseTexRegion,type CreateTexNode,type ParsedTexStructure} from './tex-import-environments';

interface Literal {kind:'literal';source:string}
interface Argument {kind:'argument';slot:number;open:string;close:string;optional:boolean;atomic:boolean}
interface Template {definition:Definition;parts:(Literal|Argument)[];command:string;slots:number}
interface Bound {body:string;next:number}
const marker=(slot:number)=>'VNCATALOGARG'+slot+'END';
const skip=(source:string,start:number)=>{while(start<source.length&&/\s/.test(source[start]))start++;return start;};
function control(source:string,start:number):{name:string;next:number}|null {
  if(source[start]!=='\\'||start+1>=source.length)return null;
  const name=/^[A-Za-z]+/.exec(source.slice(start+1))?.[0]??source[start+1];return {name,next:start+1+name.length};
}
function escaped(source:string,index:number):boolean {let count=0;while(index>0&&source[--index]==='\\')count++;return count%2===1;}
function balanced(source:string,start:number,open:string,close:string,nestedSquare=false):Bound|null {
  if(source[start]!==open)return null;
  let depth=1,braces=0,i=start+1;
  while(i<source.length){
    const ch=source[i];
    if(ch==='%'){const line=source.indexOf('\n',i);i=line<0?source.length:line+1;continue;}
    if(ch==='\\'){const token=control(source,i);if(!token)return null;if(['verb','lstinline'].includes(token.name))return null;i=token.next;continue;}
    if(open!=='{'){
      if(ch==='{'){braces++;i++;continue;}
      if(ch==='}'){if(--braces<0)return null;i++;continue;}
    }
    if(!braces){
      if(ch===close&&--depth===0)return {body:source.slice(start+1,i),next:i+1};
      // TeX optional arguments close at the first ] outside a brace group.
      if(ch===open&&open!==close&&(open!=='['||nestedSquare))depth++;
    }
    i++;
  }
  return null;
}
function literal(source:string,start:number,pattern:string):number|null {
  let i=start,j=0;
  while(j<pattern.length){
    i=skip(source,i);j=skip(pattern,j);if(j>=pattern.length)break;
    if(pattern[j]==='\\'){
      const expected=control(pattern,j),actual=control(source,i);if(!expected||!actual||expected.name!==actual.name)return null;
      i=actual.next;j=expected.next;
    }else {if(pattern[j]!==source[i])return null;i++;j++;}
  }
  return i;
}

function compile(definition:Definition):Template|null {
  if(definition.font||definition.operator||definition.raw||definition.matrixEnvironment||definition.rowEnvironment||definition.legacy||definition.texOptionsKind||
    ['sqrt','nthroot','cfrac','cfracl','cfracr','tex-group','physics-auto-parens'].includes(definition.type))return null;
  const args=definition.labels.map((_,slot)=>marker(slot)),rendered=definition.render(args);
  const matches=[...rendered.matchAll(/VNCATALOGARG(\d+)END/g)];
  if(!args.length||matches.length!==args.length||new Set(matches.map(match=>match[1])).size!==args.length)return null;
  const leading=control(rendered,0);if(!leading)return null;
  const strings:string[]=[],slots:number[]=[];let previous=0;
  for(const match of matches){strings.push(rendered.slice(previous,match.index));slots.push(Number(match[1]));previous=match.index+match[0].length;}strings.push(rendered.slice(previous));
  const arguments_:Argument[]=[];
  for(let i=0;i<slots.length;i++){
    const before=strings[i],after=strings[i+1],open=before.at(-1)??'',close=({'{':'}','[':']','(':')','|':'|'} as Record<string,string>)[open];
    if(!close||escaped(before,before.length-1)||!after.startsWith(close))return null;
    // Literal-parenthesis/bar arguments belong to physics Quantity, not to
    // arbitrary commands that happen to display ordinary parentheses.
    if((open==='('||open==='|')&&definition.type!=='physics-qty'&&!definition.type.startsWith('physics-qty'))return null;
    strings[i]=before.slice(0,-1);strings[i+1]=after.slice(1);
    const isPhysics=definition.type.startsWith('physics-');
    arguments_.push({kind:'argument',slot:slots[i],open,close,
      optional:open==='['&&/^x(?:[A-Za-z]+)$/.test(leading.name),
      atomic:open==='{'&&!isPhysics});
  }
  const parts:(Literal|Argument)[]=[];
  for(let i=0;i<slots.length;i++){parts.push({kind:'literal',source:strings[i]},arguments_[i]);}parts.push({kind:'literal',source:strings.at(-1)!});
  return {definition,parts,command:leading.name,slots:args.length};
}
let cachedLength=-1,templates:Template[]=[],unsupported:{type:string;reason:string}[]=[];
function registry():Template[]{
  if(cachedLength===catalog.length)return templates;
  cachedLength=catalog.length;templates=[];unsupported=[];
  for(const definition of catalog){
    const result=compile(definition);
    if(result)templates.push(result);
    else if(!definition.font&&!definition.operator&&!definition.matrixEnvironment&&!definition.rowEnvironment&&!definition.raw)
      unsupported.push({type:definition.type,reason:definition.type.startsWith('paren')?'Handled by fixed-size delimiter grammar':definition.type==='atop'?'Handled by explicit infix grammar':'No independent, fully delimited argument template'});
  }
  return templates;
}

/** The fallback list is explicit: unsupported templates are never inferred by slot count. */
export function texCatalogStructureCoverage():{supported:readonly string[];unsupported:readonly {type:string;reason:string}[]} {
  const known=registry();return {supported:known.map(template=>template.definition.type),unsupported:[...unsupported]};
}
function atomic(source:string,start:number):Bound|null {
  const i=skip(source,start),token=control(source,i);
  if(token){
    if(!symbols.some(entry=>entry.atom&&entry.command==='\\'+token.name&&entry.category!=='函数名称'))return null;
    return {body:source.slice(i,token.next),next:token.next};
  }
  const char=i<source.length?String.fromCodePoint(source.codePointAt(i)!):'';
  return !char||/[{}_^%#$&~[\]*]/.test(char)?null:{body:char,next:i+char.length};
}
function match(source:string,start:number,template:Template,parseRegion:ParseTexRegion,createNode:CreateTexNode):ParsedTexStructure|null {
  let i=start;const bodies=new Map<number,string>();
  for(const part of template.parts){
    if(part.kind==='literal'){const next=literal(source,i,part.source);if(next===null)return null;i=next;continue;}
    i=skip(source,i);let value=balanced(source,i,part.open,part.close,template.definition.type.startsWith('physics-qty'));
    if(!value&&part.optional&&source[i]!==part.open)value={body:'',next:i};
    if(!value&&part.atomic&&source[i]!==part.open)value=atomic(source,i);
    if(!value)return null;bodies.set(part.slot,value.body);i=value.next;
  }
  const regions:Region[]=[];
  for(let slot=0;slot<template.slots;slot++){const body=bodies.get(slot);if(body===undefined)return null;const parsed=parseRegion(body);if(!parsed)return null;regions.push(parsed);}
  return {node:createNode(template.definition.type,regions),next:i};
}

function fixedFence(source:string,start:number,parseRegion:ParseTexRegion,createNode:CreateTexNode):ParsedTexStructure|null {
  const first=control(source,start),names=['bigl','Bigl','biggl','Biggl'];if(!first||!names.includes(first.name))return null;
  let bodyStart=skip(source,first.next);if(source[bodyStart]!=='(')return null;bodyStart++;
  const expected=first.name.slice(0,-1)+'r',stack=[first.name];let i=bodyStart,braces=0;
  while(i<source.length){
    const ch=source[i];
    if(ch==='%'){const line=source.indexOf('\n',i);i=line<0?source.length:line+1;continue;}
    if(ch==='\\'){
      const token=control(source,i);if(!token)return null;
      if(token.name==='begin'){const bounds=scanTexEnvironment(source,i);if(!bounds)return null;i=bounds.next;continue;}
      if(token.name==='left'){const bounds=scanTexDelimiter(source,i);if(!bounds)return null;i=bounds.next;continue;}
      if(names.includes(token.name)){stack.push(token.name);i=token.next;continue;}
      if(['bigr','Bigr','biggr','Biggr'].includes(token.name)){
        const opening=stack.pop();if(!opening||opening.slice(0,-1)+'r'!==token.name)return null;
        if(!stack.length){
          const end=skip(source,token.next);if(braces||token.name!==expected||source[end]!==')')return null;
          const parsed=parseRegion(source.slice(bodyStart,i));if(!parsed)return null;
          return {node:createNode('paren'+first.name.slice(0,-1),[parsed]),next:end+1};
        }
      }
      i=token.next;continue;
    }
    if(ch==='{')braces++;else if(ch==='}'&&--braces<0)return null;i++;
  }
  return null;
}
function infixAtop(source:string,start:number,parseRegion:ParseTexRegion,createNode:CreateTexNode):ParsedTexStructure|null {
  const outer=balanced(source,start,'{','}');if(!outer)return null;
  let i=0,depth=0,separator:{start:number;end:number}|undefined;
  while(i<outer.body.length){
    const ch=outer.body[i];
    if(ch==='%'){const line=outer.body.indexOf('\n',i);i=line<0?outer.body.length:line+1;continue;}
    if(ch==='\\'){
      const token=control(outer.body,i);if(!token)return null;
      if(token.name==='begin'){const bounds=scanTexEnvironment(outer.body,i);if(!bounds)return null;i=bounds.next;continue;}
      if(!depth&&token.name==='atop'){if(separator)return null;separator={start:i,end:token.next};}
      i=token.next;continue;
    }
    if(ch==='{')depth++;else if(ch==='}')depth--;i++;
  }
  if(!separator)return null;
  const top=parseRegion(outer.body.slice(0,separator.start)),bottom=parseRegion(outer.body.slice(separator.end));
  return top&&bottom?{node:createNode('atop',[top,bottom]),next:outer.next}:null;
}
function substack(source:string,start:number,parseRegion:ParseTexRegion,createNode:CreateTexNode):ParsedTexStructure|null {
  const token=control(source,start);if(token?.name!=='substack')return null;
  const value=balanced(source,skip(source,token.next),'{','}');if(!value)return null;
  const synthetic='\\begin{subarray}{c}'+value.body+'\\end{subarray}';
  const parsed=parseTexEnvironment(synthetic,0,parseRegion,(type,regions,dimensions)=>createNode('substack',regions,dimensions));
  return parsed?{node:parsed.node,next:value.next}:null;
}

/** Match complete catalog-rendered syntax, not UI argument names or slot order. */
export function parseTexCatalogStructure(source:string,start:number,parseRegion:ParseTexRegion,createNode:CreateTexNode):ParsedTexStructure|null {
  if(source[start]==='{')return infixAtop(source,start,parseRegion,createNode);
  const token=control(source,start);if(!token)return null;
  if(['bigl','Bigl','biggl','Biggl'].includes(token.name))return fixedFence(source,start,parseRegion,createNode);
  if(token.name==='substack')return substack(source,start,parseRegion,createNode);
  let best:ParsedTexStructure|null=null;
  for(const template of registry()){
    const direct=template.command===token.name;
    if(!direct&&!template.definition.aliases?.includes(token.name))continue;
    const candidate=direct?template:{...template,parts:template.parts.map((part,index)=>index===0&&part.kind==='literal'?{...part,source:part.source.replace(/^\\[A-Za-z]+/,'\\'+token.name)}:part)};
    const result=match(source,start,candidate,parseRegion,createNode);
    // Longer explicit grammars (pdv mixed, expectation in a state) must win
    // before their shorter, otherwise valid operand-only prefixes.
    if(result&&(!best||result.next>best.next))best=result;
  }
  return best;
}

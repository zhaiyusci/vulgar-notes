// SPDX-License-Identifier: GPL-3.0-or-later
import {catalog,type Definition,type MathNode,type Region} from './editor-model';

export interface ParsedTexStructure {node:MathNode;next:number}
export interface TexEnvironmentBounds {name:string;bodyStart:number;bodyEnd:number;next:number}
export type ParseTexRegion=(source:string)=>Region|null;
export type CreateTexNode=(type:string,regions:Region[],dimensions?:{rows:number;columns:number})=>MathNode;

interface Control {name:string;next:number}
function control(source:string,start:number):Control|null {
  if(source[start]!=='\\'||start+1>=source.length)return null;
  const name=/^[A-Za-z]+/.exec(source.slice(start+1))?.[0]??source[start+1];
  return {name,next:start+1+name.length};
}
function commentEnd(source:string,start:number):number {
  const next=source.indexOf('\n',start);return next<0?source.length:next+1;
}
function skipSpace(source:string,start:number):number {
  let i=start;while(i<source.length){if(/\s/.test(source[i]))i++;else if(source[i]==='%')i=commentEnd(source,i);else break;}return i;
}
function group(source:string,start:number):{body:string;next:number}|null {
  if(source[start]!=='{')return null;
  let depth=1,i=start+1;
  while(i<source.length){
    if(source[i]==='%'){i=commentEnd(source,i);continue;}
    if(source[i]==='\\'){const token=control(source,i);if(!token)return null;i=token.next;continue;}
    if(source[i]==='{')depth++;
    else if(source[i]==='}'&&--depth===0)return {body:source.slice(start+1,i),next:i+1};
    i++;
  }
  return null;
}
function environmentTag(source:string,start:number):{kind:'begin'|'end';name:string;next:number}|null {
  const token=control(source,start);if(!token||token.name!=='begin'&&token.name!=='end')return null;
  const argument=group(source,skipSpace(source,token.next));
  if(!argument||!/^[A-Za-z][A-Za-z0-9_*@.-]*$/.test(argument.body))return null;
  return {kind:token.name,name:argument.body,next:argument.next};
}

/** Locate an entire balanced environment, including unknown ones for lossless fallback. */
export function scanTexEnvironment(source:string,start:number):TexEnvironmentBounds|null {
  const opening=environmentTag(source,start);if(!opening||opening.kind!=='begin')return null;
  const stack=[{name:opening.name,braceDepth:0}];let i=opening.next,braceDepth=0;
  while(i<source.length){
    const ch=source[i];
    if(ch==='%'){i=commentEnd(source,i);continue;}
    if(ch==='\\'){
      const token=control(source,i);if(!token)return null;
      if(['verb','verb*','verbdef','lstinline'].includes(token.name))return null;
      if(token.name==='begin'||token.name==='end'){
        const tag=environmentTag(source,i);if(!tag)return null;
        if(tag.kind==='begin')stack.push({name:tag.name,braceDepth});
        else {
          const current=stack.pop();if(!current||current.name!==tag.name||current.braceDepth!==braceDepth)return null;
          if(!stack.length)return {name:opening.name,bodyStart:opening.next,bodyEnd:i,next:tag.next};
        }
        i=tag.next;continue;
      }
      i=token.next;continue;
    }
    if(ch==='{')braceDepth++;
    else if(ch==='}'&&--braceDepth<0)return null;
    i++;
  }
  return null;
}

function option(source:string,start:number):{body:string;next:number}|null {
  const i=skipSpace(source,start);if(source[i]!=='[')return null;
  const end=source.indexOf(']',i+1);if(end<0)return null;
  const body=source.slice(i+1,end);if(/[\\{}[\n\r]/.test(body))return null;
  return {body,next:end+1};
}

function environmentDefinition(source:string,bounds:TexEnvironmentBounds):{definition:Definition;start:number;columns?:number}|null {
  let start=bounds.bodyStart;
  const name=bounds.name;
  if(name==='array'){
    const specification=group(source,skipSpace(source,start));if(!specification||!/^l+$/.test(specification.body))return null;
    const definition=catalog.find(entry=>entry.matrixEnvironment==='array'&&entry.matrixAlign==='l');
    return definition?{definition,start:specification.next,columns:specification.body.length}:null;
  }
  if(name==='pmatrix*'||name==='bmatrix*'){
    const at=skipSpace(source,start),alignment=option(source,start);
    if(source[at]==='['&&!alignment)return null;
    const align=alignment?.body??'c';if(!['l','c','r'].includes(align))return null;
    if(alignment)start=alignment.next;
    const definition=align==='c'?catalog.find(entry=>entry.matrixEnvironment===name.slice(0,-1)&&!entry.matrixAlign):
      catalog.find(entry=>entry.matrixEnvironment===name&&entry.matrixAlign===align);
    return definition?{definition,start}:null;
  }
  if(name==='subarray'||name==='alignedat'){
    const at=skipSpace(source,start);if(source[at]==='[')return null;
    const argument=group(source,at);if(!argument)return null;
    const required='{'+argument.body+'}',definition=catalog.find(entry=>entry.rowEnvironment===name&&entry.rowOptions===required);
    return definition?{definition,start:argument.next}:null;
  }
  // `substack` is a command, not an environment, despite sharing grid editing.
  const definition=catalog.find(entry=>entry.matrixEnvironment===name||entry.rowEnvironment===name&&name!=='substack'&&!entry.rowOptions);
  if(!definition)return null;
  if(['aligned','gathered','lgathered','rgathered','multlined'].includes(name)&&source[skipSpace(source,start)]==='[')return null;
  return {definition,start};
}

const unsupportedGridCommands=new Set(['hline','cline','hdashline','noalign','intertext','shortintertext','omit','multicolumn','multirow','arraystretch','tag','label','notag','nonumber']);
function splitGrid(source:string,start:number,end:number):string[][]|null {
  const rows:string[][]=[[]];let cellStart=start,i=start,depth=0,leftDepth=0;
  const finishCell=(at:number)=>{rows.at(-1)!.push(source.slice(cellStart,at));};
  while(i<end){
    const ch=source[i];
    if(ch==='%'){i=commentEnd(source,i);continue;}
    if(ch==='\\'){
      const token=control(source,i);if(!token)return null;
      if(['verb','verbdef','lstinline'].includes(token.name))return null;
      if(token.name==='begin'){
        const nested=scanTexEnvironment(source,i);if(!nested||nested.next>end)return null;i=nested.next;continue;
      }
      if(token.name==='end')return null;
      if(token.name==='left')leftDepth++;
      if(token.name==='right'&&--leftDepth<0)return null;
      if(depth===0&&unsupportedGridCommands.has(token.name))return null;
      if(depth===0&&(token.name==='\\'||token.name==='cr')){
        if(leftDepth)return null;
        const after=skipSpace(source,token.next);
        if(source[after]==='['||source[after]==='*')return null;
        finishCell(i);rows.push([]);i=token.next;cellStart=i;continue;
      }
      i=token.next;continue;
    }
    if(ch==='{')depth++;
    else if(ch==='}'&&--depth<0)return null;
    else if(ch==='&'&&depth===0){if(leftDepth)return null;finishCell(i);cellStart=i+1;}
    i++;
  }
  if(depth||leftDepth)return null;
  finishCell(end);
  // A final row terminator closes its row; it does not create another row.
  if(rows.length>1&&rows.at(-1)!.length===1&&skipSpace(rows.at(-1)![0],0)===rows.at(-1)![0].length)rows.pop();
  return rows;
}

/** Parse only layouts whose column/row semantics the existing catalog can represent. */
export function parseTexEnvironment(source:string,start:number,parseRegion:ParseTexRegion,createNode:CreateTexNode):ParsedTexStructure|null {
  const bounds=scanTexEnvironment(source,start);if(!bounds)return null;
  if(bounds.name==='numcases'||bounds.name==='subnumcases'){
    const lhs=group(source,skipSpace(source,bounds.bodyStart));if(!lhs||lhs.next>bounds.bodyEnd)return null;
    const rows=splitGrid(source,lhs.next,bounds.bodyEnd);if(!rows||rows.some(row=>row.length>2)||rows.length>50000)return null;
    const regions:Region[]=[];
    for(const row of rows)for(let column=0;column<2;column++){
      const parsed=parseRegion(column===1?'':row[column]??'');if(!parsed)return null;
      if(column===1){const text=parseRegion('');if(!text)return null;text.items=Array.from(row[column]??'');parsed.items=[createNode('case-text',[text])];}
      regions.push(parsed);
    }
    const left=parseRegion(lhs.body),body=parseRegion('');if(!left||!body)return null;
    body.items=[createNode('numbered-cases-body',regions,{rows:rows.length,columns:2})];
    return {node:createNode(bounds.name,[left,body]),next:bounds.next};
  }
  const layout=environmentDefinition(source,bounds);if(!layout||layout.start>bounds.bodyEnd)return null;
  const rows=splitGrid(source,layout.start,bounds.bodyEnd);if(!rows)return null;
  const actualColumns=rows.reduce((maximum,row)=>Math.max(maximum,row.length),1);
  const columns=layout.columns??(layout.definition.rowEnvironment?layout.definition.columns??1:actualColumns);
  if(actualColumns>columns||rows.length*columns>100000)return null;
  const regions:Region[]=[];
  for(const row of rows)for(let column=0;column<columns;column++){
    const parsed=parseRegion(row[column]??'');if(!parsed)return null;regions.push(parsed);
  }
  const node=createNode(layout.definition.type,regions,{rows:rows.length,columns});
  return {node,next:bounds.next};
}

const delimiterAliases:Record<string,string>={
  '(':'(',')':')','[':'[',']':']','{':'{','}':'}','|':'|','/':'/','.':'.',
  lbrace:'{',rbrace:'}',lbrack:'[',rbrack:']',lparen:'(',rparen:')',
  vert:'|',lvert:'|',rvert:'|',Vert:'||',lVert:'||',rVert:'||',
  langle:'<',rangle:'>',lfloor:'floorL',rfloor:'floorR',lceil:'ceilL',rceil:'ceilR',backslash:'backslash',
};
function delimiter(source:string,start:number):{value:string;next:number}|null {
  const at=skipSpace(source,start),token=source[at]==='\\'?control(source,at):null;
  const name=token?.name??source[at];if(!name)return null;
  // `|` is a single bar, while the control symbol `\|` is a double bar.
  // Unknown delimiter tokens remain scannable for whole-pair source fallback.
  const value=token?.name==='|'?'||':!token&&['{','}'].includes(name)?'raw:'+name:delimiterAliases[name]??'raw:'+name;
  return {value,next:token?.next??at+1};
}
const delimiterTypes:Record<string,string>={
  '(|)':'parens','[|]':'brackets','{|}':'braces','|||':'abs','|||||':'norm',
  '<|>':'angles','floorL|floorR':'floor','ceilL|ceilR':'ceil',
  '{|.':'leftBrace','.|}':'rightBrace','.||':'evaluation','/|/':'slashFence','backslash|backslash':'backslashFence',
};

/** Find an entire left/right pair, including unsupported pairs for source fallback. */
export function scanTexDelimiter(source:string,start:number):{bodyStart:number;bodyEnd:number;next:number;left:string;right:string}|null {
  const opening=control(source,start);if(opening?.name!=='left')return null;
  const left=delimiter(source,opening.next);if(!left)return null;
  let i=left.next,braceDepth=0;
  const stack=[0];
  while(i<source.length){
    const ch=source[i];
    if(ch==='%'){i=commentEnd(source,i);continue;}
    if(ch==='\\'){
      const token=control(source,i);if(!token)return null;
      if(['verb','verbdef','lstinline'].includes(token.name))return null;
      if(token.name==='begin'){
        const nested=scanTexEnvironment(source,i);if(!nested)return null;i=nested.next;continue;
      }
      if(token.name==='left'){
        const nested=delimiter(source,token.next);if(!nested)return null;stack.push(braceDepth);i=nested.next;continue;
      }
      if(token.name==='right'){
        if(stack.pop()!==braceDepth)return null;
        const right=delimiter(source,token.next);if(!right)return null;
        if(!stack.length)return {bodyStart:left.next,bodyEnd:i,next:right.next,left:left.value,right:right.value};
        i=right.next;continue;
      }
      i=token.next;continue;
    }
    if(ch==='{')braceDepth++;
    else if(ch==='}'&&--braceDepth<0)return null;
    i++;
  }
  return null;
}
export function parseTexDelimiter(source:string,start:number,parseRegion:ParseTexRegion,createNode:CreateTexNode):ParsedTexStructure|null {
  const bounds=scanTexDelimiter(source,start);if(!bounds)return null;
  const type=delimiterTypes[bounds.left+'|'+bounds.right];if(!type)return null;
  // A middle delimiter has no equivalent in the current one-region structures.
  const body=source.slice(bounds.bodyStart,bounds.bodyEnd);
  for(let i=0;i<body.length;){
    if(body[i]==='%'){i=commentEnd(body,i);continue;}
    if(body[i]==='\\'){const token=control(body,i);if(!token)return null;if(token.name==='middle')return null;i=token.next;}
    else i++;
  }
  const parsed=parseRegion(body);return parsed?{node:createNode(type,[parsed]),next:bounds.next}:null;
}

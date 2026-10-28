// SPDX-License-Identifier: GPL-3.0-or-later
import type {Definition,MathNode,Region} from './editor-model';

/** Options are kept as source, including their delimiters, never as math. */
export type TexLayoutOptionsKind='bracket'|'enclose';
type LayoutDefinition=Definition&{texOptionsKind?:TexLayoutOptionsKind};
type LayoutNode=MathNode&{texOptions?:string};
export type ParseTexLayoutRegion=(source:string)=>Region|null;
export type CreateTexLayoutNode=(type:string,regions:Region[])=>MathNode;
export interface ParsedTexLayoutStructure {node:MathNode;next:number}

interface Argument {body:string;next:number}
interface LayoutSyntax {
  command:string;arity:number;labels?:string[];options?:TexLayoutOptionsKind;
  quantity?:boolean;
}

// Audited against the installed MathJax 4.1.3 BaseMethods, MathtoolsMethods,
// BboxConfiguration, EncloseConfiguration, CenternotConfiguration and
// UnitsConfiguration. In particular the units package defines \units, not
// \unit, and nicefrac's optional argument is a formatter, not a quantity.
const syntax:readonly LayoutSyntax[]=[
  ...'phantom hphantom vphantom llap rlap mathord mathbin mathrel mathop mathopen mathclose mathinner mathpunct vcenter vtop vbox centernot mathmbox'.split(' ').map(command=>({command,arity:1})),
  ...'smash mathclap mathllap mathrlap cramped crampedclap crampedllap crampedrlap bbox'.split(' ').map(command=>({command,arity:1,options:'bracket' as const})),
  {command:'mathchoice',arity:4,labels:['Display style','Text style','Script style','Script-script style']},
  {command:'enclose',arity:1,options:'enclose'},
  {command:'units',arity:1},
  {command:'units',arity:2,quantity:true,labels:['Quantity','Unit']},
  {command:'unitfrac',arity:2,labels:['Numerator unit','Denominator unit']},
  {command:'unitfrac',arity:3,quantity:true,labels:['Quantity','Numerator unit','Denominator unit']},
  {command:'nicefrac',arity:2,options:'bracket',labels:['Numerator','Denominator']}
];
const byCommand=new Map(syntax.filter(entry=>!entry.quantity).map(entry=>[entry.command,entry]));
function typeOf(entry:LayoutSyntax):string {return 'layout-'+entry.command+(entry.quantity?'-quantity':'');}

/** Register imported layout regions without adding another large input panel. */
export function registerTexLayoutStructures(catalog:Definition[]):void {
  for(const entry of syntax){
    const type=typeOf(entry);if(catalog.some(definition=>definition.type===type))continue;
    const command='\\'+entry.command;
    const render=(regions:string[])=>{
      if(entry.quantity)return command+'['+regions[0]+']'+regions.slice(1).map(body=>'{'+body+'}').join('');
      const prefix=entry.command==='enclose'?'{box}':'';
      return command+prefix+regions.map(body=>'{'+body+'}').join('');
    };
    const definition:LayoutDefinition={
      type,label:command,category:'重音与修饰',labels:entry.labels??Array.from({length:entry.arity},(_,i)=>entry.arity===1?'Content':'Argument '+(i+1)),
      command,render,selectedIndex:0,hidden:true,commandCandidate:!entry.quantity,
      // Adding a grouping atom around mathop/mathrel would change its class.
      ungroupScriptBase:true,...(entry.options?{texOptionsKind:entry.options}:{})
    };
    catalog.push(definition);
  }
}

function skipSpace(source:string,start:number):number {
  while(start<source.length&&/\s/.test(source[start]))start++;
  return start;
}
/** Match GetArgument's literal brace scan, including escaped control symbols. */
function group(source:string,start:number):Argument|null {
  if(source[start]!=='{')return null;
  let depth=1;
  for(let i=start+1;i<source.length;i++){
    if(source[i]==='\\'){if(++i>=source.length)return null;continue;}
    if(source[i]==='{')depth++;
    else if(source[i]==='}'&&--depth===0)return {body:source.slice(start+1,i),next:i+1};
  }
  return null;
}
/** MathJax GetBrackets closes on the first unbraced, unescaped right bracket.
 * A second unbraced left bracket is deliberately refused, rather than treating
 * it as a balanced nested option that MathJax would consume differently. */
function bracket(source:string,start:number):Argument|null {
  if(source[start]!=='[')return null;
  let braces=0;
  for(let i=start+1;i<source.length;i++){
    if(source[i]==='\\'){if(++i>=source.length)return null;continue;}
    if(source[i]==='{')braces++;
    else if(source[i]==='}'&&--braces<0)return null;
    else if(!braces){
      if(source[i]==='[')return null;
      if(source[i]===']')return {body:source.slice(start+1,i),next:i+1};
    }
  }
  return null;
}

/** Validate saved option source without accepting an extra math argument/tail. */
export function validateTexLayoutOptions(kind:TexLayoutOptionsKind,value:unknown):value is string {
  if(typeof value!=='string')return false;
  if(kind==='bracket')return bracket(value,0)?.next===value.length;
  if(kind!=='enclose')return false;
  const notation=group(value,0);if(!notation)return false;
  const at=skipSpace(value,notation.next);
  return at===value.length||bracket(value,at)?.next===value.length;
}

function validBBox(body:string):boolean {
  let padding=false,background=false,style=false;
  for(const value of body.split(',')){
    const part=value.trim();if(!part)continue;
    if(/^(\.\d+|\d+(\.\d*)?)(pt|em|ex|mu|px|in|cm|mm)$/.test(part)){
      if(padding)return false;padding=true;
    }else if(/^([a-z0-9]+|#[0-9a-f]{6}|#[0-9a-f]{3})$/i.test(part)){
      if(background)return false;background=true;
    }else if(/^[-a-z]+:/i.test(part)){
      if(style)return false;style=true;
    }else return false;
  }
  return true;
}
const nicefracFormatters=/^\\(?:mathnormal|mathrm|mathit|mathbf|mathbfit|mathsf|mathsfit|mathbfsf|mathbfsfit|mathtt|mathbb|mathcal|mathscr|mathfrak|boldsymbol|symnormal|symup|symit|symbf|symbfit|symsf|symsfit|symbfsf|symbfsfit|symtt|symbb|symcal|symscr|symfrak)\s*$/;

/** Parse only explicit, fully delimited argument lists. An incomplete wrapper
 * never consumes the following +, script, or adjacent expression as an arg. */
export function parseTexLayoutStructure(source:string,start:number,parseRegion:ParseTexLayoutRegion,createNode:CreateTexLayoutNode):ParsedTexLayoutStructure|null {
  if(source[start]!=='\\')return null;
  const command=/^[A-Za-z]+/.exec(source.slice(start+1))?.[0];
  if(!command)return null;
  let entry=byCommand.get(command);if(!entry)return null;
  let at=skipSpace(source,start+1+command.length),options:string|undefined,quantity:string|undefined;
  if(entry.options==='enclose'){
    const notation=group(source,at);if(!notation)return null;
    const endNotation=notation.next,attributeStart=skipSpace(source,endNotation);
    let end=endNotation;
    if(source[attributeStart]==='['){const attrs=bracket(source,attributeStart);if(!attrs)return null;end=attrs.next;}
    options=source.slice(at,end);at=skipSpace(source,end);
  }else if(source[at]==='['&&(entry.options==='bracket'||command==='units'||command==='unitfrac')){
    const option=bracket(source,at);if(!option)return null;
    if(command==='units'||command==='unitfrac'){
      quantity=option.body;entry=syntax.find(candidate=>candidate.command===command&&candidate.quantity)!;
    }else{
      options=source.slice(at,option.next);
      if(command==='bbox'&&!validBBox(option.body))return null;
      // The formatter is run against each mathematical argument by upstream.
      // Unknown macros could inspect raw tokens rather than merely style them.
      if(command==='nicefrac'&&!nicefracFormatters.test(option.body.trim()))return null;
    }
    at=skipSpace(source,option.next);
  }
  const argumentsSource:string[]=[];
  if(quantity!==undefined)argumentsSource.push(quantity);
  while(argumentsSource.length<entry.arity){
    const argument=group(source,at);if(!argument)return null;
    argumentsSource.push(argument.body);at=skipSpace(source,argument.next);
    // Do not consume whitespace after the last argument. It may terminate a
    // later source command when the surrounding converter preserves a tail.
    if(argumentsSource.length===entry.arity)at=argument.next;
  }
  const regions:Region[]=[];
  for(const argument of argumentsSource){const parsed=parseRegion(argument);if(!parsed)return null;regions.push(parsed);}
  const node=createNode(typeOf(entry),regions) as LayoutNode;
  if(options!==undefined)node.texOptions=options;
  return {node,next:at};
}

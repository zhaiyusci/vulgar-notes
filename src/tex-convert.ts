// SPDX-License-Identifier: GPL-3.0-or-later
import {EditorModel,catalog,symbols,type Definition,type MathItem,type MathNode,type Region,type ScriptSlot} from './editor-model';
import {fontDiagnostic} from './font-diagnostics';
import {preferredMathCommand} from './letter-variants';
import {importMath} from './tex-import';
import {parseTexDelimiter,parseTexEnvironment,scanTexDelimiter,scanTexEnvironment} from './tex-import-environments';
import {mathFunction,mathFunctions} from './math-functions';
import {textSymbolValue} from './text-symbols';
import {parseTexLayoutStructure} from './tex-layout-structures';
import {parseTexCatalogStructure} from './tex-structure-grammar';
import {parseTexSideSet} from './tex-sideset';

interface Argument {body:string;next:number;braced:boolean}
interface Term {items:MathItem[];next:number;scriptable:boolean;operator?:MathNode;prefix?:MathItem[]}
interface Syntax {type:string;arity:number;order?:number[]}

const syntax:Record<string,Syntax>=Object.create(null);
for(const name of ['frac','dfrac','tfrac','binom','dbinom','tbinom','splitfrac','splitdfrac'])syntax[name]={type:name,arity:2};
for(const name of ['hat','widehat','tilde','widetilde','bar','overline','underline','acute','grave','breve','check','mathring','dot','ddot','dddot','ddddot','overrightarrow','overleftarrow','overleftrightarrow','underrightarrow','underleftarrow','underleftrightarrow','boxed','cancel','bcancel','xcancel'])syntax[name]={type:name,arity:1};
syntax.vec={type:'vector',arity:1};
syntax.overset={type:'overset',arity:2,order:[1,0]};
syntax.underset={type:'underset',arity:2,order:[1,0]};
syntax.cancelto={type:'cancelto',arity:2,order:[1,0]};
syntax.prescript={type:'prescript',arity:3,order:[2,0,1]};
for(const [name,arity] of Object.entries({dv:2,pdv:2,fdv:2,dd:1,var:1,vb:1,va:1,vu:1,grad:1,divergence:1,curl:1,laplacian:1,bra:1,ket:1,expval:1,abs:1,norm:1,ev:1,order:1,braket:2,ketbra:2,comm:2,acomm:2,pb:2,flatfrac:2,mel:3}))syntax[name]={type:'physics-'+name,arity};

const aliases:Record<string,string>={to:'rightarrow',gets:'leftarrow',ne:'neq',le:'leq',ge:'geq',divsymbol:'divisionsymbol'};
const ordinaryCommands=new Set(('alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa varkappa lambda mu nu xi omicron pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega infty partial nabla emptyset varnothing aleph hbar ell imath jmath wp prime backprime').split(' '));
const scopeCommands=new Set(('def gdef edef xdef let futurelet newcommand renewcommand providecommand DeclareMathOperator newenvironment renewenvironment catcode global long outer csname endcsname begingroup endgroup rm bf it cal tt sf displaystyle textstyle scriptstyle scriptscriptstyle color char mathchar Uchar Umathchar count dimen skip muskip advance multiply divide').split(' '));
const infixCommands=new Set(['over','atop','choose','above','overwithdelims','atopwithdelims','abovewithdelims']);
const knownSourceCommands=new Set(('text operatorname boldsymbol verb lstinline quad qquad enspace thinspace negthinspace hspace kern mkern mspace phantom hphantom vphantom smash mathclap mathllap mathrlap overbrace underbrace overbracket underbracket xrightarrow xleftarrow xleftrightarrow xRightarrow xLeftarrow xLeftrightarrow xhookleftarrow xhookrightarrow xmapsto xleftharpoonup xleftharpoondown xrightharpoonup xrightharpoondown xleftrightharpoons xrightleftharpoons xlongleftarrow xlongrightarrow xLongleftarrow xLongrightarrow').split(' '));

function control(source:string,start:number):{name:string;next:number}|null {
  if(source[start]!=='\\'||start+1>=source.length)return null;
  const name=/^[A-Za-z]+/.exec(source.slice(start+1))?.[0]??String.fromCodePoint(source.codePointAt(start+1)!);
  return {name,next:start+1+name.length};
}
function whitespace(source:string,start:number):number {while(start<source.length&&/\s/.test(source[start]))start++;return start;}
function commentEnd(source:string,start:number):number {const next=source.indexOf('\n',start);return next<0?source.length:next+1;}
function balanced(source:string,start:number,opening='{',closing='}'):Argument|null {
  if(source[start]!==opening)return null;
  let depth=1,braces=0,i=start+1;
  while(i<source.length){
    const ch=source[i];
    if(ch==='%'){i=commentEnd(source,i);continue;}
    if(ch==='\\'){const token=control(source,i);if(!token)return null;i=token.next;continue;}
    if(opening!=='{'){
      if(ch==='{'){braces++;i++;continue;}
      if(ch==='}'){if(--braces<0)return null;i++;continue;}
    }
    if(!braces&&ch===opening)depth++;
    else if(!braces&&ch===closing&&--depth===0)return {body:source.slice(start+1,i),next:i+1,braced:true};
    i++;
  }
  return null;
}
function argument(source:string,start:number):Argument|null {
  const i=whitespace(source,start);if(i>=source.length||/[}^_%#$&]/.test(source[i]))return null;
  if(source[i]==='{')return balanced(source,i);
  if(source[i]==='\\'){
    const token=control(source,i);if(!token)return null;
    // A bare argument is one token. Do not recursively consume a command that
    // itself needs arguments or changes scope in this token-only position.
    if(Object.hasOwn(syntax,token.name)||token.name==='sqrt'||token.name==='cfrac'||scopeCommands.has(token.name))return null;
    return {body:source.slice(i,token.next),next:token.next,braced:false};
  }
  const char=String.fromCodePoint(source.codePointAt(i)!);return {body:char,next:i+char.length,braced:false};
}

/** Capture a complete unknown command and adjacent explicit argument groups. */
function commandEnd(source:string,start:number):number {
  const token=control(source,start);if(!token)return source.length;
  let i=token.next;
  if(['verb','lstinline'].includes(token.name)){
    if(source[i]==='*')i++;
    const delimiter=source[i];if(!delimiter||/[\r\n]/.test(delimiter))return source.length;
    const end=source.indexOf(delimiter,i+1),line=source.slice(i+1,end<0?source.length:end);
    return end<0||/[\r\n]/.test(line)?source.length:whitespace(source,end+1);
  }
  if(source[i]==='*')i++;
  for(;;){
    i=whitespace(source,i);
    const group=source[i]==='{'?balanced(source,i):source[i]==='['?balanced(source,i,'[',']'):null;
    if(source[i]==='{'||source[i]==='['){if(!group)return source.length;i=group.next;continue;}
    return i;
  }
}

function plainText(body:string):string|null {
  let value='',i=0;
  while(i<body.length){
    if(/[{}$%#&_^~]/.test(body[i]))return null;
    if(body[i]!=='\\'){value+=String.fromCodePoint(body.codePointAt(i)!);i+=String.fromCodePoint(body.codePointAt(i)!).length;continue;}
    const token=control(body,i);if(!token)return null;
    if('%#$&{}_'.includes(token.name)&&token.name.length===1){value+=token.name;i=token.next;continue;}
    const escaped:Record<string,string>={textbackslash:'\\',textasciicircum:'^',textasciitilde:'~'};
    if(Object.hasOwn(escaped,token.name)&&body.slice(token.next,token.next+2)==='{}'){value+=escaped[token.name];i=token.next+2;continue;}
    const character=textSymbolValue(token.name);
    if(character!==undefined){value+=character;i=token.next;if(body.slice(i,i+2)==='{}')i+=2;else i=whitespace(body,i);continue;}
    return null;
  }
  return value;
}

/**
 * Convert supported parts of a complete TeX expression. Unsupported syntax is
 * kept as local, verbatim source nodes rather than discarding adjacent editable
 * structures. This is an input/import operation, never a per-keystroke pass.
 */
export function convertMath(source:string):EditorModel {
  // The conservative parser predates physics' argument-taking functions. Its
  // atom-only fast path must not reinterpret optional function exponents.
  const hasFunction=[...source.matchAll(/\\([A-Za-z]+)/g)].some(match=>!!mathFunction(match[1]));
  const strict=hasFunction?null:importMath(source);if(strict)return strict;
  const model=new EditorModel();let serial=200000000,depth=0;
  const region=(items:MathItem[],slot?:ScriptSlot):Region=>({id:'r'+ ++serial,label:'Content',items,...(slot?{slot}:{})});
  const node=(type:string,regions:Region[],dimensions?:{rows:number;columns:number}):MathNode=>({id:'n'+ ++serial,type,regions,...dimensions});
  const opaque=(value:string):MathNode=>node('source-tex',[region(Array.from(value))]);
  const atom=(definition:Definition):MathNode=>({id:'n'+ ++serial,type:definition.type,atom:true,regions:[]});
  const symbol=(name:string)=>symbols.find(definition=>definition.command==='\\'+name);
  const font=(name:string,body:string):MathItem[]|null=>{
    const definition=catalog.find(entry=>entry.font&&(entry.command==='\\'+name||entry.aliases?.includes(name)));
    if(!definition)return null;
    const canonical=definition.command.slice(1)==='symrm'?'symup':definition.command.slice(1);
    if(!canonical.startsWith('sym')&&canonical!=='boldsymbol')return null;
    let i=0;const bases:Definition[]=[];
    while(i<body.length){
      i=whitespace(body,i);if(i>=body.length)break;
      let base:Definition|undefined;
      if(body[i]==='\\'){const token=control(body,i);if(!token)return null;base=symbol(token.name);i=token.next;}
      else {const char=String.fromCodePoint(body.codePointAt(i)!);base=symbols.find(entry=>entry.letter===char&&entry.variantOf===entry.type);i+=char.length;}
      if(!base?.letter||base.variantOf!==base.type)return null;bases.push(base);
    }
    // Even an empty math-font group is an Ord atom in TeX. Dropping it can
    // reclassify neighboring binary operators, so retain the original command.
    if(!bases.length)return null;
    const result:MathItem[]=[];
    for(const base of bases){
      if(canonical==='boldsymbol'){
        const variant=symbols.find(entry=>entry.type===base.type+'--boldsymbol');
        if(!variant)return null;result.push(atom(variant));continue;
      }
      if(canonical==='symnormal'){result.push(atom(base));continue;}
      if(fontDiagnostic('\\'+canonical,base.letter!))return null;
      const desired='\\'+preferredMathCommand(canonical)+'{'+base.tex!.trim()+'}';
      const variant=symbols.find(entry=>entry.variantOf===base.type&&entry.equivalentTex?.includes(desired));
      if(!variant)return null;result.push(atom(variant));
    }
    return result;
  };
  const parseRegion=(text:string):Region|null=>{
    if(++depth>100){depth--;return region([opaque(text)]);}
    try{return region(sequence(text));}finally{depth--;}
  };
  const parseArguments=(text:string,start:number,count:number):{regions:Region[];next:number}|null=>{
    let i=start;const regions:Region[]=[];
    for(let j=0;j<count;j++){
      const value=argument(text,i);if(!value)return null;
      const parsed=parseRegion(value.body);if(!parsed)return null;regions.push(parsed);i=value.next;
    }
    return {regions,next:i};
  };
  const sequence=(text:string):MathItem[]=>{
    const items:MathItem[]=[];let i=0;
    const term=(start:number):Term=>{
      const ch=String.fromCodePoint(text.codePointAt(start)!);
      if(ch==='\\'||ch==='{'){
        const sideSet=parseTexSideSet(text,start,parseRegion,node);
        if(sideSet)return {items:[sideSet.node],next:sideSet.next,scriptable:false};
        const catalogStructure=parseTexCatalogStructure(text,start,parseRegion,node);
        if(catalogStructure)return {items:[catalogStructure.node],next:catalogStructure.next,scriptable:true};
      }
      if(ch==='{'){
        const group=balanced(text,start);if(!group)return {items:[opaque(text.slice(start))],next:text.length,scriptable:false};
        return {items:[node('tex-group',[parseRegion(group.body)!])],next:group.next,scriptable:true};
      }
      if(ch!=='\\'){
        if(ch==='%'){const next=commentEnd(text,start);return {items:[opaque(text.slice(start,next))],next,scriptable:false};}
        if(/[}^_$#&]/.test(ch))return {items:[opaque(text.slice(start))],next:text.length,scriptable:false};
        if(ch==='~')return {items:[opaque(ch)],next:start+1,scriptable:false};
        return {items:[ch],next:start+ch.length,scriptable:true};
      }
      const token=control(text,start);if(!token)return {items:[opaque(text.slice(start))],next:text.length,scriptable:false};
      const name=token.name;
      if(scopeCommands.has(name))return {items:[opaque(text.slice(start))],next:text.length,scriptable:false};
      if(name==='begin'){
        const parsed=parseTexEnvironment(text,start,parseRegion,node);if(parsed)return {items:[parsed.node],next:parsed.next,scriptable:true};
        const boundary=scanTexEnvironment(text,start),next=boundary?.next??text.length;
        return {items:[opaque(text.slice(start,next))],next,scriptable:false};
      }
      if(name==='left'){
        const parsed=parseTexDelimiter(text,start,parseRegion,node);if(parsed)return {items:[parsed.node],next:parsed.next,scriptable:true};
        const boundary=scanTexDelimiter(text,start),next=boundary?.next??text.length;
        return {items:[opaque(text.slice(start,next))],next,scriptable:false};
      }
      if(name==='end'||name==='right'||name==='middle')return {items:[opaque(text.slice(start))],next:text.length,scriptable:false};
      const layout=parseTexLayoutStructure(text,start,parseRegion,node);
      if(layout)return {items:[layout.node],next:layout.next,scriptable:true};
      const immediate=whitespace(text,token.next),hasOption=text[immediate]==='['||text[token.next]==='*';
      if(!hasOption&&['textnormal','ce','pu'].includes(name)){
        const value=argument(text,token.next);
        if(value?.braced){
          const raw=name==='textnormal'?plainText(value.body):value.body;
          if(raw!==null)return {items:[node(name==='textnormal'?'text-normal':'chem-'+name,[region(Array.from(raw))])],next:value.next,scriptable:true};
        }
      }
      if(!hasOption&&name==='operatorname'){
        const value=argument(text,token.next);
        const definition=value?.braced?catalog.find(entry=>entry.type==='function-operatorname-'+value.body):undefined;
        if(definition&&value){const operator=node(definition.type,[]);operator.operatorLayout=true;return {items:[operator],next:value.next,scriptable:true,operator};}
      }
      if(!hasOption&&catalog.some(entry=>entry.font&&(entry.command==='\\'+name||entry.aliases?.includes(name)))){
        const value=argument(text,token.next),converted=value?font(name,value.body):null;
        if(converted&&value)return {items:converted,next:value.next,scriptable:true};
      }
      if(name==='sqrt'){
        let index:Region|undefined,at=immediate;
        if(text[at]==='['){const option=balanced(text,at,'[',']');if(option){index=parseRegion(option.body)!;at=option.next;}else return {items:[opaque(text.slice(start))],next:text.length,scriptable:false};}
        if(text[token.next]!=='*'){
          const values=parseArguments(text,at,1);
          if(values)return {items:[node(index?'nthroot':'sqrt',index?[values.regions[0],index]:values.regions)],next:values.next,scriptable:true};
        }
      }
      if(name==='cfrac'&&text[token.next]!=='*'){
        let type='cfrac',at=immediate,valid=true;
        if(text[at]==='['){const option=balanced(text,at,'[',']');if(option&&['l','r'].includes(option.body)){type+=option.body;at=option.next;}else valid=false;}
        const values=valid?parseArguments(text,at,2):null;
        if(values)return {items:[node(type,values.regions)],next:values.next,scriptable:true};
      }
      if(!hasOption&&Object.hasOwn(syntax,name)){
        const grammar=syntax[name];
        // physics uses optional braced arguments: an absent denominator is not
        // the following +, relation, or expression token. Only its explicit
        // fully braced form has the exact fixed-slot grammar represented here.
        let braced=true,at=token.next;
        if(grammar.type.startsWith('physics-'))for(let j=0;j<grammar.arity;j++){
          at=whitespace(text,at);const group=balanced(text,at);if(!group){braced=false;break;}at=group.next;
        }
        const values=braced?parseArguments(text,token.next,grammar.arity):null;
        if(values)return {items:[node(grammar.type,(grammar.order??values.regions.map((_,j)=>j)).map(j=>values.regions[j]))],next:values.next,scriptable:true};
      }
      const operatorDefinition=catalog.find(entry=>entry.operator&&entry.operatorCommand===name&&!entry.operatorPlacement&&entry.type!=='sideset');
      const functionGrammar=mathFunction(name);
      const functionDefinition=functionGrammar?catalog.find(entry=>entry.type==='function-'+functionGrammar.name):undefined;
      if(operatorDefinition||functionDefinition){
        let definition=(operatorDefinition??functionDefinition)!,at=immediate;
        let exponent:Region|undefined;
        if(functionGrammar?.optionalExponent&&text[at]==='['){
          const option=balanced(text,at,'[',']');
          if(!option)return {items:[opaque(text.slice(start))],next:text.length,scriptable:false};
          exponent=parseRegion(option.body)!;exponent.slot='upper';at=whitespace(text,option.next);
          definition=catalog.find(entry=>entry.type===definition.type+'-exponent')!;
        }
        const displayPlacement=/^\\displaylimits(?![A-Za-z])/.exec(text.slice(at));
        if(displayPlacement)return {items:[opaque(text.slice(start,at+displayPlacement[0].length))],next:at+displayPlacement[0].length,scriptable:false};
        const placement=/^\\(limits|nolimits)(?![A-Za-z])/.exec(text.slice(at));
        if(placement){const variant=catalog.find(entry=>entry.operator&&entry.operatorCommand===name&&entry.operatorPlacement==='\\'+placement[1]);if(variant){definition=variant;at+=placement[0].length;}else return {items:[opaque(text.slice(start,at+placement[0].length))],next:at+placement[0].length,scriptable:false};}
        const operator=node(definition.type,exponent?[exponent]:[]);operator.operatorLayout=true;
        if(functionGrammar?.automaticParentheses&&text[at]==='('){
          const group=balanced(text,at,'(',')');
          if(!group)return {items:[opaque(text.slice(start))],next:text.length,scriptable:false};
          return {prefix:[operator],items:[node('physics-auto-parens',[parseRegion(group.body)!])],next:group.next,scriptable:true};
        }
        return {items:[operator],next:at,scriptable:true,operator};
      }
      const mapped=Object.hasOwn(aliases,name)?aliases[name]:name,definition=symbol(mapped);
      if(definition&&!hasOption)return {items:[atom(definition)],next:token.next,scriptable:ordinaryCommands.has(mapped)||!!definition.letter||!!definition.ungroupScriptBase};
      if(name.length===1&&'%#$&{}_ '.includes(name))return {items:[name],next:token.next,scriptable:true};
      const fontDefinition=catalog.find(entry=>entry.font&&(entry.command==='\\'+name||entry.aliases?.includes(name)));
      const known=Object.hasOwn(syntax,name)||fontDefinition||['sqrt','cfrac','textnormal','ce','pu'].includes(name)||knownSourceCommands.has(name)||name.length===1&&',;:!>'.includes(name);
      // An unknown macro may inspect unbraced following tokens or change their
      // catcodes. Converting that tail could therefore change its meaning. Its
      // current region stays verbatim; enclosing known structures still edit.
      let next=known?commandEnd(text,start):text.length;
      if(!hasOption&&(fontDefinition||name==='text'||name==='operatorname'||name==='textnormal'||name==='ce'||name==='pu'))next=argument(text,token.next)?.next??next;
      return {items:[opaque(text.slice(start,next))],next,scriptable:false};
    };
    while(i<text.length){
      i=whitespace(text,i);if(i>=text.length)break;
      const token=text[i]==='\\'?control(text,i):null;
      if(token&&infixCommands.has(token.name))return [opaque(text)];
      const start=i,value=term(i);i=whitespace(text,value.next);
      let upper:Region|undefined,lower:Region|undefined,hasScript=false,invalid=false;
      while(i<text.length&&(text[i]==='^'||text[i]==='_'||text[i]==="'")){
        hasScript=true;
        if(text[i]==="'"){
          if(upper){invalid=true;break;}
          const primes:MathItem[]=[];while(text[i]==="'"){primes.push(atom(symbols.find(entry=>entry.type==='symbol-prime')!));i++;}upper=region(primes);
        }else{
          const isUpper=text[i++]==='^';if(isUpper?upper!==undefined:lower!==undefined){invalid=true;break;}
          const argumentValue=argument(text,i);if(!argumentValue){invalid=true;break;}
          const parsed=parseRegion(argumentValue.body)!;if(isUpper)upper=parsed;else lower=parsed;i=argumentValue.next;
        }
        i=whitespace(text,i);
      }
      if(invalid){items.push(opaque(text.slice(start)));break;}
      if(hasScript&&!value.scriptable){items.push(opaque(text.slice(start,i)));continue;}
      if(value.prefix)items.push(...value.prefix);
      // A script renderer supplies the base's braces itself. Replace one
      // explicit group by that same boundary instead of accumulating extra
      // groups every time exported TeX is converted again.
      const sole=value.items.length===1?value.items[0]:null;
      const baseItems=sole&&typeof sole!=='string'&&sole.type==='tex-group'?sole.regions[0].items:value.items;
      if(value.operator){
        if(lower&&value.operator.regions.some(region=>region.slot==='lower')||upper&&value.operator.regions.some(region=>region.slot==='upper')){items.push(opaque(text.slice(start,i)));continue;}
        if(lower){lower.slot='lower';value.operator.regions.push(lower);}
        if(upper){upper.slot='upper';value.operator.regions.push(upper);}
        items.push(value.operator);
      }else if(lower&&upper)items.push(node('sup',[region(baseItems),lower,upper]));
      else if(lower||upper)items.push(node(upper?'power':'subscript',[region(baseItems),(upper??lower)!]));
      else items.push(...value.items);
    }
    return items;
  };
  try{
    model.root=parseRegion(source)!;model.index();model.setCursor(model.root.id,0);
    // This remains a persisted-data boundary even when a helper is extended.
    model.restore(model.snapshot());return model;
  }catch{
    model.root=region([opaque(source)]);model.index();model.setCursor(model.root.id,0);return model;
  }
}

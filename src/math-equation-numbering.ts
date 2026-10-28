// SPDX-License-Identifier: GPL-3.0-or-later
export interface EquationNumbering {
  readonly count:number;
  readonly referenceOffset:number;
  readonly referenceSuffix:string;
}
const ordinary:EquationNumbering=Object.freeze({count:1,referenceOffset:0,referenceSuffix:''});
interface InferredNumbering {numbering:EquationNumbering;labelOffset:number|null;trailingCaseSeparator?:number}
const fallback:InferredNumbering={numbering:ordinary,labelOffset:null};
const cache=new Map<string,InferredNumbering>();
const cacheLimit=128;
interface Token {name:string;next:number}
interface Group {body:string;next:number}
function control(source:string,start:number):Token|null {
  if(source[start]!=='\\'||start+1>=source.length)return null;
  const name=/^[A-Za-z]+/.exec(source.slice(start+1))?.[0]??source[start+1];
  return {name,next:start+1+name.length};
}
function commentEnd(source:string,start:number):number {
  const relative=source.slice(start).search(/[\r\n]/);if(relative<0)return source.length;
  const end=start+relative;return end+(source[end]==='\r'&&source[end+1]==='\n'?2:1);
}
function skipSpace(source:string,start:number):number {
  while(start<source.length){
    if(/\s/.test(source[start]))start++;
    else if(source[start]==='%')start=commentEnd(source,start);
    else break;
  }
  return start;
}
function group(source:string,start:number):Group|null {
  if(source[start]!=='{')return null;
  let depth=1;
  for(let at=start+1;at<source.length;at++){
    if(source[at]==='%'){at=commentEnd(source,at)-1;continue;}
    if(source[at]==='\\'){const token=control(source,at);if(!token)return null;at=token.next-1;continue;}
    if(source[at]==='{')depth++;
    else if(source[at]==='}'&&--depth===0)return {body:source.slice(start+1,at),next:at+1};
  }
  return null;
}
function environmentTag(source:string,start:number):{kind:'begin'|'end';name:string;next:number}|null {
  const token=control(source,start);if(!token||token.name!=='begin'&&token.name!=='end')return null;
  const name=group(source,skipSpace(source,token.next));
  if(!name||!/^[A-Za-z][A-Za-z0-9_*@.-]*$/.test(name.body))return null;
  return {kind:token.name,name:name.body,next:name.next};
}
const manualNumbering=new Set(['tag','notag','nonumber','tag*','numberwithin','setcounter','addtocounter','stepcounter','refstepcounter',
  'newcommand','renewcommand','providecommand','def','gdef','edef','xdef','let','newenvironment','renewenvironment']);
const literalScanners=new Set(['verb','verbdef','lstinline']);
const rowNumbered=new Set(['numcases','subnumcases','align','gather','alignat','flalign','eqnarray']);
const oneNumbered=new Set(['equation','multline']);
function bracket(source:string,start:number):Group|null {
  if(source[start]!=='[')return null;
  let braces=0;
  for(let at=start+1;at<source.length;at++){
    if(source[at]==='\\'){const token=control(source,at);if(!token)return null;at=token.next-1;continue;}
    if(source[at]==='{')braces++;
    else if(source[at]==='}'&&--braces<0)return null;
    else if(!braces&&source[at]==='[')return null;
    else if(!braces&&source[at]===']')return {body:source.slice(start+1,at),next:at+1};
  }
  return null;
}

/** Only plain, complete numbered-cases environments have inferred multi-tag
 * consumption. Standard complete display environments follow their specified
 * row or single-tag behavior. User-defined tags, counter changes, macros,
 * or malformed/embedded environments deliberately use the ordinary one-number
 * result; this helper does not interpret arbitrary TeX numbering programs. */
function infer(source:string):InferredNumbering {
  const start=skipSpace(source,0),opening=environmentTag(source,start);
  if(!opening||opening.kind!=='begin')return fallback;
  // Counter-changing constructs anywhere, including the cases left-hand side
  // or an empheq option, make static row-number inference unreliable.
  for(let cursor=0;cursor<source.length;cursor++){
    if(source[cursor]==='%'){cursor=commentEnd(source,cursor)-1;continue;}
    if(source[cursor]==='\\'){
      const token=control(source,cursor);if(!token)return fallback;
      if(manualNumbering.has(token.name)||literalScanners.has(token.name)||token.name==='cr')return fallback;
      cursor=token.next-1;
    }
  }
  let at=skipSpace(source,opening.next),effective=opening.name;
  if(effective==='empheq'){
    if(source[at]==='['){const options=bracket(source,at);if(!options)return fallback;at=skipSpace(source,options.next);}
    const environment=group(source,at);if(!environment)return fallback;
    effective=environment.body;
    if(!/^(?:align|gather|flalign|equation|multline)\*?$/.test(effective))return fallback;
    at=environment.next;
  }
  const starred=effective.endsWith('*'),base=starred?effective.slice(0,-1):effective;
  if(!rowNumbered.has(base)&&!oneNumbered.has(base))return fallback;
  if(starred&&(base==='numcases'||base==='subnumcases'))return fallback;
  if(base==='numcases'||base==='subnumcases'){
    const lhs=group(source,skipSpace(source,at));if(!lhs)return fallback;at=lhs.next;
  }else if(base==='alignat'){
    const columns=group(source,skipSpace(source,at));if(!columns||!/^\s*[1-9]\d*\s*$/.test(columns.body))return fallback;at=columns.next;
  }
  let braces=0,separators=0,rowContent=false,lastSeparator=-1,lastSeparatorHadContent=false;
  const stack:[string,number][]=[[opening.name,0]];
  while(at<source.length){
    const ch=source[at];
    if(ch==='%'){at=commentEnd(source,at);continue;}
    if(ch==='\\'){
      const token=control(source,at);if(!token)return fallback;
      if(manualNumbering.has(token.name)||literalScanners.has(token.name)||token.name==='cr')return fallback;
      if(token.name==='begin'||token.name==='end'){
        const tag=environmentTag(source,at);if(!tag)return fallback;
        if(tag.kind==='begin'){
          // Nested mathematical grids have their own row separators. They
          // count as content in the current outer row, never as outer rows.
          stack.push([tag.name,braces]);rowContent=true;
        }else{
          const expected=stack.pop();if(!expected||expected[0]!==tag.name||expected[1]!==braces)return fallback;
          if(!stack.length){
            if(skipSpace(source,tag.next)!==source.length||braces)return fallback;
            const labelOffset=!rowContent&&lastSeparator>=0?lastSeparator:at;
            const trailingCaseSeparator=!rowContent&&lastSeparatorHadContent&&['numcases','subnumcases'].includes(base)&&source.slice(lastSeparator,lastSeparator+2)==='\\\\'?lastSeparator:undefined;
            if(starred)return {numbering:Object.freeze({count:0,referenceOffset:0,referenceSuffix:''}),labelOffset};
            if(oneNumbered.has(base))return {numbering:ordinary,labelOffset};
            const rows=Math.max(1,separators+(rowContent?1:0));
            if(base==='subnumcases'){
              // LaTeX's standard \alph counter only defines a through z.
              // MathJax emits ASCII punctuation after z; do not claim a
              // portable reference label for that unsupported TeX case.
              if(rows>26)return fallback;
              return {numbering:Object.freeze({count:1,referenceOffset:0,referenceSuffix:String.fromCharCode(96+rows)}),labelOffset,trailingCaseSeparator};
            }
            return {numbering:Object.freeze({count:rows,referenceOffset:rows-1,referenceSuffix:''}),labelOffset,trailingCaseSeparator};
          }
        }
        at=tag.next;continue;
      }
      if(stack.length===1&&braces===0&&token.name==='\\'){
        const next=skipSpace(source,token.next);
        // Starred or spaced row terminators need a separate exact grammar.
        if(source[next]==='*'||source[next]==='[')return fallback;
        separators++;lastSeparatorHadContent=rowContent;rowContent=false;lastSeparator=at;
      }else if(stack.length===1&&braces===0){
        // A label after a trailing row terminator still starts a new tagged
        // row in MathJax, even when that final empty row is not displayed.
        if(token.name==='label'){
          const argument=group(source,skipSpace(source,token.next));if(!argument)return fallback;
          rowContent=true;at=argument.next;continue;
        }
        rowContent=true;
      }
      at=token.next;continue;
    }
    if(ch==='{'){braces++;if(stack.length===1)rowContent=true;}
    else if(ch==='}'&&--braces<0)return fallback;
    else if(stack.length===1&&braces===0&&!/\s/.test(ch))rowContent=true;
    at++;
  }
  return fallback;
}

/** Source-key caching prevents document/reference passes from rescanning
 * unchanged equations. The bounded LRU never retains an entire editing log. */
function cachedNumbering(source:string):InferredNumbering {
  const hit=cache.get(source);
  if(hit){cache.delete(source);cache.set(source,hit);return hit;}
  const value=infer(source);cache.set(source,value);
  if(cache.size>cacheLimit)cache.delete(cache.keys().next().value!);
  return value;
}
export function equationNumbering(source:string):EquationNumbering {return cachedNumbering(source).numbering;}

/** Insert a document label into the final real row, before a trailing row
 * terminator if present. The index refers to the unchanged original source. */
export function equationLabelInsertionOffset(source:string):number|null {return cachedNumbering(source).labelOffset;}

/** MathJax ignores one final plain cases-row terminator; cases.sty instead
 * creates an extra numbered empty row. Normalize that exact redundant marker
 * only for export, retaining all original comments and whitespace. Intentional
 * empty rows, starred/spaced separators and user-controlled tags stay source. */
export function normalizeEquationTrailingRowSeparator(source:string):string {
  const at=cachedNumbering(source).trailingCaseSeparator;
  return at===undefined?source:source.slice(0,at)+source.slice(at+2);
}

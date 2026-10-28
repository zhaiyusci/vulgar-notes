// SPDX-License-Identifier: GPL-3.0-or-later

/** Offsets refer to the unmodified source, including any leading comments. */
export interface StandaloneMathEnvironmentBounds {
  name:string;
  start:number;
  bodyStart:number;
  bodyEnd:number;
  end:number;
  /** empheq inherits numbering from its argument, rather than its own name. */
  numbered:boolean|undefined;
}

// These environments enter display math themselves in TeX. Inner structures
// such as aligned, gathered, split, cases and matrices still need a wrapper.
const standalone=new Set([
  'equation','equation*','align','align*','alignat','alignat*','flalign','flalign*',
  'gather','gather*','multline','multline*','eqnarray','eqnarray*',
  'xalignat','xalignat*','xxalignat','displaymath','numcases','subnumcases','empheq',
]);
interface Control {name:string;next:number}
function control(source:string,start:number):Control|null {
  if(source[start]!=='\\'||start+1>=source.length)return null;
  const name=/^[A-Za-z]+/.exec(source.slice(start+1))?.[0]??source[start+1];
  return {name,next:start+1+name.length};
}
function commentEnd(source:string,start:number):number {
  const relative=source.slice(start).search(/[\r\n]/);
  if(relative<0)return source.length;
  const newline=start+relative;return newline+(source[newline]==='\r'&&source[newline+1]==='\n'?2:1);
}
function skipSpace(source:string,start:number):number {
  while(start<source.length){
    if(/\s/.test(source[start]))start++;
    else if(source[start]==='%')start=commentEnd(source,start);
    else break;
  }
  return start;
}
function tag(source:string,start:number):{kind:'begin'|'end';name:string;next:number}|null {
  const command=control(source,start);
  if(!command||command.name!=='begin'&&command.name!=='end')return null;
  const open=skipSpace(source,command.next);
  if(source[open]!=='{')return null;
  let close=open+1,name='';
  for(;close<source.length;close++){
    if(source[close]==='%'){close=commentEnd(source,close)-1;continue;}
    if(source[close]==='}')break;
    // Dynamic or nested names require macro expansion; never guess their value.
    if(source[close]==='\\'||source[close]==='{')return null;
    name+=source[close];
  }
  if(close===source.length)return null;
  if(!/^[A-Za-z][A-Za-z0-9_*@.-]*$/.test(name))return null;
  return {kind:command.name,name,next:close+1};
}

/**
 * Recognize a complete, balanced display environment without parsing its math.
 * This deliberately has no model dependency: rendering and export can decide
 * whether a math delimiter would create an illegal nested display environment.
 */
export function standaloneMathEnvironmentBounds(source:string):StandaloneMathEnvironmentBounds|null {
  const start=skipSpace(source,0),opening=tag(source,start);
  if(!opening||opening.kind!=='begin'||!standalone.has(opening.name))return null;
  const stack=[{name:opening.name,braceDepth:0}];let at=opening.next,braceDepth=0;
  while(at<source.length){
    const character=source[at];
    if(character==='%'){at=commentEnd(source,at);continue;}
    if(character==='\\'){
      const command=control(source,at);if(!command)return null;
      // Verbatim/catcode-changing syntax cannot be scanned as ordinary TeX.
      if(['verb','verbdef','lstinline','catcode','csname'].includes(command.name))return null;
      if(command.name==='begin'||command.name==='end'){
        const environment=tag(source,at);if(!environment)return null;
        if(environment.kind==='begin')stack.push({name:environment.name,braceDepth});
        else {
          const current=stack.pop();
          if(!current||current.name!==environment.name||current.braceDepth!==braceDepth)return null;
          if(!stack.length){
            if(skipSpace(source,environment.next)!==source.length)return null;
            return {name:opening.name,start,bodyStart:opening.next,bodyEnd:at,end:environment.next,
              numbered:opening.name==='empheq'?undefined:!opening.name.endsWith('*')&&!['displaymath','xxalignat'].includes(opening.name)};
          }
        }
        at=environment.next;continue;
      }
      at=command.next;continue;
    }
    if(character==='{')braceDepth++;
    else if(character==='}'&&--braceDepth<0)return null;
    at++;
  }
  return null;
}

export function standaloneMathEnvironment(source:string):boolean {
  return standaloneMathEnvironmentBounds(source)!==null;
}

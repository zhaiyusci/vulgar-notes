// SPDX-License-Identifier: GPL-3.0-or-later
import data from './mathjax-command-data.json';
import {preferredMathCommand} from './letter-variants';

export interface MathJaxLatexIssue {command:string;reason:string;suggestion:string}
export interface MathJaxLatexRequirements {packages:string[];preamble:string;issues:MathJaxLatexIssue[]}
const packagesFor=(name:string)=>new Set(data.commands.filter(command=>command.definitions.some(definition=>definition.package===name||definition.package==='text-'+name)).map(command=>command.name));
const known=new Set(data.commands.map(command=>command.name));
const definitions=new Set(['def','gdef','edef','xdef','let','futurelet','newcommand','renewcommand','providecommand','DeclareMathOperator','newenvironment','renewenvironment','catcode','csname']);
const text=new Set(['text','textnormal','textrm','textup','textit','textbf','textsf','texttt','mbox','hbox','operatorname','ce','pu','href','url','style','class','cssId']);
const upgreek=packagesFor('upgreek'),textcomp=packagesFor('textcomp'),gensymb=packagesFor('gensymb');
const greekNames='alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa varkappa lambda mu nu xi omicron pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega'.split(' ');
const greek=new Map<string,string>();
for(const name of greekNames){const command=data.commands.find(command=>command.name===name);const symbol=command?.definitions.find(definition=>'character' in definition&&typeof definition.character==='string');if(symbol&&'character' in symbol)greek.set(symbol.character,'\\'+name);}
const upright=new Map<string,string>();
for(const command of data.commands.filter(command=>upgreek.has(command.name))){const symbol=command.definitions.find(definition=>definition.package==='upgreek'&&'character' in definition);if(symbol&&'character' in symbol&&typeof symbol.character==='string')upright.set(command.name,'\\'+preferredMathCommand('symup')+'{'+(greek.get(symbol.character)??symbol.character)+'}');}

function token(source:string,start:number):{name:string;next:number}|null {
  if(source[start]!=='\\'||start+1>=source.length)return null;
  const name=/^[A-Za-z]+/.exec(source.slice(start+1))?.[0]??source[start+1];return {name,next:start+1+name.length};
}
function skip(source:string,start:number):number {while(start<source.length&&/\s/.test(source[start]))start++;return start;}
function groupEnd(source:string,start:number,open='{',close='}'):number {
  let depth=0;
  for(let at=start;at<source.length;at++){
    if(source[at]==='\\'){const escaped=token(source,at);if(!escaped)return source.length;at=escaped.next-1;continue;}
    if(source[at]==='%'){const end=source.indexOf('\n',at);if(end<0)return source.length;at=end;continue;}
    if(source[at]===open)depth++;else if(source[at]===close&&--depth===0)return at+1;
  }return source.length;
}
/** Inert lexical scan: comments and verbatim content never become commands. */
function commands(source:string):{name:string;at:number;next:number}[] {
  const result:{name:string;at:number;next:number}[]=[];
  for(let at=0;at<source.length;){
    if(source[at]==='%'){const end=source.indexOf('\n',at);at=end<0?source.length:end+1;continue;}
    const found=token(source,at);if(!found){at++;continue;}
    result.push({...found,at});at=found.next;
    if(found.name==='verb'){
      if(source[at]==='*')at++;const delimiter=source[at++],end=delimiter?source.indexOf(delimiter,at):-1;at=end<0?source.length:end+1;
    }
  }return result;
}
function locallyDefinedCommands(sources:readonly string[]):Set<string> {
  const result=new Set<string>();
  for(const source of sources)for(const command of commands(source)){
    if(!['def','gdef','edef','xdef','let','futurelet','newcommand','renewcommand','providecommand','DeclareMathOperator'].includes(command.name))continue;
    let at=skip(source,command.next);if(source[at]==='*')at=skip(source,at+1);if(source[at]==='{')at=skip(source,at+1);
    const defined=token(source,at);if(defined)result.add(defined.name);
  }return result;
}

/** Export-only adaptations with proven TeX equivalents. No editing-time scan. */
export function adaptMathJaxLatex(source:string):string {
  if(commands(source).some(command=>definitions.has(command.name)))return source;
  let result='',at=0;
  while(at<source.length){
    if(source[at]==='%'){const end=source.indexOf('\n',at),next=end<0?source.length:end+1;result+=source.slice(at,next);at=next;continue;}
    const command=token(source,at);if(!command){result+=source[at++];continue;}
    if(command.name==='verb'){
      let next=command.next;if(source[next]==='*')next++;const delimiter=source[next++],end=delimiter?source.indexOf(delimiter,next):-1;next=end<0?source.length:end+1;result+=source.slice(at,next);at=next;continue;
    }
    if(text.has(command.name)||!known.has(command.name)&&/^[A-Za-z]+$/.test(command.name)){
      // Unknown macros may consume text or change scope; do not reinterpret
      // their contents or subsequent tokens as ordinary mathematical input.
      if(!known.has(command.name)){result+=source.slice(at);break;}
      let next=command.next;
      if(source[next]==='*')next++;
      const count=['href','style','class','cssId'].includes(command.name)?2:1;
      for(let group=0;group<count&&source[skip(source,next)]==='{';group++){const open=skip(source,next);next=groupEnd(source,open);}
      result+=source.slice(at,next);at=next;continue;
    }
    if(command.name==='units')result+='\\unit';
    else if(command.name==='nicefrac'&&source[skip(source,command.next)]!=='[')result+='\\nicefrac[\\mathrm]';
    else result+=upright.get(command.name)??source.slice(at,command.next);
    at=command.next;
  }return result;
}

/** Insert after mathtools/amssymb, BEFORE extarrows, unicode-math and physics. */
export function analyzeMathJaxLatex(mathSources:readonly string[]):MathJaxLatexRequirements {
  const names=new Set<string>(),environments=new Set<string>(),local=locallyDefinedCommands(mathSources);
  for(const original of mathSources){const source=adaptMathJaxLatex(original);for(const command of commands(source)){
    if(!local.has(command.name))names.add(command.name);
    if(command.name==='begin'){
      const name=/^\s*\{\s*([A-Za-z]+\*?)\s*\}/.exec(source.slice(command.next))?.[1];if(name)environments.add(name);
    }
  }}
  const wanted=new Set<string>(),issues:MathJaxLatexIssue[]=[];
  if([...names].some(name=>textcomp.has(name)))wanted.add('textcomp');
  if([...names].some(name=>gensymb.has(name))){wanted.add('textcomp');wanted.add('gensymb');}
  if([...names].some(name=>upgreek.has(name)))wanted.add('upgreek');
  if([...names].some(name=>['color','textcolor','colorbox','fcolorbox','definecolor'].includes(name)))wanted.add('xcolor');
  if([...names].some(name=>['rowcolor','columncolor','cellcolor','arrayrulecolor','doublerulesepcolor'].includes(name))){wanted.add('xcolor');wanted.add('colortbl');}
  if([...environments].some(name=>['numcases','subnumcases'].includes(name)))wanted.add('cases');
  if(environments.has('empheq'))wanted.add('empheq');
  if(names.has('centernot'))wanted.add('centernot');
  if(names.has('unit')||names.has('unitfrac'))wanted.add('units');else if(names.has('nicefrac'))wanted.add('nicefrac');
  if([...names].some(name=>['xtwoheadleftarrow','xtwoheadrightarrow','xtofrom'].includes(name)))wanted.add('extpfeil');
  const unsupported:Record<string,[string,string]>={
    bbox:['MathJax bbox options are not a LaTeX package interface.','Convert its parsed padding, border and background options to explicit TeX box/color constructs; do not load the unrelated fontinst bbox.sty.'],
    enclose:['MathJax menclose notation has no single equivalent LaTeX package.','Translate each supported notation separately, such as a box to boxed or a diagonal strike to cancel; retain and report unsupported notation combinations.'],
    unicode:['MathJax unicode accepts MathJax-specific character, font and dimension arguments.','Decode the code point and explicitly preserve its math class/font/metrics; do not load the unrelated xmltex unicode.sty.'],
    Newextarrow:['MathJax Newextarrow arguments are not the TeX extpfeil newextarrow interface.','Translate the parsed arrow definition to actual TeX arrow-fill syntax, or edit this source before export.'],
    cssId:['CSS identifiers are HTML output annotations.','Remove identifier-only annotations at export while retaining their contents.'],
    class:['CSS classes are HTML output annotations.','Remove class-only annotations at export while retaining their contents; preserve any visible styling explicitly.'],
    style:['CSS styling has no general TeX equivalent.','Translate recognized visual properties explicitly; retain and report unsupported CSS.'],
    htmlData:['HTML data attributes have no TeX equivalent.','Remove metadata-only annotations while retaining their mathematical contents.'],
  };
  for(const [command,[reason,suggestion]] of Object.entries(unsupported))if(names.has(command))issues.push({command,reason,suggestion});
  if(names.has('units')&&!mathSources.some(source=>commands(source).some(command=>definitions.has(command.name))))issues.push({command:'units',reason:'This MathJax units command remains inside a protected text scope.',suggestion:'Use the native TeX units package command \\unit explicitly in this protected source.'});
  const order=['textcomp','upgreek','gensymb','xcolor','colortbl','cases','empheq','centernot','units','nicefrac','extpfeil'];
  const packages=order.filter(name=>wanted.has(name));return {packages,preamble:packages.map(name=>'\\usepackage{'+name+'}\n').join(''),issues};
}
export function optionalMathPackages(mathSources:readonly string[]):string {return analyzeMathJaxLatex(mathSources).preamble;}

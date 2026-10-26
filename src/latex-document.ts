import type {Value} from 'platejs';
import {plateLatex} from './plate-document';
import {unicodeMathPreamble,blackboardPreamble} from './letter-preamble';
import {mhchemParser} from 'mhchemparser';
import {citedBibLibraries,parseBibLibraries,validateBibLibraries,validCitationKey,type BibLibrary} from './bibtex';

/** MathJax's physical-unit shorthand is not a LaTeX mhchem command. */
export function portableMath(source:string):string {
  let result='',offset=0;
  const command=/\\[a-zA-Z]+|\\[^a-zA-Z]/g;
  for(let match; (match=command.exec(source));){
    // physics captures the legacy \div slot before unicode-math replaces it.
    // The Unicode division sign retains its binary-operator math class.
    if(match[0]==='\\divisionsymbol'){
      result+=source.slice(offset,match.index)+'÷';offset=command.lastIndex;continue;
    }
    if(match[0]!=='\\pu')continue;
    const start=command.lastIndex;
    let open=start;
    while(/\s/.test(source[open]||'!'))open++;
    if(source[open]!=='{')throw Error('Missing argument for \\pu');
    let end=open+1,depth=1;
    for(;end<source.length&&depth;end++){
      if(source[end]==='\\'){end++;continue;}
      if(source[end]==='{')depth++;
      if(source[end]==='}')depth--;
    }
    if(depth)throw Error('Unclosed argument for \\pu');
    result+=source.slice(offset,match.index)+mhchemParser.toTex(source.slice(open+1,end-1),'pu');
    offset=end;command.lastIndex=end;
  }
  return result+source.slice(offset);
}

/** Keep retained BibTeX intact; never interpolate its original filename into TeX. */
function embeddedBibliography(filename:string,source:string):string {
  // filecontents scans for its terminator even inside a BibTeX comment/value.
  if(/\\end\s*\{\s*filecontents\*?\s*\}/.test(source))
    throw Error('A BibTeX library contains a filecontents terminator and cannot be embedded safely in a single TeX document.');
  return '\\begin{filecontents*}[overwrite]{'+filename+'}\n'+source+
    (/[\r\n]$/.test(source)?'':'\n')+'\\end{filecontents*}\n';
}

function biblatexDocument(value:Value,libraries:readonly BibLibrary[]):{resources:string;setup:string;body:string}|undefined {
  const checked=validateBibLibraries(libraries),keys=new Set(parseBibLibraries(checked).map(entry=>entry.key));
  const citations=new Set<string>();
  const collectCitations=(nodes:any[])=>nodes.forEach(node=>{
    if(node.type==='tex_reference'&&node.command==='cite'&&Array.isArray(node.keys)){
      for(const key of node.keys){
        if(!validCitationKey(key))throw Error('Invalid citation key');
        citations.add(key);
      }
    }
    if(Array.isArray(node.children))collectCitations(node.children);
  });
  collectCitations(value);
  const manual:{key:string;note:string}[]=[];
  const withoutManual=(nodes:any[]):any[]=>nodes.flatMap(node=>{
    if(node.type==='bibliography_entry'){
      if(!validCitationKey(node.citeKey))throw Error('Invalid citation key');
      if(keys.has(node.citeKey))throw Error('Duplicate citation key: '+node.citeKey);
      keys.add(node.citeKey);
      manual.push({key:node.citeKey,note:plateLatex([{type:'p',children:node.children}],portableMath)});
      return [];
    }
    return [Array.isArray(node.children)?{...node,children:withoutManual(node.children)}:node];
  });
  const filtered=withoutManual(value),retained=citedBibLibraries(checked,[...citations]);
  // Attaching a library alone must not change the standalone TeX toolchain.
  if(!retained.length)return undefined;
  const body=plateLatex(filtered,portableMath),sources=retained.map(library=>library.source);
  // Preserve manually entered bibliography entries and their document order.
  // They are uncited in the legacy exporter too; nocite keeps that behavior.
  if(manual.length)sources.push(manual.map(entry=>'@misc{'+entry.key+',\n  note = {'+entry.note+'}\n}').join('\n\n'));
  const names=sources.map((_,index)=>'\\jobname-vulgar-bibliography-'+(index+1)+'.bib');
  const printedKeys=[...new Set([...manual.map(entry=>entry.key),...citations])];
  return {
    resources:sources.map((source,index)=>embeddedBibliography(names[index],source)).join('\n'),
    // Crossref/xdata parents can supply fields without being cited themselves.
    // Explicit filtering and deferred numbers keep those dependencies out of
    // the bibliography and prevent them from consuming a citation number.
    setup:'\\usepackage[backend=biber,style=numeric,sorting=none,defernumbers=true]{biblatex}\n'+
      names.map(name=>'\\addbibresource{'+name+'}').join('\n')+'\n'+
      '\\DeclareBibliographyCategory{vulgarCited}\n'+
      (printedKeys.length?'\\addtocategory{vulgarCited}{'+printedKeys.join(',')+'}\n':''),
    body:(manual.length?'\\nocite{'+manual.map(entry=>entry.key).join(',')+'}\n':'')+body+'\n\n\\printbibliography[category=vulgarCited]',
  };
}

export function latexDocument(value:Value,libraries:readonly BibLibrary[]=[]):string {
  const bibliography=libraries.length?biblatexDocument(value,libraries):undefined;
  const body=bibliography?.body??plateLatex(value,portableMath);
  const instructions=bibliography?
    '% Compile: LuaLaTeX, Biber, LuaLaTeX, LuaLaTeX (TeX Live).\n% Run Biber on the document basename, without the .tex extension.\n':
    '% Compile with LuaLaTeX or XeLaTeX (TeX Live).\n% Run twice to resolve cross-references and citations.\n';
  return String.raw`% !TeX program = lualatex
${instructions}${bibliography?.resources??''}\documentclass[UTF8,fontset=fandol,scheme=plain]{ctexart}
\usepackage{mathtools}
\usepackage{amssymb}
\usepackage{extarrows}
\usepackage{cancel}
${unicodeMathPreamble}\setmathfont{NewCMMath-Regular.otf}
\setmathfont{NewCMMath-Bold.otf}[version=bold]
\usepackage{physics}
\usepackage[version=4]{mhchem}
${blackboardPreamble}
${bibliography?.setup??''}\usepackage[hidelinks]{hyperref}

\begin{document}
${body}
\end{document}
`;
}

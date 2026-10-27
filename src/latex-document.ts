import type {Value} from 'platejs';
import {plateLatex} from './plate-document';
import {unicodeMathPreamble,blackboardPreamble} from './letter-preamble';
import {mhchemParser} from 'mhchemparser';
import {citedBibLibraries,parseBibLibraries,validateBibLibraries,validCitationKey,type BibLibrary} from './bibtex';
import {bibliographyItems} from './references';
import {documentLatex} from './document-format';
import type {BibliographyRun,BibliographyStyle} from './bibliography-style';

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

/** Processor text is data, never TeX source; retain only its supported marks. */
function formattedBibliographyTex(runs:readonly BibliographyRun[]):string {
  const commands=[['italic','textit'],['bold','textbf'],['superscript','textsuperscript'],['subscript','textsubscript'],['smallCaps','textsc']] as const;
  return runs.map(run=>{
    let text=documentLatex({type:'text',text:run.text});
    for(const [mark,command] of commands)if(run[mark])text='\\'+command+'{'+text+'}';
    return text;
  }).join('');
}

function referenceDocument(value:Value,libraries:readonly BibLibrary[],style:BibliographyStyle):{resources:string;setup:string;body:string;biblatex:boolean} {
  const checked=validateBibLibraries(libraries),keys=new Set(parseBibLibraries(checked).map(entry=>entry.key));
  const identifiers=new Set<string>();
  const validate=(nodes:any[])=>nodes.forEach(node=>{
    if(node.type==='bibliography_entry'){
      if(!validCitationKey(node.citeKey))throw Error('Invalid citation key');
      if(keys.has(node.citeKey))throw Error('Duplicate citation key: '+node.citeKey);
      keys.add(node.citeKey);
    }
    if(node.type==='footnoteDefinition'){
      if(typeof node.identifier!=='string'||!node.identifier)throw Error('Invalid endnote identifier');
      if(identifiers.has(node.identifier))throw Error('Duplicate endnote identifier: '+node.identifier);
      identifiers.add(node.identifier);
    }
    if(Array.isArray(node.children))validate(node.children);
  });
  validate(value);
  const noteKeys=new Map<string,string>();
  const noteKey=(identifier:string):string=>{
    const existing=noteKeys.get(identifier);if(existing)return existing;
    // Encode the identifier rather than its current number: reordering notes
    // does not rename their anchors. Reserve against every bibliography key.
    const base='vulgar-note-'+([...identifier].map(char=>char.codePointAt(0)!.toString(16)).join('-')||'empty');
    let key=base,suffix=1;while(keys.has(key))key=base+'-'+suffix++;
    keys.add(key);noteKeys.set(identifier,key);return key;
  };
  const transform=(nodes:any[]):any[]=>nodes.flatMap(node=>{
    if(node.type==='bibliography_entry'||node.type==='footnoteDefinition')return [];
    if(node.type==='footnoteReference')return [{type:'tex_reference',command:'cite',keys:[noteKey(String(node.identifier??''))],children:[{text:''}]}];
    return [Array.isArray(node.children)?{...node,children:transform(node.children)}:node];
  });
  const rows=bibliographyItems(value,checked,style).map(item=>({
    ...item,key:item.kind==='endnote'?noteKey(item.identifier!):item.key,
  }));
  const bodyNodes=transform(value);
  if(style!=='simple'){
    // The editor owns the shared note/citation order and numbers. Preformatted
    // CSL bodies preserve the chosen format exactly, without re-sorting or
    // reformatting entries through a different BibLaTeX implementation.
    const bibliography=rows.map(row=>{
      const body=row.libraryId&&row.runs?formattedBibliographyTex(row.runs):
        plateLatex(transform(row.node.children) as Value,portableMath);
      return '\\bibitem{'+row.key+'} '+body;
    }).join('\n');
    return {resources:'',setup:rows.length?'\\renewcommand{\\refname}{Notes and references}\n':'',
      body:plateLatex(bodyNodes,portableMath)+(rows.length?'\n\n\\begin{thebibliography}{'+rows.length+'}\n'+bibliography+'\n\\end{thebibliography}':''),biblatex:false};
  }
  const retained=citedBibLibraries(checked,rows.filter(row=>row.libraryId).map(row=>row.key));
  if(!retained.length){
    const definitions=rows.map(row=>({type:'bibliography_entry',citeKey:row.key,children:transform(row.node.children)}));
    return {resources:'',setup:rows.length?'\\renewcommand{\\refname}{Notes and references}\n':'',
      body:plateLatex([...bodyNodes,...definitions],portableMath),biblatex:false};
  }
  const sources=retained.map(library=>library.source);
  const custom=rows.filter(row=>!row.libraryId).map(row=>{
    const note=plateLatex(transform(row.node.children) as Value,portableMath).replace(/\n{2,}/g,'\\par\n');
    return '@misc{'+row.key+',\n  note = {'+note+'}\n}';
  });
  if(custom.length)sources.push(custom.join('\n\n'));
  const names=sources.map((_,index)=>'\\jobname-vulgar-bibliography-'+(index+1)+'.bib');
  const printedKeys=rows.map(row=>row.key);
  return {
    resources:sources.map((source,index)=>embeddedBibliography(names[index],source)).join('\n'),
    // Dependency records can supply fields without becoming numbered entries.
    setup:'\\usepackage[backend=biber,style=numeric,sorting=none,defernumbers=true]{biblatex}\n'+
      names.map(name=>'\\addbibresource{'+name+'}').join('\n')+'\n'+
      '\\DeclareBibliographyCategory{vulgarCited}\n'+
      '\\addtocategory{vulgarCited}{'+printedKeys.join(',')+'}\n',
    // Seed the shared body-reference order before notes' internal references
    // are expanded by biblatex while printing their content.
    body:'\\nocite{'+printedKeys.join(',')+'}\n'+plateLatex(bodyNodes,portableMath)+
      '\n\n\\printbibliography[category=vulgarCited,title={Notes and references}]',
    biblatex:true,
  };
}

export function latexDocument(value:Value,libraries:readonly BibLibrary[]=[],style:BibliographyStyle='simple'):string {
  const bibliography=referenceDocument(value,libraries,style),body=bibliography.body;
  const instructions=bibliography.biblatex?
    '% Compile: LuaLaTeX, Biber, LuaLaTeX, LuaLaTeX (TeX Live).\n% Run Biber on the document basename, without the .tex extension.\n':
    '% Compile with LuaLaTeX or XeLaTeX (TeX Live).\n% Run twice to resolve cross-references and citations.\n';
  return String.raw`% !TeX program = lualatex
${instructions}${bibliography.resources}\documentclass[UTF8,fontset=fandol,scheme=plain]{ctexart}
\usepackage{mathtools}
\usepackage{amssymb}
\usepackage{extarrows}
\usepackage{cancel}
${unicodeMathPreamble}\setmathfont{NewCMMath-Regular.otf}
\setmathfont{NewCMMath-Bold.otf}[version=bold]
\usepackage{physics}
\usepackage[version=4]{mhchem}
${blackboardPreamble}
${bibliography.setup}\usepackage[hidelinks]{hyperref}

\begin{document}
${body}
\end{document}
`;
}

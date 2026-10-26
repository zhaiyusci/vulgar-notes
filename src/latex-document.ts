import type {Value} from 'platejs';
import {plateLatex} from './plate-document';
import {unicodeMathPreamble,blackboardPreamble} from './letter-preamble';
import {mhchemParser} from 'mhchemparser';

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

export function latexDocument(value:Value):string {
  const body=plateLatex(value,portableMath);
  return String.raw`% !TeX program = lualatex
% Compile with LuaLaTeX or XeLaTeX (TeX Live).
% Run twice to resolve cross-references and citations.
\documentclass[UTF8,fontset=fandol,scheme=plain]{ctexart}
\usepackage{mathtools}
\usepackage{amssymb}
\usepackage{extarrows}
\usepackage{cancel}
${unicodeMathPreamble}\setmathfont{NewCMMath-Regular.otf}
\setmathfont{NewCMMath-Bold.otf}[version=bold]
\usepackage{physics}
\usepackage[version=4]{mhchem}
${blackboardPreamble}
\usepackage[hidelinks]{hyperref}

\begin{document}
${body}
\end{document}
`;
}

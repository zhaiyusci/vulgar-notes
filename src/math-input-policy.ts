// SPDX-License-Identifier: GPL-3.0-or-later
/** Rendering support is not an instruction to expose every TeX primitive.
 * Keep these available as explicit source without promoting them as symbols
 * or prefix completions. Actual mathematical forms have their own entries.
 */
const sourceOnlyCommands=new Set([
  'genfrac','mathchoice','mathpalette',
  'phantom','hphantom','vphantom','mathstrut','xmathstrut','smash',
  'llap','rlap','clap','mathllap','mathrlap','mathclap',
  'cramped','crampedllap','crampedrlap','crampedclap',
  'mathord','mathbin','mathrel','mathop','mathopen','mathclose','mathinner','mathpunct',
  'vcenter','vtop','vbox','mathmakebox','mathmbox','bbox','enclose',
  'tripledash','textcompwordmark','TeX','LaTeX',
  'arrowvert','Arrowvert','bracevert','qcomma','qc','Residue','intop','ointop',
  // Macro definitions and raw output attributes are authoring mechanisms,
  // not mathematical symbols. Exact source entry stays available.
  'def','gdef','edef','xdef','let','futurelet','newcommand','renewcommand','providecommand',
  'newenvironment','renewenvironment','DeclareMathOperator','Newextarrow',
  'DeclarePairedDelimiter','DeclarePairedDelimiters','DeclarePairedDelimiterX','DeclarePairedDelimiterXPP',
  'DeclarePairedDelimitersX','DeclarePairedDelimitersXPP','MakeAboxedCommand',
  'class','cssId','style','data','href','mmlToken','unicode','U','char',
  'kern','mkern','hskip','mskip','hspace','thinspace','medspace','thickspace',
  'negthinspace','negmedspace','negthickspace','quad','qquad',
  'over','above','choose','brace','brack','overwithdelims','atopwithdelims','abovewithdelims','buildrel',
  'displaystyle','textstyle','scriptstyle','scriptscriptstyle','limits','nolimits','displaylimits',
]);

export function isSourceOnlyMathCommand(name:string):boolean {
  return sourceOnlyCommands.has(name)||/^(?:mhchem|MT)/.test(name);
}

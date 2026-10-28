// SPDX-License-Identifier: GPL-3.0-or-later
/** Every TeX extension shipped in the installed MathJax 4.1.3 component set. */
export interface MathJaxExtensionPolicy {
  readonly name:string;
  readonly state:'enabled'|'bundled'|'excluded';
  readonly reason:string;
}
export type MathJaxTexPackage=string|[string,number];

export const mathJaxExtensionPolicy:readonly MathJaxExtensionPolicy[]=[
  {name:'action',state:'excluded',reason:'The user excluded interactive actions and tooltips from the formula editor.'},
  {name:'ams',state:'bundled',reason:'AMS equations and symbols are already included by the combined TeX component.'},
  {name:'amscd',state:'excluded',reason:'The user excluded the AMS commutative-diagram package.'},
  {name:'autoload',state:'excluded',reason:'Supported packages are loaded explicitly; automatic loading must not bypass the selected extension and font policy.'},
  {name:'bbm',state:'excluded',reason:'The user selected BBoldX as the single blackboard alphabet; do not add a duplicate BBM alphabet.'},
  {name:'bboldx',state:'enabled',reason:'The selected blackboard alphabet; keep its native commands and package behavior.'},
  {name:'bbox',state:'enabled',reason:'Formula backgrounds, borders, and padding.'},
  {name:'begingroup',state:'excluded',reason:'The user excluded additional cross-expression macro-scope management rather than formula typesetting.'},
  {name:'boldsymbol',state:'enabled',reason:'Native bold-symbol semantics, including imported per-letter boldsymbol commands.'},
  {name:'braket',state:'enabled',reason:'Additional Bra, Ket, Braket, and Set forms; shared lowercase commands use physics via its explicit higher priority.'},
  {name:'bussproofs',state:'excluded',reason:'The user excluded additional diagram and proof-tree features rather than formula typesetting.'},
  {name:'cancel',state:'enabled',reason:'Cancellation marks and cancel-to annotations.'},
  {name:'cases',state:'enabled',reason:'Numbered and subnumbered cases environments.'},
  {name:'centernot',state:'enabled',reason:'Centered negation overlays.'},
  {name:'color',state:'enabled',reason:'Current LaTeX-compatible color commands and color boxes.'},
  {name:'colortbl',state:'enabled',reason:'Row, column, and cell colors inside mathematical arrays.'},
  {name:'colorv2',state:'excluded',reason:'Legacy color argument semantics conflict with the current LaTeX-compatible color package.'},
  {name:'configmacros',state:'bundled',reason:'Configuration-defined macros are part of the combined TeX component.'},
  {name:'dsfont',state:'excluded',reason:'The user selected BBoldX as the single blackboard alphabet; do not add a duplicate double-stroke font.'},
  {name:'empheq',state:'enabled',reason:'Decorated and emphasized equation environments.'},
  {name:'enclose',state:'enabled',reason:'Mathematical enclosures and notation marks.'},
  {name:'extpfeil',state:'enabled',reason:'Additional extensible labeled arrows.'},
  {name:'fontsizev3',state:'excluded',reason:'Legacy version-3 font-size semantics would change the current rendering model.'},
  {name:'gensymb',state:'enabled',reason:'Generic unit symbols for degree, Celsius, ohm, micro, and per-thousand.'},
  {name:'html',state:'enabled',reason:'Existing editor region identifiers and classes use the HTML annotation commands.'},
  {name:'mathtools',state:'enabled',reason:'Extended fractions, scripts, delimiters, matrices, and alignment.'},
  {name:'mhchem',state:'enabled',reason:'Chemical formulas, reactions, and physical-unit source.'},
  {name:'newcommand',state:'bundled',reason:'Standard macro definitions are already part of the combined TeX component.'},
  {name:'noerrors',state:'excluded',reason:'Retain real TeX errors rather than silently treating erroneous input as successful typesetting.'},
  {name:'noundefined',state:'excluded',reason:'Undefined commands must produce a detectable error rather than appearing as successfully rendered red text.'},
  {name:'physics',state:'enabled',reason:'Physics operators and notation keep precedence over overlapping braket and base commands.'},
  {name:'require',state:'bundled',reason:'Runtime package requests are already bundled and are restricted to this explicit allowlist.'},
  {name:'setoptions',state:'excluded',reason:'Document content must not change global MathJax configuration.'},
  {name:'tagformat',state:'excluded',reason:'Global-only tag-format configuration is outside the requested formula-typesetting scope; its formatter also drops native subnumcases letter suffixes.'},
  {name:'texhtml',state:'excluded',reason:'Raw embedded HTML is outside the formula editor content model.'},
  {name:'textcomp',state:'enabled',reason:'Fixed text symbols, including explicit en and em dashes inside textnormal.'},
  {name:'textmacros',state:'bundled',reason:'Text-mode parsing is already included by the combined TeX component.'},
  {name:'unicode',state:'enabled',reason:'Explicit Unicode character notation.'},
  {name:'units',state:'enabled',reason:'Unit, unit-fraction, and beveled nice-fraction notation.'},
  {name:'upgreek',state:'enabled',reason:'Explicit upright Greek letters without changing default Greek letter semantics.'},
  {name:'verb',state:'enabled',reason:'Verbatim formula text.'}
];

// Tuple priorities are part of MathJax's public ParserConfiguration package
// API: https://mathjax.github.io/MathJax-src/classes/input_tex_Configuration.ParserConfiguration.html
// Lower values win. braket uses 3 internally, so physics needs 2 to preserve
// its existing lowercase bra/ket/braket syntax. Capitalized braket forms remain.
const enabledOrder=[
  'bbox','boldsymbol','braket','cancel','cases','centernot',
  'color','colortbl','empheq','enclose','extpfeil','gensymb','html','mathtools',
  'mhchem','textcomp','unicode','units','upgreek','verb','physics','bboldx'
];
export const mathJaxExtensionLoads=enabledOrder.map(name=>'[tex]/'+name);
export const mathJaxTexPackages:MathJaxTexPackage[]=enabledOrder.map(name=>name==='physics'?[name,2]:name);
export const mathJaxDisabledTexPackages=mathJaxExtensionPolicy.filter(entry=>entry.state==='excluded').map(entry=>entry.name);
export const mathJaxRequireOptions={
  defaultAllow:false,
  allow:{base:false,...Object.fromEntries(mathJaxExtensionPolicy.map(entry=>[entry.name,entry.state!=='excluded']))}
};

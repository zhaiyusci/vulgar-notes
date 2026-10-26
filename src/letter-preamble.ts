// Native package configuration: no generated replacement commands.
export const unicodeMathPreamble=String.raw`\usepackage{unicode-math}
\unimathsetup{mathrm=sym,mathit=sym,mathbf=sym,mathsf=sym,mathtt=sym}
`;
export const blackboardPreamble=String.raw`% BBoldX supplies mathbb and native Greek math symbols such as bbalpha.
\usepackage[bbsymbols]{bboldx}
`;
export const letterPreamble=unicodeMathPreamble+blackboardPreamble;

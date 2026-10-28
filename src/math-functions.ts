// SPDX-License-Identifier: GPL-3.0-or-later
/** Function grammars in the loaded MathJax base and physics packages.
 * Keep spellings distinct: physics prints asin and arcsin differently, and its
 * long NamedFn commands do not consume parentheses like Expression commands.
 */
export interface MathFunction {
  name:string;
  command:string;
  aliases?:string[];
  automaticParentheses?:boolean;
  optionalExponent?:boolean;
  hidden?:boolean;
}
const expressions='sin cos tan cot sec csc sinh cosh tanh coth arcsin arccos arctan asin acos atan arccsc acsc arcsec asec arccot acot csch sech log ln'.split(' ');
export const mathFunctions:readonly MathFunction[]=[
  ...expressions.map(name=>({name,command:name,automaticParentheses:true,optionalExponent:true})),
  ...'exp det Pr tr Tr erf'.split(' ').map(name=>({name,command:name,automaticParentheses:true,
    ...(name==='Tr'?{aliases:['Trace']}:name==='tr'?{aliases:['trace']}: {})})),
  ...'lg arg deg dim gcd hom ker rank'.split(' ').map(name=>({name,command:name})),
  ...'arcsinh arccosh arctanh sgn'.split(' ').map(name=>({name,command:`operatorname{${name}}`})),
  // These are genuine physics spellings, not aliases to Expression commands:
  // changing \sine( into \sin( would introduce automatic fence sizing.
  ...Object.entries({sine:'sin',hypsine:'sinh',arcsine:'arcsin',asine:'asin',cosine:'cos',hypcosine:'cosh',arccosine:'arccos',acosine:'acos',tangent:'tan',hyptangent:'tanh',arctangent:'arctan',atangent:'atan',cosecant:'csc',hypcosecant:'csch',arccosecant:'arccsc',acosecant:'acsc',secant:'sec',hypsecant:'sech',arcsecant:'arcsec',asecant:'asec',cotangent:'cot',hypcotangent:'coth',arccotangent:'arccot',acotangent:'acot',exponential:'exp',logarithm:'log',naturallogarithm:'ln',determinant:'det',Probability:'Pr'})
    .map(([name])=>({name,command:name,hidden:true})),
];
export function mathFunction(name:string):MathFunction|undefined {
  return mathFunctions.find(entry=>entry.command===name||entry.aliases?.includes(name));
}

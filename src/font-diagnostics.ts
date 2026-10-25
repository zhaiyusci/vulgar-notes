// Coverage of unicode-math 0.8r's default alphabet mappings, not font cmap
// availability. See um-code-sym-commands.dtx and um-code-alphabets.dtx.
// Keep operators and named functions out: sym commands select math alphabets,
// not a font for every part of an expression.
const greekNames='alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa varkappa lambda mu nu xi omicron pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega'.split(' ');
const greekChars=Array.from('αβγδϵεζηθϑικϰλμνξοπϖρϱσςτυϕφχψωΓΔΘΛΞΠΣΥΦΨΩ');
const symbolChars:Record<string,string>=Object.fromEntries(greekNames.map((name,i)=>[name,greekChars[i]]));
Object.assign(symbolChars,{partial:'∂',nabla:'∇',imath:'ı',jmath:'ȷ'});
export function diagnosticSymbol(type:string):string|undefined {return symbolChars[type.replace(/^symbol-/,'')];}

const greekStyles=new Set(['symup','symrm','symit','symbf','symbfup','symbfit','symbfsf','symbfsfup','symbfsfit']);
const digitStyles=new Set(['symup','symrm','symbf','symbfup','symsf','symsfup','symbfsf','symbfsfup','symbb','symtt']);
const commands=new Set([...greekStyles,...digitStyles,'symsfit','symcal','symscr','symbfcal','symbfscr','symfrak','symbffrak']);

export function fontPresentation(command:string):{sample:string;coverage:string}|undefined {
  const cmd=command.replace(/^\\/,'');
  if(cmd==='symnormal')return {sample:'Abh',coverage:'恢复默认数学字母样式'};
  if(!commands.has(cmd))return;
  const greek=greekStyles.has(cmd);
  const digits=digitStyles.has(cmd);
  const sample=greek?'Ah\\alpha':cmd==='symbb'?'Rb1':digits?'Ah1':'Bh';
  const coverage='unicode-math 默认范围：拉丁字母'+(digits?'、数字':'；不改变数字样式')+
    (greek?'；支持常规希腊字母':cmd==='symbb'?'；希腊字母仅 γ、π、Γ、Π':'；不改变希腊字母样式');
  return {sample,coverage};
}

export function fontDiagnostic(command:string,character:string):string|undefined {
  const cmd=command.replace(/^\\/,'');
  if(!commands.has(cmd))return; // normal is an intentional reset; boldsymbol is a separate mechanism.
  // Only decompose mathematical alphanumeric characters, not arbitrary
  // letterlike symbols (e.g. ℜ must not accidentally be treated as plain R).
  const point=character.codePointAt(0)!;
  const char=point>=0x1D400&&point<=0x1D7FF?character.normalize('NFKD'):character;
  let covered=true;
  if(/^[A-Za-z]$/.test(char))return;
  if(/^[0-9]$/.test(char))covered=digitStyles.has(cmd);
  else if('ıȷ'.includes(char))covered=['symup','symrm','symit'].includes(cmd);
  else if('Ϝϝ'.includes(char))covered=['symbf','symbfup'].includes(cmd);
  else if(/^[Α-Ωα-ωϴϵϑϰϕϱϖ∂∇]$/u.test(char))
    covered=greekStyles.has(cmd)||(cmd==='symbb'&&'γπΓΠ'.includes(char));
  else if(/^\p{Letter}$/u.test(char))covered=false;
  else return; // punctuation, operators, spaces, and command-entry text
  if(!covered)return `按 unicode-math 的默认映射，\\${cmd} 不会为“${character}”切换到该数学样式；该字符沿用外层或默认样式。输入与导出均保留。`;
}

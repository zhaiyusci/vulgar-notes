// unicode-math 0.8r, New Computer Modern, default TeX/ISO options.
// Unsupported alphabet ranges inherit the surrounding mathcodes in TeX.
const upper = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡϴΣΤΥΦΧΨΩ∇';
const lower = 'αβγδεζηθικλμνξοπρςστυφχψω∂ϵϑϰϕϱϖ';
const blackboard:Record<string,string> = {Γ:'ℾ',Π:'ℿ',γ:'ℽ',π:'ℼ'};
const starts:Record<string,number> = {it:0x1D6E2,bfup:0x1D6A8,bfit:0x1D71C,bfsfup:0x1D756,bfsfit:0x1D790};

export function unicodeMathGreek(char:string, commands:readonly string[], style:string):string|undefined {
  if (style !== 'TeX' && style !== 'ISO') return undefined;
  const u=upper.indexOf(char), l=lower.indexOf(char);
  if ([...char].length!==1 || (u<0 && l<0)) return undefined;
  const defaultStyle=char==='∇'?'up':u>=0&&style==='TeX'?'up':'it';
  let selected=defaultStyle;
  let special:string|undefined;
  for (const command of commands) {
    let next:string|undefined;
    switch(command) {
      case 'normal': next=defaultStyle; break;
      case 'up': case 'rm': next='up'; break;
      case 'it': case 'bfup': case 'bfit': case 'bfsfup': case 'bfsfit': next=command; break;
      case 'bf': next=char==='∇'||(u>=0&&style==='TeX')?'bfup':'bfit'; break;
      case 'bfsf': next=char==='∇'?'bfsfup':char==='∂'||style==='ISO'?'bfsfit':'bfsfup'; break;
      case 'bb': if (blackboard[char]) special=blackboard[char]; break;
      // sf, tt, script, fraktur (including bold forms) do not map Greek.
    }
    if(next) {selected=next;special=undefined;}
  }
  if(special) return special;
  if(selected==='up') return char;
  return String.fromCodePoint(starts[selected]+(u>=0?u:26+l));
}

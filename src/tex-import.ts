import {EditorModel,catalog,symbols,type MathItem,type Region,type MathNode,type ScriptSlot} from './editor-model';

/** Remove an explicit, matched math wrapper, without changing the source inside it. */
export function normalizeMathSource(source:string):{source:string;display:boolean}|null {
  const framed=source.trim();
  const escaped=(at:number)=>{let n=0;while(at>0&&framed[--at]==='\\')n++;return n%2===1;};
  const dollar=(at:number)=>framed[at]==='$'&&!escaped(at);
  if(framed.startsWith('$')){
    const width=framed.startsWith('$$')?2:1;
    if(framed.length<width*2||!dollar(framed.length-1))return null;
    if(width===2&&(!dollar(framed.length-2)||!framed.endsWith('$$')))return null;
    const body=framed.slice(width,-width);
    // Extra delimiters are ambiguous; retain the complete original as source.
    for(let j=width;j<framed.length-width;j++)if(dollar(j))return null;
    return {source:body,display:width===2};
  }
  if(dollar(framed.length-1))return null;
  const opening=framed.slice(0,2),closing=framed.slice(-2);
  if(opening==='\\('||opening==='\\['){
    const expected=opening==='\\('? '\\)' : '\\]';
    if(framed.length<4||closing!==expected||escaped(framed.length-2))return null;
    for(let j=2;j<framed.length-2;j++)if(framed[j]==='\\'&&!escaped(j)&&'()[]'.includes(framed[j+1]??''))return null;
    return {source:framed.slice(2,-2),display:opening==='\\['};
  }
  if(['\\)','\\]'].includes(opening)||['\\)','\\]','\\(','\\['].includes(closing))return null;
  return {source,display:false};
}

interface CommandSyntax {type:string;arity:number;order?:number[]}

// This is a TeX grammar map, deliberately independent of button labels and slot
// order. A catalog entry alone does not establish how a TeX command consumes
// tokens, optional arguments, stars, delimiters, or declarations.
const commands:Record<string,CommandSyntax>=Object.create(null);
for(const name of ['frac','dfrac','tfrac','binom','dbinom','tbinom','splitfrac','splitdfrac'])commands[name]={type:name,arity:2};
for(const name of ['hat','widehat','tilde','widetilde','bar','overline','underline','acute','grave','breve','check','mathring','dot','ddot','dddot','ddddot','overrightarrow','overleftarrow','overleftrightarrow','underrightarrow','underleftarrow','underleftrightarrow','boxed','cancel','bcancel','xcancel'])commands[name]={type:name,arity:1};
commands.vec={type:'vector',arity:1};
commands.overset={type:'overset',arity:2,order:[1,0]};
commands.underset={type:'underset',arity:2,order:[1,0]};
commands.cancelto={type:'cancelto',arity:2,order:[1,0]};
commands.prescript={type:'prescript',arity:3,order:[2,0,1]};

const operatorTypes:Record<string,string>={
  sum:'sum',prod:'prod',bigcup:'bigcup',bigcap:'bigcap',int:'integral',iint:'doubleIntegral',oint:'contourIntegral',
  coprod:'coprod',bigsqcup:'bigsqcup',biguplus:'biguplus',bigvee:'bigvee',bigwedge:'bigwedge',bigodot:'bigodot',bigoplus:'bigoplus',bigotimes:'bigotimes',
  iiint:'iiint',iiiint:'iiiint',idotsint:'idotsint',lim:'limit',limsup:'oplimsup',liminf:'opliminf',sup:'opsup',inf:'opinf',max:'opmax',min:'opmin'
};

// Only commands with no TeX arguments are read from the symbol registry. The
// explicit list excludes extension macros, fonts, and physics' redefined \div.
const atomicCommands=new Set((
  'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa varkappa lambda mu nu xi omicron pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega '+
  'pm mp times divisionsymbol cdot ast star circ bullet oplus ominus otimes oslash odot cap cup uplus sqcap sqcup wedge vee setminus wr diamond '+
  'leq geq neq equiv approx sim simeq cong asymp propto ll gg prec succ preceq succeq in notin ni subset supset subseteq supseteq subsetneq supsetneq nsubseteq nsupseteq parallel nparallel perp mid nmid models vdash dashv bowtie '+
  'leftarrow rightarrow leftrightarrow Leftarrow Rightarrow Leftrightarrow longleftarrow longrightarrow longleftrightarrow Longleftarrow Longrightarrow Longleftrightarrow mapsto longmapsto hookleftarrow hookrightarrow uparrow downarrow updownarrow Uparrow Downarrow Updownarrow nearrow searrow swarrow nwarrow leftharpoonup leftharpoondown rightharpoonup rightharpoondown rightleftharpoons '+
  'infty partial nabla forall exists nexists neg emptyset varnothing aleph hbar ell imath jmath Re Im wp angle triangle square top bot prime backprime ldots cdots vdots ddots '+
  'sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh coth exp ln log lg arg deg det dim gcd hom ker Pr'
).split(/\s+/));
const ordinaryCommands=new Set(('alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa varkappa lambda mu nu xi omicron pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega infty partial nabla emptyset varnothing aleph hbar ell imath jmath wp prime backprime').split(' '));

interface ParsedAtom {items:MathItem[];group?:boolean;scriptable:boolean;operator?:MathNode}

/**
 * Convert only syntax whose complete meaning the model can preserve. Failure is
 * atomic: the caller keeps the original source instead of a partial conversion.
 * This parses complete TeX input, not the editor's interactive ^ / _ keystrokes.
 */
export function importMath(source:string):EditorModel|null {
  let i=0,serial=100000,depth=0;
  const region=(items:MathItem[],label='Content',slot?:ScriptSlot):Region=>({id:'r'+ ++serial,label,items,...(slot?{slot}:{})});
  const node=(type:string,args:MathItem[][]):MathNode=>({id:'n'+ ++serial,type,regions:args.map((items,j)=>region(items,catalog.find(d=>d.type===type)?.labels[j]))});
  const skip=()=>{while(i<source.length&&/\s/.test(source[i]))i++;};
  const fail=():never=>{throw Error('Unsupported or invalid TeX');};
  const word=()=>{const name=/^[A-Za-z]+/.exec(source.slice(i));if(!name)return null;i+=name[0].length;return name[0];};
  const readControl=():ParsedAtom=>{
    const name=word();
    if(!name){
      const literal=source[i++];
      if(literal&&'%#$&{}_ '.includes(literal))return {items:[literal],scriptable:true};
      return fail();
    }
    if(source[i]==='*')return fail();
    if(name==='sqrt'){
      skip();let index:MathItem[]|undefined;
      if(source[i]==='['){i++;index=sequence(']');}
      const body=argument();
      return {items:[node(index?'nthroot':'sqrt',index?[body,index]:[body])],scriptable:true};
    }
    if(name==='cfrac'){
      skip();let type='cfrac';
      if(source[i]==='['){
        const option=/^\[([lr])\]/.exec(source.slice(i));if(!option)return fail();
        i+=option[0].length;type+=option[1];
      }
      return {items:[node(type,[argument(),argument()])],scriptable:true};
    }
    const syntax=commands[name];
    if(syntax){
      const args=Array.from({length:syntax.arity},()=>argument());
      return {items:[node(syntax.type,(syntax.order??args.map((_,j)=>j)).map(j=>args[j]))],scriptable:true};
    }
    const operatorType=Object.hasOwn(operatorTypes,name)?operatorTypes[name]:undefined;
    if(operatorType){
      let type=operatorType;skip();
      const placement=/^\\(limits|nolimits)(?![A-Za-z])/.exec(source.slice(i));
      if(placement){
        i+=placement[0].length;
        const definition=catalog.find(d=>d.operator&&d.operatorCommand===name&&d.operatorPlacement==='\\'+placement[1]);
        if(!definition)return fail();type=definition.type;
      }
      const operator:MathNode={id:'n'+ ++serial,type,operatorLayout:true,regions:[]};
      return {items:[operator],scriptable:true,operator};
    }
    if(atomicCommands.has(name)){
      const symbol=symbols.find(d=>d.command==='\\'+name);
      if(symbol)return {items:[{id:'n'+ ++serial,type:symbol.type,atom:true,regions:[]}],scriptable:ordinaryCommands.has(name)};
    }
    return fail();
  };
  // An unbraced TeX argument is exactly one token, not a recursively consumed
  // command with its arguments. Expandable/argument-taking control sequences in
  // that position are deliberately refused rather than guessed.
  const argument=():MathItem[]=>{
    skip();
    if(source[i]==='{'){i++;return sequence('}');}
    if(source[i]==='\\'){
      const name=/^\\([A-Za-z]+)/.exec(source.slice(i))?.[1];
      if(name&&!atomicCommands.has(name))return fail();
      i++;return readControl().items;
    }
    const ch=i<source.length?String.fromCodePoint(source.codePointAt(i)!):'';i+=ch.length;
    if(!ch||/[{}_^%#$&~']/.test(ch))return fail();
    return [ch];
  };
  const atom=():ParsedAtom=>{
    skip();const ch=i<source.length?String.fromCodePoint(source.codePointAt(i)!):'';i+=ch.length;if(!ch)return fail();
    if(ch==='\\')return readControl();
    if(ch==='{')return {items:sequence('}'),group:true,scriptable:true};
    if(/[{}_^%#$&~']/.test(ch))return fail();
    return {items:[ch],scriptable:true};
  };
  const sequence=(end?:string):MathItem[]=>{
    if(++depth>128)return fail();
    const items:MathItem[]=[];
    while(i<source.length){
      skip();if(i>=source.length)break;
      if(end&&source[i]===end){i++;depth--;return items;}
      const term=atom();skip();
      let upper:MathItem[]|undefined,lower:MathItem[]|undefined;
      while(source[i]==='^'||source[i]==='_'){
        if(!term.scriptable)return fail();
        const isUpper=source[i++]==='^';
        if(isUpper?upper!==undefined:lower!==undefined)return fail();
        const arg=argument();if(isUpper)upper=arg;else lower=arg;
        skip();
      }
      if(term.operator){
        if(lower!==undefined)term.operator.regions.push(region(lower,'Lower limit','lower'));
        if(upper!==undefined)term.operator.regions.push(region(upper,'Upper limit','upper'));
        items.push(term.operator);
      }else if(upper!==undefined&&lower!==undefined)items.push(node('sup',[term.items,lower,upper]));
      else if(upper!==undefined)items.push(node('power',[term.items,upper]));
      else if(lower!==undefined)items.push(node('subscript',[term.items,lower]));
      // Flattening a TeX group can change math-atom classes and declaration
      // scope. The model currently has no independent preserving group node.
      else if(term.group)return fail();
      else items.push(...term.items);
    }
    depth--;
    if(end)return fail();return items;
  };
  try{
    const model=new EditorModel();model.root=region(sequence());model.index();model.setCursor(model.root.id,0);return model;
  }catch{return null;}
}

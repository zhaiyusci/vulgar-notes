import type {Definition} from './editor-model';
import {fontDiagnostic,diagnosticSymbol} from './font-diagnostics';
import {unicodeMathGreek} from './unicode-math-greek';
import {extensionCoverage} from './letter-extension-coverage';

export const extraLetterStyles = [
  ['editorbboldx','BBoldX','-bboldx'],['editorbboldxbold','BBoldX 粗体','-bboldx-bold'],
  ['editorbboldxlight','BBoldX 细体','-bboldx-light'],
] as const;
const bbCodes=new Map<string,number>();
for(let n=0x1D538;n<=0x1D56B;n++){const c=String.fromCodePoint(n).normalize('NFKD');if(/^[A-Za-z]$/.test(c))bbCodes.set(c,n);}
for(const c of 'ℂℍℕℙℚℝℤ')bbCodes.set(c.normalize('NFKD'),c.codePointAt(0)!);
for(let n=0;n<10;n++)bbCodes.set(String(n),0x1D7D8+n);

export function extensionHasLetter(variant:string,char:string):boolean {
  const data=extensionCoverage[variant];if(!data)return false;
  const code=char.codePointAt(0)!;
  return data.points.includes(data.remap[code]??bbCodes.get(char)??code);
}

export function preferredMathCommand(command:string):string {
  return ({symup:'mathrm',symrm:'mathrm',symbfcal:'mathbfcal'} as Record<string,string>)[command]??command.replace(/^sym/,'math');
}
const greekSlots='ΓΔΘΛΞΠΣΥΦΨΩαβγδεζηθικλμνξπρστυφχψ';
function explicitFont(char:string,family:string,weight:string):string {
  const slot=greekSlots.indexOf(char),code=slot>=0?slot:char==='ω'?127:char==='ı'?128:char==='ȷ'?129:undefined;
  return '\\mathord{\\text{\\usefont{U}{'+family+'}{'+weight+'}{n}'+(code===undefined?(char==='ο'?'o':char):'\\char'+code+' ')+'}}';
}
function bboldExport(base:Definition,bold=false):string {
  const c=base.letter!;
  if(/^[A-Za-z0-9]$/.test(c)||c==='ο')return '\\'+(bold?'mathbfbb':'mathbb')+'{'+(c==='ο'?'o':c)+'}';
  const name=base.type.slice(7).replace('varepsilon','epsilon').replace('varphi','phi').replace('imath','dotlessi').replace('jmath','dotlessj');
  // Weighted legacy drafts use an explicit font; the current alphabet uses
  // BBoldX's native math symbols. Terminate control words before adjacent letters.
  return bold?explicitFont(c,'bboldx','b'):'\\bb'+name+' ';
}
function glyphKey(command:string,char:string):string {
  const greek=unicodeMathGreek(char,[command.replace(/^sym/,'')],'TeX');
  if(greek!==undefined)return 'unicode:'+greek;
  let style=command.replace(/^sym/,'');
  if(/^[A-Za-z0-9]$/.test(char))style=({bf:'bfup',sf:'sfup',bfsf:'bfsfup',rm:'up'} as Record<string,string>)[style]??style;
  return style+':'+char;
}
export function registerLetterVariants(catalog:Definition[],symbols:Definition[]):void {
  const styles=catalog.filter(d=>d.font&&!d.legacy&&d.command.startsWith('\\sym'));
  // Existing drafts and explicit old LaTeX commands remain readable, but no
  // region-wide font controls are offered by the board or context menu.
  catalog.filter(d=>d.font).forEach(d=>d.hidden=true);
  catalog.filter(d=>d.font&&d.command==='\\symbb').forEach(d=>d.render=r=>'\\mathbb{'+r[0]+'}');
  const bases:Definition[]=[];
  for(const char of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'){
    const def:Definition={type:'symbol-letter-'+char,label:char,category:/\d/.test(char)?'数字':'拉丁字母',labels:[],selectedIndex:0,command:'',tex:char,render:()=>char,atom:true,letter:char,commandCandidate:false};
    symbols.push(def);bases.push(def);
  }
  for(const def of symbols.filter(d=>d.category==='希腊字母'||['symbol-partial','symbol-nabla','symbol-imath','symbol-jmath'].includes(d.type))){
    def.letter=diagnosticSymbol(def.type);if(def.letter)bases.push(def);
  }
  for(const base of bases){
    base.variantOf=base.type;base.variantLabel='默认';
    const add=(key:string,label:string,tex:string,extra:Partial<Definition>={})=>{
      const def={...base,type:base.type+'--'+key,label:base.label+' · '+label,variantLabel:label,command:'',tex,commandCandidate:false,...extra};symbols.push(def);return def;
    };
    for(const style of styles){
      if(style.command==='\\symnormal'||style.command==='\\symrm'||style.command==='\\symbb')continue;
      const unsupported=!!fontDiagnostic(style.command,base.letter!);
      const command=style.command.slice(1),arg=base.tex!.trim(),preferred=preferredMathCommand(command);
      const exportTex='\\'+preferred+'{'+arg+'}',equivalentTex=[exportTex,style.command+'{'+arg+'}'];
      const key=glyphKey(command,base.letter!);
      const same=symbols.find(d=>d.variantOf===base.type&&d.glyphKey===key&&!d.hidden);
      if(same&&!unsupported)same.equivalentTex=[...new Set([...same.equivalentTex!,...equivalentTex])];
      add(command,style.label,style.command+'{'+arg+'}',{exportTex:unsupported?exportTex:same?.exportTex??exportTex,equivalentTex,glyphKey:key,fontCommand:style.command,hidden:unsupported||!!same});
    }
    for(const [command,label,variant] of extraLetterStyles){
      if(!extensionHasLetter(variant,base.letter!))continue;
      const char=base.letter!;
      let exportTex='\\'+command+'{'+char+'}',equivalentTex:string[]=[];
      if(command==='editorbboldx'||command==='editorbboldxbold'){
        exportTex=bboldExport(base,command==='editorbboldxbold');
        equivalentTex=[exportTex];
      }else if(command==='editorbboldxlight')exportTex=explicitFont(char,'bboldx','l');
      const native=command==='editorbboldx'||command==='editorbboldxbold';
      // Blackboard weight is a presentation choice, not another letter identity.
      // Retain old weighted nodes for saved drafts, but offer one blackboard entry.
      const offered=command==='editorbboldx';
      const def=add(command,label,native?exportTex:'\\'+command+'{'+char+'}',{exportTex,equivalentTex:equivalentTex.length?[...new Set(equivalentTex)]:[exportTex],hidden:!offered});
      if(command==='editorbboldx'){
        // Old per-letter symbb nodes now resolve to the selected default blackboard face.
        add('symbb',label,def.tex!,{exportTex,equivalentTex:def.equivalentTex,hidden:true});
      }
      if(offered&&base.category==='希腊字母'&&char!=='ο'){
        const name=base.type.slice(7).replace('varepsilon','epsilon').replace('varphi','phi');
        def.command='\\'+(command==='editorbboldx'?'bb':'bfbb')+name;def.commandCandidate=true;
      }
    }
    if(!symbols.some(d=>d.type===base.type+'--symbb')){
      const tex='\\symbb{'+base.tex!.trim()+'}';
      add('symbb','黑板体',tex,{exportTex:'\\mathbb{'+base.tex!.trim()+'}',fontCommand:'\\symbb',hidden:true});
    }
  }
}

export function textNormal(source:string,preview=false):string {
  const escapes:Record<string,string>={'\\':'\\textbackslash{}','{':'\\{','}':'\\}','$':'\\$','%':'\\%','#':'\\#','&':'\\&','_':'\\_','^':'\\textasciicircum{}','~':'\\textasciitilde{}'};
  const body=Array.from(source).map(c=>preview&&'\\^~'.includes(c)?`\\unicode{x${c.codePointAt(0)!.toString(16)}}`:preview&&c===' '?'~':escapes[c]??c).join('');
  return preview?body:'\\textnormal{'+body+'}';
}


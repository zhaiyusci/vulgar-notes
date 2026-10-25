import type {Definition} from './editor-model';
import {fontPresentation} from './font-diagnostics';

export function registerExtensions(catalog:Definition[],symbols:Definition[]):void {
  const add=(type:string,label:string,category:string,labels:string[],render:Definition['render'],options:Partial<Definition>={})=>{
    catalog.push({type,label,category,labels,render,selectedIndex:0,command:'',...options});
  };
  for(const [command,label] of [['mathbfcal','粗花体'],['mathbfscr','粗手写花体'],['mathbffrak','粗哥特体']])
    add('font-'+command,label,'数学字体',['字体内容'],r=>`\\${command}{${r[0]}}`,{font:true,command:'\\'+command,previewArgs:['ABC']});
  for(const [command,base,label] of [
    ['symnormal','mathnormal','默认数学字母'],['symup','mathrm','正体'],['symrm','mathrm','Roman 正体'],['symit','mathit','斜体'],
    ['symbf','mathbf','自动粗体'],['symbfup','mathbf','粗正体'],['symbfit','mathbfit','粗斜体'],
    ['symsf','mathsf','自动 Sans'],['symsfup','mathsf','Sans 正体'],['symsfit','mathsfit','Sans 斜体'],
    ['symbfsf','mathbfsf','自动 Sans 粗体'],['symbfsfup','mathbfsf','Sans 粗正体'],['symbfsfit','mathbfsfit','Sans 粗斜体'],
    ['symbb','mathbb','黑板粗体'],['symcal','mathcal','花体'],['symscr','mathscr','手写花体'],['symfrak','mathfrak','哥特体'],['symtt','mathtt','等宽'],
    ['symbfcal','mathbfcal','粗花体'],['symbfscr','mathbfscr','粗手写花体'],['symbffrak','mathbffrak','粗哥特体']
  ]){
    const primary=catalog.find(e=>e.type==='font-'+base)!;
    primary.variantOf=primary.type;primary.variantLabel=primary.label+' · \\'+base;
    add('font-'+command,label,'数学字体',['字体内容'],r=>`\\${command}{${r[0]}}`,{
      font:true,command:'\\'+command,previewArgs:[fontPresentation(command)!.sample],variantOf:primary.type,variantLabel:label+' · \\'+command
    });
  }
  // Canonical Unicode-math commands; legacy node types still read old drafts.
  for(const [base,canonical] of [
    ['mathnormal','symnormal'],['mathrm','symup'],['mathit','symit'],['mathbf','symbf'],['mathbfit','symbfit'],
    ['mathsf','symsf'],['mathsfit','symsfit'],['mathbfsf','symbfsf'],['mathbfsfit','symbfsfit'],
    ['mathbb','symbb'],['mathcal','symcal'],['mathscr','symscr'],['mathfrak','symfrak'],['mathtt','symtt'],
    ['mathbfcal','symbfcal'],['mathbfscr','symbfscr'],['mathbffrak','symbffrak']
  ]){
    const old=catalog.find(e=>e.type==='font-'+base)!,preferred=catalog.find(e=>e.type==='font-'+canonical)!;
    old.legacy=true;old.commandCandidate=false;old.render=r=>`\\${canonical}{${r[0]}}`;old.command='\\'+canonical;
    preferred.aliases=[base];preferred.variantOf=preferred.type;
    for(const entry of catalog.filter(e=>e.variantOf===old.type))entry.variantOf=preferred.type;
    old.variantOf=preferred.type;
  }
  for(const [command,aliases] of [['symup',['mathup']],['symbfup',['mathbfup']],['symsfup',['mathsfup']],['symbfsfup',['mathbfsfup']]] as const){
    const entry=catalog.find(e=>e.type==='font-'+command)!;entry.aliases=[...(entry.aliases || []),...aliases];
  }
  const physics=(command:string,label:string,labels:string[],render:Definition['render'],aliases:string[]=[],options:Partial<Definition>={})=>
    add('physics-'+command,label,'物理记号',labels,render,{command:'\\'+command,aliases,...options});
  for(const [cmd,label,long] of [['dv','导数','derivative'],['pdv','偏导数','partialderivative'],['fdv','泛函导数','functionalderivative']]){
    physics(cmd,label,['函数','变量'],r=>`\\${cmd}{${r[0]}}{${r[1]}}`,[long]);
    const base=catalog.at(-1)!;base.variantOf=base.type;base.variantLabel='普通分式';
    add(base.type+'Flat',label+'（斜分式）','物理记号',base.labels,r=>`\\${cmd}*{${r[0]}}{${r[1]}}`,{
      command:`\\${cmd}*`,variantOf:base.type,variantLabel:'斜分式',commandCandidate:false
    });
  }
  for(const [cmd,label,long] of [
    ['dd','微分','differential'],['var','变分','variation'],['vb','粗体向量','vectorbold'],['va','箭头向量','vectorarrow'],['vu','单位向量','vectorunit'],
    ['grad','梯度','gradient'],['divergence','散度','div'],['curl','旋度',''],['laplacian','拉普拉斯算符',''],
    ['bra','左矢',''],['ket','右矢',''],['expval','期望值','expectationvalue'],['abs','绝对值','absolutevalue'],['norm','范数',''],
    ['ev','求值','evaluated'],['order','阶数','']
  ])physics(cmd,label,['内容'],r=>`\\${cmd}{${r[0]}}`,long?[long]:[]);
  physics('qty','自动括号',['括号内'],r=>`\\qty(${r[0]})`,['quantity']);
  for(const [cmd,label,left,right] of [['braket','内积','左态','右态'],['ketbra','外积','左态','右态'],['comm','对易子','左项','右项'],['acomm','反对易子','左项','右项'],['pb','泊松括号','左项','右项'],['flatfrac','斜分式','分子','分母']])
    physics(cmd,label,[left,right],r=>`\\${cmd}{${r[0]}}{${r[1]}}`);
  for(const [cmd,aliases] of [['braket',['ip','innerproduct']],['ketbra',['op','outerproduct','dyad']],['comm',['commutator']],['acomm',['anticommutator']],['pb',['poissonbracket']],['pdv',['partialderivative','pderivative']],['fdv',['functionalderivative','fderivative']]] as const)
    catalog.find(e=>e.type==='physics-'+cmd)!.aliases=[...aliases];
  physics('mel','矩阵元',['左态','算符','右态'],r=>`\\mel{${r[0]}}{${r[1]}}{${r[2]}}`,['matrixelement','matrixel']);
  // Matrix editing continues to use the existing dynamic row/column model.
  for(const [type,aliases] of [['matrix',['mqty','pmqty']],['bmatrix',['bmqty']],['determinant',['vmqty']]] as const)
    catalog.find(e=>e.type===type)!.aliases=[...aliases];
  for(const [command,label,sample] of [['ce','化学式与反应式','2 H2 + O2 -> 2 H2O'],['pu','物理量与单位','1.2e3 kg m/s^2']])
    add('chem-'+command,label,'化学与单位',['化学源码'],r=>`\\${command}{${r[0]}}`,{
      command:'\\'+command,raw:true,previewArgs:[sample]
    });
  // physics redefines \div as divergence; keep existing division atoms as ÷.
  const division=symbols.find(e=>e.type==='symbol-div')!;
  division.command='\\divisionsymbol';division.tex='\\divisionsymbol ';division.aliases=['divsymbol'];
}

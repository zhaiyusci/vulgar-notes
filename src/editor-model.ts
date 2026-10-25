import {registerExtensions} from './extensions';
import {diagnosticSymbol,fontDiagnostic} from './font-diagnostics';
import {registerLetterVariants,textNormal,preferredMathCommand,extensionHasLetter} from './letter-variants';
export type ScriptSlot = 'lower' | 'upper' | 'leftLower' | 'leftUpper';
export type Direction = -1 | 1;
export type MathItem = string | MathNode;
export interface Region {id:string; label:string; items:MathItem[]; slot?:ScriptSlot}
export interface MathNode {id:string; type:string; regions:Region[]; atom?:boolean; operatorLayout?:boolean; rows?:number; columns?:number}
export interface Cursor {region:string; offset:number; anchor:number}
interface SavedState {root:Region;cursor:Cursor}
interface Parent {region:Region; index:number; node:MathNode; childIndex:number}
export interface Definition {
 type:string; label:string; category:string; labels:string[]; render:(r:string[])=>string;
 selectedIndex:number; command:string; tex?:string; atom?:boolean; font?:boolean;
 aliases?:string[]; raw?:boolean; commandCandidate?:boolean; legacy?:boolean;
 hidden?:boolean;letter?:string;exportTex?:string;equivalentTex?:string[];glyphKey?:string;
 previewArgs?:string[]; variantOf?:string; variantLabel?:string; columns?:number;
 matrixEnvironment?:string; matrixAlign?:string; rowEnvironment?:string; rowOptions?:string;
 operator?:boolean; operatorCommand?:string; operatorPlacement?:string;
 scriptSlots?:ScriptSlot[]; scriptLabels?:string[]; legacySlots?:number;
}
export interface CommandCandidate {name:string; type:string; atom:boolean; label:string; category:string}
export interface FontWarning {region:string;index:number;message:string}
/* Content is a tree of sequences. Strings and structures share one sequence;
 * only a structure's arguments introduce new regions. No operator/text slots. */

  let serial = 0;
  const region = (label:string, items:MathItem[] | string = []):Region => ({id: 'r' + ++serial, label, items: typeof items === 'string' ? Array.from(items) : items});
  const structure = (type:string, regions:Region[]):MathNode => ({id: 'n' + ++serial, type, regions});
  const frac = (a:MathItem[] | string, b:MathItem[] | string) => structure('frac', [region('分子', a), region('分母', b)]);
  const sqrt = (a:MathItem[] | string) => structure('sqrt', [region('根号内', a)]);
  // One registry drives the insertion board, editable arguments and export.
  const catalog:Definition[] = [];
  const symbols:Definition[]=[];
  for(const [category,commands] of [
    ['希腊字母','alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa varkappa lambda mu nu xi omicron pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega'],
    ['运算符号','pm mp times div cdot ast star circ bullet oplus ominus otimes oslash odot cap cup uplus sqcap sqcup wedge vee setminus wr diamond'],
    ['关系符号','leq geq neq equiv approx sim simeq cong asymp propto ll gg prec succ preceq succeq in notin ni subset supset subseteq supseteq subsetneq supsetneq nsubseteq nsupseteq parallel nparallel perp mid nmid models vdash dashv bowtie'],
    ['箭头符号','leftarrow rightarrow leftrightarrow Leftarrow Rightarrow Leftrightarrow longleftarrow longrightarrow longleftrightarrow Longleftarrow Longrightarrow Longleftrightarrow mapsto longmapsto hookleftarrow hookrightarrow uparrow downarrow updownarrow Uparrow Downarrow Updownarrow nearrow searrow swarrow nwarrow leftharpoonup leftharpoondown rightharpoonup rightharpoondown rightleftharpoons'],
    ['其他符号','infty partial nabla forall exists nexists neg emptyset varnothing aleph hbar ell imath jmath Re Im wp angle triangle square top bot prime backprime ldots cdots vdots ddots'],
    ['函数名称','sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh coth exp ln log lg arg deg det dim gcd hom ker Pr min max sup inf lim limsup liminf']
  ]) for(const command of commands.split(' '))symbols.push({labels:[],render:()=>'',selectedIndex:0,type:'symbol-'+command,label:command,category,command:'\\'+command,tex:'\\'+command+' ',atom:true});
  for(const name of ['arcsinh','arccosh','arctanh','sgn','tr','rank','erf'])symbols.push({labels:[],render:()=>'',selectedIndex:0,type:'symbol-'+name,label:name,category:'函数名称',command:'\\operatorname{'+name+'}',tex:'\\operatorname{'+name+'}',atom:true});
  const symbolDefinitions=new Map(symbols.map(entry=>[entry.type,entry]));
  const add = (type:string, label:string, category:string, labels:string[], render:(r:string[])=>string, options:Partial<Definition> = {}) => catalog.push({command:'',type, label, category, labels, render, selectedIndex:0, ...options});
  for(const [command,label,sample] of [
    ['mathnormal','默认数学字体','Abx'],['mathrm','正体','Abx'],['mathit','斜体','Abx'],['mathbf','粗体','Abx'],['mathbfit','粗斜体','Abx'],
    ['mathsf','Sans 正体','Abx'],['mathsfit','Sans 斜体','Abx'],['mathbfsf','Sans 粗体','Abx'],['mathbfsfit','Sans 粗斜体','Abx'],
    ['mathtt','等宽','Abx'],['mathbb','黑板粗体','RNC'],['mathcal','花体','ABC'],['mathscr','手写花体','ABC'],['mathfrak','哥特体','Abx'],['boldsymbol','加粗符号','\\alpha+x']
  ])add('font-'+command,label,'数学字体',['字体内容'],r=>`\\${command}{${r[0]}}`,{font:true,previewArgs:[sample],command:'\\'+command});
  for (const type of ['frac','dfrac','tfrac','binom'] as const) add(type, ({frac:'分式',dfrac:'大分式',tfrac:'行内分式',binom:'二项式系数'})[type], '分式与根式', ['分子','分母'], r=>`\\${type}{${r[0]}}{${r[1]}}`);
  add('sqrt','平方根','分式与根式',['根号内'],r=>`\\sqrt{${r[0]}}`);
  add('nthroot','n 次根','分式与根式',['根号内','根指数'],r=>`\\sqrt[${r[1]}]{${r[0]}}`);
  add('power','上标','上下标',['底数','上标'],r=>`{${r[0]}}^{${r[1]}}`);
  add('subscript','下标','上下标',['底数','下标'],r=>`{${r[0]}}_{${r[1]}}`);
  add('sup','上下标','上下标',['底数','下标','上标'],r=>`{${r[0]}}_{${r[1]}}^{${r[2]}}`);
  for (const [type,label,left,right] of [['parens','圆括号','(',')'],['brackets','方括号','[',']'],['braces','花括号','\\{','\\}'],['abs','绝对值','|','|'],['norm','范数','\\lVert','\\rVert'],['floor','向下取整','\\lfloor','\\rfloor'],['ceil','向上取整','\\lceil','\\rceil']])
    add(type,label,'括号与定界符',['括号内'],r=>`\\left${left} ${r[0]}\\right${right}`);
  for (const [type,label,command] of [['sum','求和','sum'],['prod','连乘','prod'],['bigcup','大并集','bigcup'],['bigcap','大交集','bigcap'],['integral','积分','int'],['doubleIntegral','二重积分','iint'],['contourIntegral','围道积分','oint']])
    add(type,label,'大型算符',['下限','上限','运算内容'],r=>`\\${command}\\limits_{${r[0]}}^{${r[1]}} ${r[2]}`,{selectedIndex:2});
  add('limit','极限','大型算符',['趋近条件','表达式'],r=>`\\lim_{${r[0]}} ${r[1]}`,{selectedIndex:1});
  for (const [type,label,env,size] of [['matrix','圆括号矩阵','pmatrix',2],['bmatrix','方括号矩阵','bmatrix',2],['plainmatrix','无括号矩阵','matrix',2],['determinant','行列式','vmatrix',2],['normmatrix','双竖线矩阵','Vmatrix',2],['matrix3','3 × 3 矩阵','pmatrix',3]] as const) {
    add(type,label,'矩阵与多行',Array.from({length:size*size},(_,i)=>`矩阵第${Math.floor(i/size)+1}行第${i%size+1}列`),r=>`\\begin{${env}}${Array.from({length:size},(_,i)=>r.slice(i*size,(i+1)*size).join('&')).join('\\\\')}\\end{${env}}`,{columns:size});
  }
  add('cases','分段函数','矩阵与多行',['第一段表达式','第一段条件','第二段表达式','第二段条件'],r=>`\\begin{cases}${r[0]}&${r[1]}\\\\${r[2]}&${r[3]}\\end{cases}`,{columns:2});
  add('aligned','两行对齐','矩阵与多行',['第一行左侧','第一行右侧','第二行左侧','第二行右侧'],r=>`\\begin{aligned}${r[0]}&${r[1]}\\\\${r[2]}&${r[3]}\\end{aligned}`,{columns:2});
  for (const [type,label,command] of [
    ['hat','帽子','hat'],['widehat','宽帽子','widehat'],
    ['tilde','波浪线','tilde'],['widetilde','宽波浪线','widetilde'],
    ['bar','短横线','bar'],['overline','上划线','overline'],['underline','下划线','underline'],
    ['acute','锐音符','acute'],['grave','重音符','grave'],['breve','短音符','breve'],['check','抑扬符','check'],['mathring','圆圈重音','mathring'],
    ['dot','单点','dot'],['ddot','双点','ddot'],['dddot','三点','dddot'],['ddddot','四点','ddddot'],
    ['vector','向量箭头','vec'],['overrightarrow','上右箭头','overrightarrow'],['overleftarrow','上左箭头','overleftarrow'],['overleftrightarrow','上双向箭头','overleftrightarrow'],
    ['underrightarrow','下右箭头','underrightarrow'],['underleftarrow','下左箭头','underleftarrow'],['underleftrightarrow','下双向箭头','underleftrightarrow']
  ])
    add(type,label,'重音与修饰',['内容'],r=>`\\${command}{${r[0]}}`,{command:'\\'+command,previewArgs:[/^(wide|over|under)/.test(command)?'xy':'x']});
  add('overbrace','上花括号注释','标注与箭头',['内容','上方注释'],r=>`\\overbrace{${r[0]}}^{${r[1]}}`);
  add('underbrace','下花括号注释','标注与箭头',['内容','下方注释'],r=>`\\underbrace{${r[0]}}_{${r[1]}}`);
  add('overset','上方标注','标注与箭头',['主体','上方标注'],r=>`\\overset{${r[1]}}{${r[0]}}`);
  add('underset','下方标注','标注与箭头',['主体','下方标注'],r=>`\\underset{${r[1]}}{${r[0]}}`);
  add('arrow','带标注右箭头','标注与箭头',['上方标注','下方标注'],r=>`\\xrightarrow[${r[1]}]{${r[0]}}`);
  add('boxed','方框','标注与箭头',['内容'],r=>`\\boxed{${r[0]}}`);
  add('cancel','删除线','标注与箭头',['内容'],r=>`\\cancel{${r[0]}}`);
  // Distinct forms audited against base/AMS, mathtools and cancel command lists.
  for (const [type,label] of [['dbinom','显示二项式系数'],['tbinom','行内二项式系数'],['cfrac','连分式']])
    add(type,label,'分式与根式',['分子','分母'],r=>`\\${type}{${r[0]}}{${r[1]}}`);
  for (const [align,label] of [['l','左对齐连分式'],['r','右对齐连分式']])
    add('cfrac'+align,label,'分式与根式',['分子','分母'],r=>`\\cfrac[${align}]{${r[0]}}{${r[1]}}`);
  for (const [type,label] of [['splitfrac','两行无横线分式'],['splitdfrac','显示两行无横线分式']])
    add(type,label,'分式与根式',['上行','下行'],r=>`\\${type}{${r[0]}}{${r[1]}}`);
  add('atop','无横线堆叠','分式与根式',['上行','下行'],r=>`{${r[0]}\\atop ${r[1]}}`);
  add('genfracBrackets','方括号无横线分式','分式与根式',['上行','下行'],r=>`\\genfrac{[}{]}{0pt}{}{${r[0]}}{${r[1]}}`);
  add('genfracBraces','花括号无横线分式','分式与根式',['上行','下行'],r=>`\\genfrac{\\{}{\\}}{0pt}{}{${r[0]}}{${r[1]}}`);
  add('substack','多行上下标','上下标',['第一行','第二行'],r=>`\\substack{${r[0]}\\\\${r[1]}}`);
  for(const [align,label] of [['l','左对齐多行上下标'],['c','居中多行上下标']])add('subarray'+align,label,'上下标',['第一行','第二行'],r=>`\\begin{subarray}{${align}}${r[0]}\\\\${r[1]}\\end{subarray}`);
  add('prescript','左侧上下标','上下标',['主体','左上标','左下标'],r=>`\\prescript{${r[1]}}{${r[2]}}{${r[0]}}`);
  add('leftPower','左侧上标','上下标',['主体','左上标'],r=>`\\prescript{${r[1]}}{}{${r[0]}}`);
  add('leftSubscript','左侧下标','上下标',['主体','左下标'],r=>`\\prescript{}{${r[1]}}{${r[0]}}`);
  add('sideset','算符左右上下标','上下标',['左下标','左上标','右下标','右上标','运算内容'],r=>`\\sideset{_{${r[0]}}^{${r[1]}}}{_{${r[2]}}^{${r[3]}}}\\sum ${r[4]}`,{selectedIndex:4});
  for(const [type,label,left,right] of [['angles','尖括号','\\langle','\\rangle'],['leftBrace','单侧左花括号','\\{','.'],['rightBrace','单侧右花括号','.','\\}'],['evaluation','右侧竖线求值','.','|'],['slashFence','斜线定界符','/','/'],['backslashFence','反斜线定界符','\\backslash','\\backslash']])
    add(type,label,'括号与定界符',['内容'],r=>`\\left${left} ${r[0]}\\right${right}`);
  for(const [size,label] of [['big','固定小括号'],['Big','固定中括号'],['bigg','固定大括号'],['Bigg','固定特大括号']])
    add('paren'+size,label,'括号与定界符',['内容'],r=>`\\${size}l( ${r[0]}\\${size}r)`);
  for(const [type,label] of [['coprod','余积'],['bigsqcup','大方并集'],['biguplus','大不交并'],['bigvee','大析取'],['bigwedge','大合取'],['bigodot','大圆点积'],['bigoplus','大直和'],['bigotimes','大张量积'],['iiint','三重积分'],['iiiint','四重积分'],['idotsint','多重积分省略形式']])
    add(type,label,'大型算符',['下限','上限','运算内容'],r=>`\\${type}\\limits_{${r[0]}}^{${r[1]}} ${r[2]}`,{selectedIndex:2});
  for(const [cmd,label] of [['sum','求和'],['prod','连乘'],['int','积分'],['iint','二重积分'],['iiint','三重积分'],['oint','围道积分']])
    add(cmd+'Side',label+'（侧上下限）','大型算符',['下限','上限','运算内容'],r=>`\\${cmd}\\nolimits_{${r[0]}}^{${r[1]}} ${r[2]}`,{selectedIndex:2});
  for(const [cmd,label] of [['limsup','上极限'],['liminf','下极限'],['sup','上确界'],['inf','下确界'],['max','最大值'],['min','最小值']])
    add('op'+cmd,label,'大型算符',['条件','表达式'],r=>`\\${cmd}_{${r[0]}} ${r[1]}`,{selectedIndex:1});
  for(const [env,label] of [['Bmatrix','花括号矩阵'],['smallmatrix','行内小矩阵'],['psmallmatrix','圆括号小矩阵'],['bsmallmatrix','方括号小矩阵'],['Bsmallmatrix','花括号小矩阵'],['vsmallmatrix','小行列式'],['Vsmallmatrix','双竖线小矩阵']])
    add(env,label,'矩阵与多行',['第一行第一列','第一行第二列','第二行第一列','第二行第二列'],r=>`\\begin{${env}}${r[0]}&${r[1]}\\\\${r[2]}&${r[3]}\\end{${env}}`,{columns:2});
  for(const [env,label] of [['rcases','右侧分段括号'],['dcases','显示分段函数'],['drcases','显示右侧分段括号']])
    add(env,label,'矩阵与多行',['第一段表达式','第一段条件','第二段表达式','第二段条件'],r=>`\\begin{${env}}${r[0]}&${r[1]}\\\\${r[2]}&${r[3]}\\end{${env}}`,{columns:2});
  for(const [env,label] of [['gathered','两行居中'],['lgathered','两行左对齐'],['rgathered','两行右对齐'],['multlined','多行首尾对齐']])
    add(env,label,'矩阵与多行',['第一行','第二行'],r=>`\\begin{${env}}${r[0]}\\\\${r[1]}\\end{${env}}`,{columns:1});
  add('alignedat','紧凑两行对齐','矩阵与多行',['第一行左侧','第一行右侧','第二行左侧','第二行右侧'],r=>`\\begin{alignedat}{1}${r[0]}&${r[1]}\\\\${r[2]}&${r[3]}\\end{alignedat}`,{columns:2});
  add('array','两列左对齐数组','矩阵与多行',['第一行第一列','第一行第二列','第二行第一列','第二行第二列'],r=>`\\begin{array}{ll}${r[0]}&${r[1]}\\\\${r[2]}&${r[3]}\\end{array}`,{columns:2});
  for(const [env,label] of [['pmatrix','圆括号'],['bmatrix','方括号']])for(const [align,name] of [['l','左对齐'],['r','右对齐']])
    add(env+align,label+name+'矩阵','矩阵与多行',['第一行第一列','第一行第二列','第二行第一列','第二行第二列'],r=>`\\begin{${env}*}[${align}]${r[0]}&${r[1]}\\\\${r[2]}&${r[3]}\\end{${env}*}`,{columns:2});
  for(const [type,label] of [['overbracket','上方括号注释'],['underbracket','下方括号注释']])
    add(type,label,'标注与箭头',['内容','注释'],r=>`\\${type}{${r[0]}}${type==='overbracket'?'^':'_'}{${r[1]}}`);
  for(const [cmd,label] of [['xleftarrow','带标注左箭头'],['xleftrightarrow','带标注双向箭头'],['xLeftarrow','带标注左双线箭头'],['xRightarrow','带标注右双线箭头'],['xLeftrightarrow','带标注双向双线箭头'],['xhookleftarrow','带标注左钩箭头'],['xhookrightarrow','带标注右钩箭头'],['xmapsto','带标注映射箭头'],['xleftharpoonup','左上鱼叉箭头'],['xleftharpoondown','左下鱼叉箭头'],['xrightharpoonup','右上鱼叉箭头'],['xrightharpoondown','右下鱼叉箭头'],['xleftrightharpoons','左右平衡箭头'],['xrightleftharpoons','右左平衡箭头']])
    add(cmd,label,'标注与箭头',['上方标注','下方标注'],r=>`\\${cmd}[${r[1]}]{${r[0]}}`);
  for(const [cmd,label] of [['bcancel','反向删除线'],['xcancel','交叉删除线']])add(cmd,label,'标注与箭头',['内容'],r=>`\\${cmd}{${r[0]}}`);
  add('cancelto','消去至指定值','标注与箭头',['内容','目标值'],r=>`\\cancelto{${r[1]}}{${r[0]}}`);
  for(const [cmd,label] of [['xlongleftarrow','长左箭头'],['xlongrightarrow','长右箭头'],['xLongleftarrow','长左双线箭头'],['xLongrightarrow','长右双线箭头']])add(cmd,label,'标注与箭头',['上方标注','下方标注'],r=>`\\${cmd}[${r[1]}]{${r[0]}}`);
  registerExtensions(catalog,symbols);
  add('text-normal','描述文字','文字',['描述文字'],r=>textNormal(r[0]),{raw:true,command:'\\textnormal',aliases:['textrm'],previewArgs:['说明']});
  registerLetterVariants(catalog,symbols);
  add('font-bboldx-bold','黑板粗体','数学字体',['字体内容'],r=>'\\mathbfbb{'+r[0]+'}',{font:true,hidden:true,commandCandidate:false,command:'\\mathbfbb'});
  symbols.forEach(entry=>symbolDefinitions.set(entry.type,entry));
  // Layout variants remain insertable but live in their primary button's menu.
  const variantGroups = {
    sqrt:{sqrt:'平方根',nthroot:'带指数根式'},
    frac:{frac:'默认尺寸',dfrac:'显示尺寸',tfrac:'行内尺寸'},
    binom:{binom:'默认尺寸',dbinom:'显示尺寸',tbinom:'行内尺寸'},
    cfrac:{cfrac:'居中对齐',cfracl:'左对齐',cfracr:'右对齐'},
    splitfrac:{splitfrac:'默认尺寸',splitdfrac:'显示尺寸'},
    substack:{substack:'默认',subarrayc:'居中对齐',subarrayl:'左对齐'},
    parens:{parens:'自动伸缩',parenbig:'固定尺寸 · 小',parenBig:'固定尺寸 · 中',parenbigg:'固定尺寸 · 大',parenBigg:'固定尺寸 · 特大'},
    sum:{sum:'上下限在上下',sumSide:'上下限在侧边'},
    prod:{prod:'上下限在上下',prodSide:'上下限在侧边'},
    integral:{integral:'上下限在上下',intSide:'上下限在侧边'},
    doubleIntegral:{doubleIntegral:'上下限在上下',iintSide:'上下限在侧边'},
    iiint:{iiint:'上下限在上下',iiintSide:'上下限在侧边'},
    contourIntegral:{contourIntegral:'上下限在上下',ointSide:'上下限在侧边'},
    matrix:{matrix:'默认 · 2 × 2 居中',pmatrixl:'左对齐',pmatrixr:'右对齐',psmallmatrix:'行内小尺寸',matrix3:'3 × 3'},
    bmatrix:{bmatrix:'默认 · 居中',bmatrixl:'左对齐',bmatrixr:'右对齐',bsmallmatrix:'行内小尺寸'},
    plainmatrix:{plainmatrix:'默认尺寸',smallmatrix:'行内小尺寸'},
    Bmatrix:{Bmatrix:'默认尺寸',Bsmallmatrix:'行内小尺寸'},
    determinant:{determinant:'默认尺寸',vsmallmatrix:'行内小尺寸'},
    normmatrix:{normmatrix:'默认尺寸',Vsmallmatrix:'行内小尺寸'},
    cases:{cases:'默认尺寸',dcases:'显示尺寸'},
    rcases:{rcases:'默认尺寸',drcases:'显示尺寸'},
    gathered:{gathered:'居中对齐',lgathered:'左对齐',rgathered:'右对齐'},
    aligned:{aligned:'默认间距',alignedat:'紧凑间距'},
    arrow:{arrow:'默认长度',xlongrightarrow:'加长'},
    xleftarrow:{xleftarrow:'默认长度',xlongleftarrow:'加长'},
    xRightarrow:{xRightarrow:'默认长度',xLongrightarrow:'加长'},
    xLeftarrow:{xLeftarrow:'默认长度',xLongleftarrow:'加长'}
  };
  for (const [primary, variants] of Object.entries(variantGroups)) {
    for (const [type, label] of Object.entries(variants)) {
      const entry = catalog.find(item => item.type === type)!;
      entry.variantOf = primary; entry.variantLabel = label;
    }
  }
  // Show the exact syntax on hover, including variants/options, not just a name.
  for(const entry of catalog) if(!entry.command) entry.command=entry.render(entry.labels.map(()=>'…'));
  const definitions = new Map(catalog.map(entry=>[entry.type,entry]));
  for(const [type,env,align] of [
    ['matrix','pmatrix'],['matrix3','pmatrix'],['bmatrix','bmatrix'],['plainmatrix','matrix'],
    ['determinant','vmatrix'],['normmatrix','Vmatrix'],['Bmatrix','Bmatrix'],
    ...['smallmatrix','psmallmatrix','bsmallmatrix','Bsmallmatrix','vsmallmatrix','Vsmallmatrix'].map(env=>[env,env]),
    ['pmatrixl','pmatrix*','l'],['pmatrixr','pmatrix*','r'],['bmatrixl','bmatrix*','l'],['bmatrixr','bmatrix*','r'],['array','array','l']
  ]) Object.assign(definitions.get(type)!,{matrixEnvironment:env,matrixAlign:align});
  for(const type of ['cases','rcases','dcases','drcases','aligned','alignedat','gathered','lgathered','rgathered','multlined','substack','subarrayl','subarrayc']){
    const entry=definitions.get(type)!;
    entry.label=entry.label.replace('两行','多行');
    Object.assign(entry,{rowEnvironment:type.startsWith('subarray')?'subarray':type,columns:entry.columns || 1,
      rowOptions:type==='alignedat'?'{1}':type==='subarrayl'?'{l}':type==='subarrayc'?'{c}':''});
  }
  for(const entry of catalog.filter(e=>e.category==='大型算符'||e.type==='sideset')){
    const sample=entry.render(entry.labels.map(()=>''));
    entry.operator=true;
    entry.operatorCommand=entry.type==='sideset'?'sum':sample.match(/^\\([a-zA-Z]+)/)![1];
    entry.operatorPlacement=sample.includes('\\nolimits')?'\\nolimits':'';
    entry.scriptSlots=entry.type==='sideset'?['leftLower','leftUpper','lower','upper']:['lower','upper'];
    entry.scriptLabels=entry.type==='sideset'?['左下标','左上标','右下标','右上标']:['下限','上限'];
    entry.legacySlots=entry.labels.length-1;
    entry.previewArgs=entry.labels.map(()=> '');
  }
  // Default operators delegate placement to MathJax; explicit placement is a variant.
  for(const entry of catalog.filter(e=>e.category==='大型算符' && !e.operatorPlacement)){
    const originalRender=entry.render;
    entry.render=r=>originalRender(r).replace(/\\(?:no)?limits/g,'');
    entry.command=entry.render(entry.labels.map(()=>'…'));
    entry.variantOf=entry.type;entry.variantLabel='自动';
    for(const [suffix,placement,label] of [['Limits','\\limits','强制上下'],['Side','\\nolimits','强制侧边']]){
      const existing=catalog.find(e=>e.operator && e.operatorCommand===entry.operatorCommand && e.operatorPlacement===placement);
      if(existing){existing.variantOf=entry.type;existing.variantLabel=label;continue;}
      const variant={...entry,type:entry.type+suffix,operatorPlacement:placement,variantLabel:label,
        render:(r:string[])=>entry.render(r).replace('\\'+entry.operatorCommand,'\\'+entry.operatorCommand+placement)};
      variant.command=variant.render(variant.labels.map(()=>'…'));
      catalog.push(variant);definitions.set(variant.type,variant);
    }
  }
  function example(kind:string) {
    let node;
    if (kind === 'frac') node = frac('a+b', 'c');
    else if (kind === 'sqrt') node = sqrt('x+1');
    else if (kind === 'sup') node = structure('sup', [region('底数', 'x'), region('下标', 'i'), region('上标', '2')]);
    else if (kind === 'matrix') node = structure('matrix', ['a','b','c','d'].map((s, i) => region(`矩阵第${Math.floor(i / 2) + 1}行第${i % 2 + 1}列`, s)));
    else node = frac([sqrt('x+1')], ['a', '+', frac('b', 'c')]);
    return region('公式', [node]);
  }
  function texChar(ch:string):string {
    return ({'\\':'\\backslash ', '{':'\\{', '}':'\\}', '$':'\\$', '%':'\\%', '#':'\\#', '&':'\\&', '_':'\\_ ', '^':'\\unicode{x005E}', '~':'\\unicode{x007E}', ' ':'\\ ', '\n':'\\ ', '\r':''})[ch] ?? ch;
  }
  function structureTex(node:MathNode, renderRegion:(r:Region)=>string):string {
    if(node.atom){const def=symbolDefinitions.get(node.type)!;return renderRegion===latex?(def.exportTex??def.tex!):def.tex!;}
    const raw=definitions.get(node.type);
    if(raw?.raw)return raw.render(node.regions.map(r=>r.items.map(item=>typeof item==='string'?item:structureTex(item,latex)).join('')));
    const r = node.regions.map(renderRegion);
    const definition=definitions.get(node.type);
    if(definition?.operator){
      const script=(slot:ScriptSlot)=>{const i=node.regions.findIndex(r=>r.slot===slot);return i<0?'':`${slot.toLowerCase().includes('lower')?'_':'^'}{${r[i]}}`;};
      if(node.type==='sideset'){
        const left=script('leftLower')+script('leftUpper'),right=script('lower')+script('upper');
        return left||right?`\\sideset{${left}}{${right}}\\sum `:'\\sum ';
      }
      return `\\${definition.operatorCommand}${definition.operatorPlacement}${script('lower')}${script('upper')} `;
    }
    if(definition?.matrixEnvironment || definition?.rowEnvironment){
      const columns=node.columns || definition.columns || 1, env=definition.matrixEnvironment || definition.rowEnvironment;
      const options=env==='array'?`{${(definition.matrixAlign || 'c').repeat(columns)}}`:definition.matrixAlign?`[${definition.matrixAlign}]`:definition.rowOptions || '';
      const content=Array.from({length:r.length/columns},(_,i)=>r.slice(i*columns,(i+1)*columns).join('&')).join('\\\\');
      return env==='substack'?`\\substack{${content}}`:`\\begin{${env}}${options}${content}\\end{${env}}`;
    }
    if (definitions.has(node.type)) return definitions.get(node.type)!.render(r);
    throw new Error('Unknown structure: ' + node.type);
  }
  const styledLatex=(r:Region,command:string):string=>r.items.map(item=>{
    const char=typeof item==='string'?item:symbolDefinitions.get(item.type)?.letter;
    const base=char?symbols.find(d=>d.letter===char&&d.variantOf===d.type):undefined;
    const variant=base?symbolDefinitions.get(base.type+'--'+command):undefined;
    if(variant)return variant.exportTex??variant.tex!;
    if(typeof item==='string')return texChar(item);
    if(definitions.get(item.type)?.font)return latex({id:'',label:'',items:[item]});
    return structureTex(item,child=>styledLatex(child,command));
  }).join('');
  const latex = (r:Region):string => r.items.map(item => {
    if(typeof item==='string')return texChar(item);
    const def=definitions.get(item.type);
    if(def?.font){
      const command=def.command.slice(1);
      if(command==='symbb'||command==='mathbfbb')return styledLatex(item.regions[0],command==='symbb'?'editorbboldx':'editorbboldxbold');
      return '\\'+preferredMathCommand(command)+'{'+latex(item.regions[0])+'}';
    }
    return structureTex(item,latex);
  }).join('');
  function isObject(value:unknown):value is Record<string,unknown> {
    return typeof value==='object' && value!==null && !Array.isArray(value);
  }
  // Saved JSON is a runtime boundary: TypeScript cannot validate sessionStorage.
  function isSavedState(value:unknown):value is SavedState {
    if(!isObject(value) || !isObject(value.cursor))return false;
    const ids=new Set<string>(),regionLengths=new Map<string,number>();
    const validId=(id:unknown,prefix:string):id is string=>{
      if(typeof id!=='string' || !new RegExp(`^${prefix}\\d+$`).test(id) || ids.has(id))return false;
      ids.add(id);return true;
    };
    const validRegion=(r:unknown,depth:number):boolean=>{
      if(depth>200 || !isObject(r) || !validId(r.id,'r') || typeof r.label!=='string' || !Array.isArray(r.items))return false;
      if(r.slot!==undefined && !['lower','upper','leftLower','leftUpper'].includes(String(r.slot)))return false;
      regionLengths.set(r.id,r.items.length);
      return r.items.every((item:unknown)=>{
        if(typeof item==='string')return Array.from(item).length===1;
        if(!isObject(item) || !validId(item.id,'n') || typeof item.type!=='string' || !Array.isArray(item.regions))return false;
        if(item.atom!==undefined && typeof item.atom!=='boolean')return false;
        if(item.operatorLayout!==undefined && typeof item.operatorLayout!=='boolean')return false;
        // Migrate retired blackboard implementations without loading their fonts.
        const type=item.type.replace(/--(?:mathbbm(?:ss|tt)?|editorbbm(?:ss)?bold|mathds|editordssans)$/, '--editorbboldx');
        item.type=type;
        if(item.atom ? !symbolDefinitions.has(type) || item.regions.length!==0 : !definitions.has(type))return false;
        for(const key of ['rows','columns'])if(item[key]!==undefined && (!Number.isSafeInteger(item[key]) || Number(item[key])<1))return false;
        return item.regions.every(child=>validRegion(child,depth+1));
      });
    };
    if(!validRegion(value.root,0))return false;
    const cursor=value.cursor;
    if(typeof cursor.region!=='string' || !regionLengths.has(cursor.region))return false;
    const length=regionLengths.get(cursor.region)!;
    return [cursor.offset,cursor.anchor].every(n=>typeof n==='number' && Number.isSafeInteger(n) && n>=0 && n<=length);
  }
  class EditorModel {
 root:Region; cursor:Cursor; undoStack:string[]=[]; redoStack:string[]=[];
 regions=new Map<string,Region>(); parents=new Map<string,Parent>(); nodes=new Map<string,MathNode>(); order:string[]=[];
    constructor(kind = 'nested') {
      this.root = example(kind);
      this.cursor = {region: this.root.id, offset: this.root.items.length, anchor: this.root.items.length};
      this.undoStack = []; this.redoStack = [];
      this.index();
    }
    index() {
      // Upgrade saved drafts: move the old body slot into its surrounding flow.
      const migrate=(r:Region)=>{
        for(let i=0;i<r.items.length;i++){
          const node=r.items[i];if(typeof node==='string')continue;
          const def=definitions.get(node.type);
          if(def?.operator && !node.operatorLayout){
            const body=node.regions[def.legacySlots ?? 0], old=node.regions;
            node.regions=old.slice(0,def.legacySlots).filter((child,j)=>{
              child.slot=def.scriptSlots![j];return child.items.length>0;
            });node.operatorLayout=true;
            const content=body?.items || [];
            r.items.splice(i+1,0,...content);
            if(this.cursor.region===body?.id)this.cursor={region:r.id,offset:i+1+this.cursor.offset,anchor:i+1+this.cursor.anchor};
            else if(old.some(child=>child.id===this.cursor.region) && !node.regions.some(child=>child.id===this.cursor.region))this.cursor={region:r.id,offset:i+1,anchor:i+1};
            else if(this.cursor.region===r.id){
              if(this.cursor.offset>i)this.cursor.offset+=content.length;
              if(this.cursor.anchor>i)this.cursor.anchor+=content.length;
            }
          }
          node.regions.forEach(migrate);
        }
      };migrate(this.root);
      this.regions = new Map(); this.parents = new Map(); this.nodes = new Map(); this.order = [];
      const visit = (r:Region) => {
        serial=Math.max(serial,Number(r.id.slice(1))||0);
        this.regions.set(r.id, r); this.order.push(r.id);
        r.items.forEach((item, index) => {
          if (typeof item === 'string') return;
          serial=Math.max(serial,Number(item.id.slice(1))||0);
          this.nodes.set(item.id,item);
          const definition=definitions.get(item.type);
          if(definition?.matrixEnvironment || definition?.rowEnvironment){
            item.columns ||= definition.columns || 1;
            const columns=item.columns;
            item.rows=item.regions.length/columns;
            item.regions.forEach((cell,i)=>{
              const row=Math.floor(i/columns)+1,column=i%columns;
              cell.label=definition.matrixEnvironment?`矩阵第${row}行第${column+1}列`:
                `第${row}行${item.columns===1?'内容':/cases$/.test(definition.rowEnvironment || '')?(column?'条件':'表达式'):(column?'右侧':'左侧')}`;
            });
          }
          item.regions.forEach((child, childIndex) => {
            this.parents.set(child.id, {region: r, index, node: item, childIndex}); visit(child);
          });
        });
      };
      visit(this.root);
    }
    get current():Region { const r=this.regions.get(this.cursor.region); if(!r)throw new Error('Invalid cursor region'); return r; }
    get range():[number,number] { return [Math.min(this.cursor.offset, this.cursor.anchor), Math.max(this.cursor.offset, this.cursor.anchor)]; }
    setCursor(id:string, offset:number, anchor = offset) {
      const r = this.regions.get(id); if (!r) return;
      const clamp = (x:number) => Math.max(0, Math.min(r.items.length, x));
      this.cursor = {region: id, offset: clamp(offset), anchor: clamp(anchor)};
    }
    snapshot() { return JSON.stringify({root: this.root, cursor: this.cursor}); }
    restore(snapshot:string) {
      const state:unknown=JSON.parse(snapshot);
      if(!isSavedState(state))throw new Error('Invalid editor snapshot');
      this.root=state.root;this.cursor=state.cursor;this.index();
    }
    record() { this.undoStack.push(this.snapshot()); if (this.undoStack.length > 100) this.undoStack.shift(); this.redoStack = []; }
    undo() { if (!this.undoStack.length) return; this.redoStack.push(this.snapshot()); this.restore(this.undoStack.pop()!); }
    redo() { if (!this.redoStack.length) return; this.undoStack.push(this.snapshot()); this.restore(this.redoStack.pop()!); }
    replace(start:number, end:number, text:string) {
      this.record();
      const hadContent=this.current.items.length>0;
      const chars = Array.from(text).filter(ch => ch !== '\uFFFC' && ch !== '\r' && ch !== '\n');
      this.current.items.splice(start, end - start, ...chars);
      this.setCursor(this.cursor.region, start + chars.length); this.index();
      if(hadContent)this.removeEmptyScript();
    }
    emptyScriptParent() {
      const parent=this.parents.get(this.cursor.region);
      if(this.current.items.length || !parent)return null;
      return definitions.get(parent.node.type)?.operator ||
        (parent.node.type==='nthroot' && parent.childIndex===1) ||
        (parent.childIndex>0 && ['power','subscript','sup','leftPower','leftSubscript','prescript'].includes(parent.node.type))?parent:null;
    }
    removeEmptyScript() {
      const parent=this.emptyScriptParent();if(!parent)return false;
      const {node,region:outer,index,childIndex}=parent;
      if(node.type==='nthroot'){
        node.type='sqrt';node.regions=[node.regions[0]];
        this.index();this.setCursor(outer.id,index+1);return true;
      }
      if(definitions.get(node.type)?.operator){
        node.regions.splice(childIndex,1);this.index();this.setCursor(outer.id,index+1);return true;
      }
      const both=node.type==='sup'||node.type==='prescript';
      const other=both?node.regions[childIndex===1?2:1]:null;
      if(other?.items.length){
        node.type=node.type==='sup'?(childIndex===1?'power':'subscript'):(childIndex===1?'leftSubscript':'leftPower');
        node.regions=[node.regions[0],other];this.index();this.setCursor(outer.id,index+1);
      }else{
        const base=node.regions[0].items;
        outer.items.splice(index,1,...base);this.index();this.setCursor(outer.id,index+base.length);
        // Unwrapping an empty base may also empty a surrounding script.
        this.removeEmptyScript();
      }
      return true;
    }
    insert(text:string) { this.replace(...this.range, text); }
    get rawInput():boolean {return !!definitions.get(this.parents.get(this.cursor.region)?.node.type || '')?.raw;}
    commandQuery() {
      if(this.rawInput)return null;
      const [start,end]=this.range;if(start!==end)return null;
      let from=end;
      while(from>0 && typeof this.current.items[from-1]==='string' && /^[a-zA-Z]$/.test(String(this.current.items[from-1])))from--;
      if(this.current.items[from-1]!=='\\')return null;
      const name=this.current.items.slice(from,end).join('');
      return {from:from-1,end,name};
    }
    commandCandidates() {
      const query=this.commandQuery();if(!query)return [];
      const entries=new Map<string,CommandCandidate>();
      for(const entry of [...symbols,...catalog]){
        if(entry.commandCandidate===false)continue;
        const name=entry.atom && entry.command.startsWith('\\operatorname')?entry.type.slice(7):entry.command?.match(/^\\([a-zA-Z]+)/)?.[1];
        for(const candidate of [name,...(entry.aliases || [])])
          if(candidate && candidate!=='begin' && !entries.has(candidate))entries.set(candidate,{name:candidate,type:entry.type,atom:!!entry.atom,label:entry.label,category:entry.category});
      }
      const common=['sin','cos','tan','exp','log','alpha','beta','pi','frac','sqrt','sum','int','mathbf'];
      return [...entries.values()].filter(e=>e.name.startsWith(query.name)).sort((a,b)=>{
        const rank=(e:CommandCandidate)=>e.name===query.name?-2:common.includes(e.name)?common.indexOf(e.name):100;
        return rank(a)-rank(b) || a.name.localeCompare(b.name);
      });
    }
    pendingCommand() {
      const query=this.commandQuery();if(!query)return null;
      const entry=this.commandCandidates().find(e=>e.name===query.name);
      return entry?{...query,...entry}:null;
    }
    commitCommand(record=true,name:string|null=null) {
      const query=this.commandQuery();
      const command=name && query?this.commandCandidates().find(e=>e.name===name):this.pendingCommand();
      if(!query || !command)return false;
      if(record)this.record();
      this.current.items.splice(query.from,query.end-query.from);
      this.setCursor(this.cursor.region,query.from);this.index();
      if(command.atom)this.insertSymbol(command.type,false);else this.insertStructure(command.type,false);
      return true;
    }
    replaceInput(start:number,end:number,text:string) {
      if(this.rawInput){this.replace(start,end,text);return;}
      const hasCommand=text.includes('\\') || this.current.items.slice(0,start).includes('\\');
      if(!/[\^_]/.test(text) && (!hasCommand || !text)){this.replace(start,end,text);return;}
      this.record();this.setCursor(this.cursor.region,end,start);
      for(const ch of Array.from(text)){
        if(!/[a-zA-Z]/.test(ch) && this.commitCommand(false) && /\s/.test(ch))continue;
        if(!this.rawInput && (ch==='^' || ch==='_')){this.enterScript(ch);continue;}
        if(['\uFFFC','\r','\n'].includes(ch))continue;
        const [a,b]=this.range;this.current.items.splice(a,b-a,ch);this.setCursor(this.cursor.region,a+1);this.index();
      }
    }
    enterScript(marker:string) {
      const upper=marker==='^', [start,end]=this.range;
      const parent=this.parents.get(this.cursor.region);
      const previousOperator=start===end && start>0?this.current.items[start-1]:null;
      const operator=start===end && end===this.current.items.length && parent && definitions.get(parent.node.type)?.operator?parent.node:
        previousOperator && typeof previousOperator!=='string' && definitions.get(previousOperator.type)?.operator?previousOperator:null;
      if(operator){this.ensureOperatorScript(operator,upper?'upper':'lower');return;}
      let node:MathNode|null=null;
      // x^2_i switches from the upper argument to the lower one on the same x.
      if(start===end && end===this.current.items.length && parent){
        const type=parent.node.type, child=parent.childIndex;
        const opposite=(type==='power' && !upper && child===1)||(type==='subscript' && upper && child===1)||
          (type==='sup' && child===(upper?1:2));
        if(opposite)node=parent.node;
      }
      const previous=start===end && start>0?this.current.items[start-1]:null;
      if(!node && previous && typeof previous!=='string' && ['power','subscript','sup'].includes(previous.type))node=previous;
      if(node){
        if(node.type==='power' && !upper){node.type='sup';node.regions.splice(1,0,region('下标'));}
        else if(node.type==='subscript' && upper){node.type='sup';node.regions.push(region('上标'));}
        const target=node.regions[node.type==='sup'?(upper?2:1):1];
        this.index();this.setCursor(target.id,target.items.length);return;
      }
      const container=this.current;
      const from=start===end?Math.max(0,start-1):start;
      const base=container.items.slice(from,end);
      node=structure(upper?'power':'subscript',[region('底数',base),region(upper?'上标':'下标')]);
      container.items.splice(from,end-from,node);this.index();this.setCursor(node.regions[1].id,0);
    }
    insertSymbol(type:string,record=true) {
      if(!symbolDefinitions.has(type))throw new Error('Unknown symbol: '+type);
      if(this.rawInput){this.insert(symbolDefinitions.get(type)!.tex!);return;}
      if(record)this.record();const [start,end]=this.range;
      this.current.items.splice(start,end-start,{id:'n'+ ++serial,type,atom:true,regions:[]});
      this.setCursor(this.cursor.region,start+1);this.index();
    }
    insertStructure(type:string,record=true) {
      const definition = definitions.get(type);
      if (!definition) throw new Error('Unknown structure: ' + type);
      if(this.rawInput){this.insert(definition.render(definition.labels.map(()=>'')));return;}
      const [start, end] = this.range, parent = this.current;
      const selected = parent.items.slice(start, end);
      const contents=definition.raw?Array.from(selected.map(item=>typeof item==='string'?item:structureTex(item,latex)).join('')):selected;
      if(definition.operator){
        if(record)this.record();const node=structure(type,[]);node.operatorLayout=true;
        parent.items.splice(start,end-start,node,...selected);this.index();
        this.setCursor(parent.id,start+1+selected.length);return;
      }
      const node = structure(type, definition.labels.map((label,i)=>region(label,i===definition.selectedIndex?contents:[])));
      if(record)this.record();
      // Move the selection into the new structure rather than flattening it.
      parent.items.splice(start, end - start, node);
      this.index();
      const entry = node.regions[definition.selectedIndex];
      this.setCursor(entry.id, entry.items.length);
    }
    ensureOperatorScript(node:MathNode,slot:ScriptSlot) {
      const def=definitions.get(node.type)!,i=def.scriptSlots!.indexOf(slot);if(i<0)return;
      let child=node.regions.find(r=>r.slot===slot);
      if(!child){child=region(def.scriptLabels![i]);child.slot=slot;node.regions.push(child);node.regions.sort((a,b)=>def.scriptSlots!.indexOf(a.slot!)-def.scriptSlots!.indexOf(b.slot!));}
      this.index();this.setCursor(child.id,child.items.length);
    }
    toggleOperatorScript(id:string,slot:ScriptSlot) {
      const node=this.nodes.get(id),def=definitions.get(node?.type || '');
      if(!node || !def?.operator || !def.scriptSlots!.includes(slot))return;
      this.record();const index=node.regions.findIndex(r=>r.slot===slot);
      if(index<0){this.ensureOperatorScript(node,slot);return;}
      node.regions.splice(index,1);this.index();
      if(!this.regions.has(this.cursor.region)){
        for(const r of this.regions.values()){const i=r.items.indexOf(node);if(i>=0){this.setCursor(r.id,i+1);break;}}
      }
    }
    canSwitchVariant(id:string, type:string) {
      const node=this.nodes.get(id), target=definitions.get(type)||symbolDefinitions.get(type), source=definitions.get(node?.type || '')||symbolDefinitions.get(node?.type || '');
      if(!node || !source || !target)return false;
      if(source.font && target.font)return true;
      if(!source?.variantOf || source.variantOf!==target?.variantOf)return false;
      if(source.operator && target.operator)return true;
      if(source.variantOf==='sqrt')return true;
      if((source.matrixEnvironment && target.matrixEnvironment) || (source.rowEnvironment && target.rowEnvironment))return true;
      if(source.columns && target.columns){
        const rows=target.labels.length/target.columns;
        return node.regions.every((r,i)=>(Math.floor(i/source.columns!)<rows && i%source.columns!<target.columns!)||r.items.length===0);
      }
      return node.regions.length===target.labels.length;
    }
    switchVariant(id:string,type:string) {
      const node=this.nodes.get(id);
      if(!node || !this.canSwitchVariant(id,type) || node.type===type)return false;
      if(node.atom){this.record();node.type=type;this.index();return true;}
      const source=definitions.get(node.type)!, target=definitions.get(type)!;
      this.record();
      if(source.operator && target.operator){node.type=type;this.index();return true;}
      if(source.variantOf==='sqrt'){
        const parent=this.parents.get(node.regions[0].id)!;
        node.regions=type==='nthroot'?[node.regions[0],region(target.labels[1])]:[node.regions[0]];
        node.type=type;this.index();
        if(type==='nthroot')this.setCursor(node.regions[1].id,0);
        else if(!this.regions.has(this.cursor.region))this.setCursor(parent.region.id,parent.index+1);
        return true;
      }
      if((source.matrixEnvironment && target.matrixEnvironment) || (source.rowEnvironment && target.rowEnvironment)){
        node.type=type;this.index();return true;
      }
      node.regions=target.labels.map((label,i)=>{
        const row=target.columns?Math.floor(i/target.columns):0, col=target.columns?i%target.columns:i;
        const old=source.columns && col>=source.columns?undefined:node.regions[source.columns?row*source.columns+col:i];
        if(old){old.label=label;return old;}
        return region(label);
      });
      node.type=type;this.index();
      if(!this.regions.has(this.cursor.region))this.setCursor(node.regions[0].id,0);
      return true;
    }
    tableCell(id:string, regionId=this.cursor.region) {
      const node=this.nodes.get(id);
      const definition=definitions.get(node?.type || '');
      if(!node || (!definition?.matrixEnvironment && !definition?.rowEnvironment))return null;
      let parent;
      while((parent=this.parents.get(regionId))){
        if(parent.node===node)return {node,index:parent.childIndex,row:Math.floor(parent.childIndex/(node.columns || 1)),column:parent.childIndex%(node.columns || 1)};
        regionId=parent.region.id;
      }
      return null;
    }
    matrixCell(id:string,regionId=this.cursor.region) { return this.tableCell(id,regionId); }
    editMatrix(id:string,cellId:string,action:string) { return this.editTable(id,cellId,action); }
    editTable(id:string,cellId:string,action:string) {
      const cell=this.tableCell(id,cellId);
      if(!cell || !['rowBefore','rowAfter','columnBefore','columnAfter','deleteRow','deleteColumn'].includes(action))return false;
      const {node,row,column}=cell, isRow=action.startsWith('row')||action==='deleteRow', deleting=action.startsWith('delete');
      // Conditions and alignment partners stay paired; only matrices add columns.
      if(!isRow && !definitions.get(node.type)?.matrixEnvironment)return false;
      if(deleting && (isRow?node.rows:node.columns)===1)return false;
      this.record();
      const columns=node.columns || 1, rows=node.rows || 1;
      const grid=Array.from({length:rows},(_,i)=>node.regions.slice(i*columns,(i+1)*columns));
      const at=(isRow?row:column)+(action.endsWith('After')?1:0);
      if(isRow)grid.splice(at,deleting?1:0,...(deleting?[]:[Array.from({length:columns},()=>region(''))]));
      else for(const cells of grid)cells.splice(at,deleting?1:0,...(deleting?[]:[region('')]));
      node.columns=grid[0].length;node.regions=grid.flat();this.index();
      // Keep a surviving cursor (including nested content); enter the new cell
      // for insertion, or the nearest surviving cell if deletion removed it.
      if(!deleting || !this.regions.has(this.cursor.region)){
        const nextRow=isRow?Math.min(at,grid.length-1):row;
        const nextColumn=isRow?column:Math.min(at,node.columns-1);
        this.setCursor(grid[nextRow][nextColumn].id,0);
      }
      return true;
    }
    remove(direction:Direction) {
      const [start, end] = this.range;
      if (start !== end) { this.replace(start, end, ''); return; }
      if(this.emptyScriptParent()){
        this.record();this.removeEmptyScript();return;
      }
      const index = direction < 0 ? start - 1 : start;
      if (index < 0 || index >= this.current.items.length) return;
      if (typeof this.current.items[index] !== 'string' && !this.current.items[index].atom) {
        // First press selects the whole structure; the next press removes it.
        this.setCursor(this.cursor.region, index + (direction < 0 ? 0 : 1), index + (direction < 0 ? 1 : 0));
      } else this.replace(index, index + 1, '');
    }
    move(direction:Direction, extend = false) {
      const {region: id, offset, anchor} = this.cursor, r = this.current;
      if (extend) { this.setCursor(id, offset + direction, anchor); return; }
      const [start, end] = this.range;
      if (start !== end) { this.setCursor(id, direction < 0 ? start : end); return; }
      const item = r.items[direction > 0 ? offset : offset - 1];
      if (item !== undefined) {
        if (typeof item === 'string' || item.atom || !item.regions.length) this.setCursor(id, offset + direction);
        else { const child = item.regions[direction > 0 ? 0 : item.regions.length - 1]; this.setCursor(child.id, direction > 0 ? 0 : child.items.length); }
        return;
      }
      const parent = this.parents.get(id); if (!parent) return;
      const sibling = parent.node.regions[parent.childIndex + direction];
      if (sibling) this.setCursor(sibling.id, direction > 0 ? 0 : sibling.items.length);
      else this.setCursor(parent.region.id, parent.index + (direction > 0 ? 1 : 0));
    }
    vertical(direction:Direction) {
      let id = this.cursor.region, parent;
      while ((parent = this.parents.get(id))) {
        const step = parent.node.columns || definitions.get(parent.node.type)?.columns || 1;
        const sibling = parent.node.regions[parent.childIndex + direction * step];
        if (sibling) { this.setCursor(sibling.id, Math.min(this.cursor.offset, sibling.items.length)); return; }
        id = parent.region.id;
      }
    }
    tab(direction:Direction) {
      const ids = this.order.filter(id => id !== this.root.id), index = ids.indexOf(this.cursor.region);
      if (!ids.length) return;
      this.setCursor(ids[(index + direction + ids.length) % ids.length], 0);
    }
    projection() { return this.current.items.map(item => typeof item === 'string' ? item : '\uFFFC').join(''); }
    switchLetter(regionId:string,index:number,type:string) {
      const r=this.regions.get(regionId),target=symbolDefinitions.get(type),item=r?.items[index];
      if(!r||item===undefined||!target?.letter)return false;
      if(typeof item!=='string')return this.switchVariant(item.id,type);
      if(item!==target.letter)return false;
      this.record();r.items[index]={id:'n'+ ++serial,type,atom:true,regions:[]};this.index();return true;
    }
    fontWarnings():FontWarning[] {
      const warnings:FontWarning[]=[];
      const visit=(r:Region,font?:Definition)=>{
        r.items.forEach((item,index)=>{
          if(typeof item!=='string' && !item.atom){
            const def=definitions.get(item.type);
            if(def?.raw)return;
            item.regions.forEach(child=>visit(child,def?.font?def:font));return;
          }
          if(!font)return;
          const char=typeof item==='string'?item:diagnosticSymbol(item.type);
          if(!char)return;
          const message=font.command==='\\symbb'||font.command==='\\mathbfbb'?(/^[\p{Letter}\p{Number}]$/u.test(char)&&!extensionHasLetter('-bboldx',char)?'本工具的黑板体使用 BBoldX；它没有为“'+char+'”提供对应字形，输入保留。':undefined):fontDiagnostic(font.command,char);
          if(message)warnings.push({region:r.id,index,message});
        });
      };
      visit(this.root);return warnings;
    }
    exportLatex() { return latex(this.root); }
  }
export {EditorModel, texChar, structureTex, catalog, symbols};

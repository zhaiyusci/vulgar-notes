// SPDX-License-Identifier: GPL-3.0-or-later
import type {Definition} from './editor-model';

export type FormulaKind='equation'|'align'|'gather'|'multline'|'cases';
export type FormulaNumbering='none'|'single'|'rows'|'subrows';
export type FormulaAlignment='standard'|'compact'|'spread';
export interface FormulaLayout {
  type:string;kind:FormulaKind;numbering:FormulaNumbering;alignment:FormulaAlignment;label:string;
  environment:string;innerEnvironment?:string;
}
export const formulaEntries:readonly {kind:FormulaKind;label:string;defaultType:string}[]=[
  {kind:'equation',label:'Equation',defaultType:'formula-equation'},
  {kind:'align',label:'Aligned equations',defaultType:'formula-align'},
  {kind:'gather',label:'Centered equations',defaultType:'formula-gather'},
  {kind:'multline',label:'Long equation',defaultType:'formula-multline'},
  {kind:'cases',label:'Piecewise equation',defaultType:'formula-cases'},
];
export const formulaLayouts:FormulaLayout[]=[];
function layout(kind:FormulaKind,numbering:FormulaNumbering,environment:string,innerEnvironment?:string,alignment:FormulaAlignment='standard',type?:string){
  const suffix=numbering==='single'?'':numbering==='none'?'-unnumbered':'-'+numbering;
  formulaLayouts.push({type:type??'formula-'+kind+suffix+(alignment==='standard'?'':'-'+alignment),kind,numbering,alignment,
    label:(numbering==='single'?'One number':numbering==='rows'?'Number each row':numbering==='subrows'?'Number subrows':'Unnumbered')+
      (alignment==='compact'?' · Compact spacing':alignment==='spread'?' · Full width':''),environment,innerEnvironment});
}
layout('equation','single','equation');layout('equation','none','equation*');
for(const kind of ['align','gather'] as const){
  layout(kind,'single','equation',kind==='align'?'aligned':'gathered');
  layout(kind,'rows',kind);layout(kind,'none',kind+'*');
}
for(const numbering of ['single','rows','none'] as const){
  layout('align',numbering,numbering==='single'?'equation':numbering==='rows'?'alignat':'alignat*',numbering==='single'?'alignedat':undefined,'compact');
  // flalign owns the display width; it cannot sit inside an equation wrapper.
  if(numbering!=='single')layout('align',numbering,numbering==='rows'?'flalign':'flalign*',undefined,'spread');
}
layout('multline','single','multline');layout('multline','none','multline*');
layout('cases','single','equation','cases');layout('cases','none','equation*','cases');
layout('cases','rows','numcases',undefined,'standard','numcases');
layout('cases','subrows','subnumcases',undefined,'standard','subnumcases');

export function renderFormulaLayout(layout:FormulaLayout,content:string,left=''):string {
  const environment=layout.environment;
  if(layout.kind==='cases'){
    if(layout.numbering==='rows'||layout.numbering==='subrows')return `\\begin{${environment}}{${left}}${content}\\end{${environment}}`;
    content=left+`\\begin{cases}${content}\\end{cases}`;
  }else if(layout.innerEnvironment){
    const inner=layout.innerEnvironment;
    content=`\\begin{${inner}}${inner==='alignedat'?'{1}':''}${content}\\end{${inner}}`;
  }
  return `\\begin{${environment}}${environment.startsWith('alignat')?'{1}':''}${content}\\end{${environment}}`;
}

/** Whole-formula entries share the persisted tree, but are never nested components. */
export function registerFormulaLayouts(catalog:Definition[]):void {
  catalog.push({type:'formula-cases-body',label:'Cases rows',category:'Formula',labels:['Expression','Condition','Expression','Condition'],
    columns:2,rowEnvironment:'formula-cases-body',hidden:true,commandCandidate:false,command:'',selectedIndex:0,render:r=>`${r[0]}&${r[1]}\\\\${r[2]}&${r[3]}`});
  for(const formula of formulaLayouts){
    const columns=formula.kind==='align'?2:1;
    const labels=formula.kind==='cases'?['Left-hand side','Cases']:formula.kind==='equation'?['Formula']:
      Array.from({length:columns*2},(_,index)=>columns===1?'Line '+(index+1):'Line '+(Math.floor(index/2)+1)+(index%2?' right':' left'));
    const definition:Definition={type:formula.type,label:formulaEntries.find(entry=>entry.kind===formula.kind)!.label,category:'Formula',labels,
      scope:'formula',formula,hidden:true,commandCandidate:false,selectedIndex:0,command:`\\begin{${formula.environment}}`,
      variantOf:'formula-'+formula.kind,variantLabel:formula.label,
      render:r=>renderFormulaLayout(formula,formula.kind==='cases'?r[1]:Array.from({length:r.length/columns},(_,i)=>r.slice(i*columns,(i+1)*columns).join('&')).join('\\\\'),r[0]),
      ...(formula.kind==='align'||formula.kind==='gather'||formula.kind==='multline'?{columns,rowEnvironment:formula.innerEnvironment??formula.environment}:{}),
    };
    const existing=catalog.findIndex(entry=>entry.type===formula.type);
    if(existing>=0)catalog[existing]=definition;else catalog.push(definition);
  }
}

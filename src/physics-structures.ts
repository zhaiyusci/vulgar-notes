// SPDX-License-Identifier: GPL-3.0-or-later
import type {Definition} from './editor-model';

/** Explicit physics grammars. Missing optional operands are not ordinary tokens. */
export function registerPhysicsStructures(catalog:Definition[]):void {
  const find=(name:string)=>catalog.find(entry=>entry.type==='physics-'+name);
  const add=(name:string,command:string,labels:string[],render:Definition['render'],primary:string,description:string,hidden=false)=>{
    const existing=find(name);if(existing)return existing;
    const base=find(primary);if(base&&!base.variantOf){base.variantOf=base.type;base.variantLabel='Default';}
    const entry:Definition={type:'physics-'+name,label:description,category:'物理记号',labels,render,selectedIndex:0,
      command:'\\'+command,variantOf:base?.type??'physics-'+primary,variantLabel:description,
      aliases:base?.command.match(/^\\[A-Za-z]+/)?.[0]==='\\'+/^[A-Za-z]+/.exec(command)?.[0]?base.aliases:undefined,
      commandCandidate:false,...(hidden?{hidden:true}:{})};
    catalog.push(entry);return entry;
  };
  // physics \ev is expectation value; evaluated is an alias of \eval.
  const ev=find('ev'),expectation=find('expval');
  if(ev){ev.aliases=[];ev.hidden=true;ev.legacy=true;ev.commandCandidate=false;ev.variantOf='physics-expval';}
  if(expectation)expectation.aliases=[...new Set([...(expectation.aliases??[]),'ev'])];
  const evaluated:Definition={type:'physics-eval',label:'Evaluation',category:'物理记号',labels:['Expression'],selectedIndex:0,
    command:'\\eval',aliases:['evaluated'],render:r=>`\\eval{${r[0]}}`};
  if(!find('eval'))catalog.push(evaluated);

  for(const name of ['dv','pdv','fdv']){
    for(const star of ['', '*']){
      const suffix=star?'Flat':'',command=name+star;
      add(name+'Operator'+suffix,command,['Variable'],r=>`\\${command}{${r[0]}}`,name,'Differential operator'+(star?' (flat)':''),true);
      add(name+'Order'+suffix,command,['Function','Variable','Order'],r=>`\\${command}[${r[2]}]{${r[0]}}{${r[1]}}`,name,'Derivative with order'+(star?' (flat)':''),true);
    }
  }
  for(const star of ['', '*']){
    const suffix=star?'Flat':'',command='pdv'+star;
    add('pdvMixed'+suffix,command,['Function','First variable','Second variable'],r=>`\\${command}{${r[0]}}{${r[1]}}{${r[2]}}`,'pdv','Mixed partial derivative'+(star?' (flat)':''),true);
    // The actual physics grammar accepts [order] even with three arguments.
    // Preserve it exactly, irrespective of whether its renderer uses the order.
    add('pdvMixedOrder'+suffix,command,['Function','First variable','Second variable','Order'],r=>`\\${command}[${r[3]}]{${r[0]}}{${r[1]}}{${r[2]}}`,'pdv','Mixed partial derivative with order',true);
  }
  for(const name of ['dd','var'])add(name+'Order',name,['Variable','Order'],r=>`\\${name}[${r[1]}]{${r[0]}}`,name,'Differential with order',true);
  for(const name of ['vb','va','vu'])add(name+'Star',name+'*',['Content'],r=>`\\${name}*{${r[0]}}`,name,'Italic vector');

  for(const name of ['bra','ket','comm','acomm','pb','abs','norm','order','eval']){
    const base=find(name)!;
    add(name+'Star',name+'*',[...base.labels],r=>`\\${name}*`+r.map(value=>'{'+value+'}').join(''),name,'Fixed size');
  }
  for(const name of ['braket','ketbra']){
    add(name+'Self',name,['State'],r=>`\\${name}{${r[0]}}`,name,'Same state',true);
    add(name+'Star',name+'*',['Left state','Right state'],r=>`\\${name}*{${r[0]}}{${r[1]}}`,name,'Fixed size');
    add(name+'SelfStar',name+'*',['State'],r=>`\\${name}*{${r[0]}}`,name,'Same state (fixed size)',true);
  }
  // Bra looks ahead for a following ket. Keep that consuming pair in one
  // native component so rendering wrappers cannot interrupt its lookahead.
  for(const left of ['', '*'])for(const right of ['', '*'])
    add('braKetAdjacent'+(left?'LeftStar':'')+(right?'RightStar':''),'bra'+left,['Left state','Right state'],
      r=>`\\bra${left}{${r[0]}}\\ket${right}{${r[1]}}`,'braket','Adjacent bra and ket',true);
  for(const stars of ['', '*','**']){
    const suffix=stars.length===0?'':stars.length===1?'Star':'DoubleStar';
    if(stars)add('expval'+suffix,'expval'+stars,['Expression'],r=>`\\expval${stars}{${r[0]}}`,'expval',stars.length===1?'Fixed size':'Split delimiters',true);
    add('expvalState'+suffix,'expval'+stars,['Expression','State'],r=>`\\expval${stars}{${r[0]}}{${r[1]}}`,'expval','Expectation in a state'+(stars?' ('+stars+')':''),true);
    if(stars)add('mel'+suffix,'mel'+stars,['Left state','Operator','Right state'],r=>`\\mel${stars}{${r[0]}}{${r[1]}}{${r[2]}}`,'mel',stars.length===1?'Fixed size':'Split delimiters');
  }

  // Quantity's literal delimiter is part of its grammar, not a math argument.
  // In particular, \qty{a} and \qty(a) have different visible delimiters.
  for(const [name,left,right] of [['Braces','{','}'],['Brackets','[',']'],['Bars','|','|']])
    add('qty'+name,'qty',['Content'],r=>`\\qty${left}${r[0]}${right}`,'qty',name);
  for(const [name,description] of [['pqty','Parentheses'],['bqty','Brackets'],['Bqty','Braces'],['vqty','Absolute value']]){
    add(name,name,['Content'],r=>`\\${name}{${r[0]}}`,'qty',description,true);
    add(name+'Star',name+'*',['Content'],r=>`\\${name}*{${r[0]}}`,'qty',description+' (fixed size)',true);
  }
}

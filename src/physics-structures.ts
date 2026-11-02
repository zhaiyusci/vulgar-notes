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
      add(name+'Operator'+suffix,command,['Variable'],r=>`\\${command}{${r[0]}}`,name,'Differential operator'+(star?' (flat)':''));
      add(name+'OperatorOrder'+suffix,command,['Variable','Order'],r=>`\\${command}[${r[1]}]{${r[0]}}`,name,'Differential operator with order'+(star?' (flat)':''));
      add(name+'Order'+suffix,command,['Function','Variable','Order'],r=>`\\${command}[${r[2]}]{${r[0]}}{${r[1]}}`,name,'Derivative with order'+(star?' (flat)':''));
    }
  }
  for(const star of ['', '*']){
    const suffix=star?'Flat':'',command='pdv'+star;
    add('pdvMixed'+suffix,command,['Function','First variable','Second variable'],r=>`\\${command}{${r[0]}}{${r[1]}}{${r[2]}}`,'pdv','Mixed partial derivative'+(star?' (flat)':''));
    // The actual physics grammar accepts [order] even with three arguments.
    // Preserve it exactly, irrespective of whether its renderer uses the order.
    add('pdvMixedOrder'+suffix,command,['Function','First variable','Second variable','Order'],r=>`\\${command}[${r[3]}]{${r[0]}}{${r[1]}}{${r[2]}}`,'pdv','Mixed partial derivative with order',true);
  }
  for(const name of ['dd','var'])add(name+'Order',name,['Variable','Order'],r=>`\\${name}[${r[1]}]{${r[0]}}`,name,'Differential with order');
  for(const name of ['vb','va','vu'])add(name+'Star',name+'*',['Content'],r=>`\\${name}*{${r[0]}}`,name,'Italic vector');

  for(const name of ['bra','ket','comm','acomm','pb','abs','norm','order','eval']){
    const base=find(name)!;
    add(name+'Star',name+'*',[...base.labels],r=>`\\${name}*`+r.map(value=>'{'+value+'}').join(''),name,'Fixed size');
  }
  for(const name of ['braket','ketbra']){
    add(name+'Self',name,['State'],r=>`\\${name}{${r[0]}}`,name,'Same state');
    add(name+'Star',name+'*',['Left state','Right state'],r=>`\\${name}*{${r[0]}}{${r[1]}}`,name,'Fixed size');
    add(name+'SelfStar',name+'*',['State'],r=>`\\${name}*{${r[0]}}`,name,'Same state (fixed size)');
  }
  // Bra looks ahead for a following ket. Keep that consuming pair in one
  // native component so rendering wrappers cannot interrupt its lookahead.
  for(const left of ['', '*'])for(const right of ['', '*'])
    add('braKetAdjacent'+(left?'LeftStar':'')+(right?'RightStar':''),'bra'+left,['Left state','Right state'],
      r=>`\\bra${left}{${r[0]}}\\ket${right}{${r[1]}}`,'braket','Adjacent bra and ket',true);
  for(const stars of ['', '*','**']){
    const suffix=stars.length===0?'':stars.length===1?'Star':'DoubleStar';
    // With no state operand, physics treats ** exactly like *. Keep accepting
    // that source spelling, but do not present it as a distinct GUI choice.
    if(stars)add('expval'+suffix,'expval'+stars,['Expression'],r=>`\\expval${stars}{${r[0]}}`,'expval','Fixed size',stars.length===2);
    add('expvalState'+suffix,'expval'+stars,['Expression','State'],r=>`\\expval${stars}{${r[0]}}{${r[1]}}`,'expval','Expectation in a state'+(stars?' ('+stars+')':''));
    if(stars)add('mel'+suffix,'mel'+stars,['Left state','Operator','Right state'],r=>`\\mel${stars}{${r[0]}}{${r[1]}}{${r[2]}}`,'mel',stars.length===1?'Fixed size':'Automatic size');
  }

  // Quantity's literal delimiter is part of its grammar, not a math argument.
  // In particular, \qty{a} and \qty(a) have different visible delimiters.
  for(const [name,left,right] of [['Braces','{','}'],['Brackets','[',']'],['Bars','|','|']])
    add('qty'+name,'qty',['Content'],r=>`\\qty${left}${r[0]}${right}`,'qty',name);
  for(const [name,description] of [['pqty','Parentheses'],['bqty','Brackets'],['Bqty','Braces'],['vqty','Absolute value']]){
    add(name,name,['Content'],r=>`\\${name}{${r[0]}}`,'qty',description,true);
    add(name+'Star',name+'*',['Content'],r=>`\\${name}*{${r[0]}}`,'qty',description+' (fixed size)',true);
  }

  // Variants with optional arguments must retain semantic operands, not their
  // old array positions: the operator-only derivative contains the variable,
  // and a third argument can be an order or a second differentiation variable.
  const slots=(names:string[],roles:string[])=>{
    for(const name of names){const entry=find(name);if(entry)entry.variantSlots=roles;}
  };
  for(const name of ['dv','pdv','fdv']){
    slots([name,name+'Flat'],['function','variable']);
    slots([name+'Operator',name+'OperatorFlat'],['variable']);
    slots([name+'OperatorOrder',name+'OperatorOrderFlat'],['variable','order']);
    slots([name+'Order',name+'OrderFlat'],['function','variable','order']);
  }
  slots(['pdvMixed','pdvMixedFlat'],['function','variable','secondVariable']);
  slots(['pdvMixedOrder','pdvMixedOrderFlat'],['function','variable','secondVariable','order']);
  for(const name of ['dd','var']){
    slots([name],['variable']);slots([name+'Order'],['variable','order']);
  }
  slots(['expval','expvalStar','expvalDoubleStar'],['expression']);
  slots(['expvalState','expvalStateStar','expvalStateDoubleStar'],['expression','state']);
  for(const name of ['braket','ketbra']){
    slots([name,name+'Star'],['leftState','rightState']);
    // A same-state product is an insertion form, not a lossy conversion from
    // two independent states. Its two sizing variants can switch each other.
  }
}

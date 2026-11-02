// SPDX-License-Identifier: GPL-3.0-or-later
import type {Definition} from './editor-model';
import {mathjaxCommands,mathjaxCommandDefinition,type MathJaxCommand} from './mathjax-commands';
import {unicodeMathGreek} from './unicode-math-greek';

/** These handlers are verified in the installed upstream implementation to
 * emit a fixed symbol without consuming a following argument. Other handlers
 * are not inferred from the length of their registration argument array.
 */
const fixedSymbolHandlers=new Set(['Relation','CenterColon','NArrow','Dots','Vnabla']);
const noArgumentMacros=new Set(['LaTeX','Residue','TeX','bigtimes','bmod','iff','impliedby','implies','qc','qcomma','varinjlim','varliminf','varlimsup','varprojlim']);
const operatorNames=new Set(['injlim','projlim','bigtimes','varinjlim','varliminf','varlimsup','varprojlim']);
const nativeLargeOperators=['oiint','oiiint','intop','ointop','smallint'] as const;

// MathJax 4.1.3's OperatorDictionary classes for the configured CharacterMaps.
// Consult the map and explicit attributes first: text dots, mathematical dots,
// and punctuation can share a codepoint without sharing an atom class.
const largeOperatorCharacters=new Set('⋂⋃⨀⨁⨂⨆⨄⋁⋀∐⨌∭∬∫∰∯∮∏∑');
const binaryCharacters=new Set('⋒⋓⨿∗⊼◯▽△⊡⊟⊞⊠∙∩⋅∘⊛⊚⊝×∪⋎⋏†‡⋄⋇÷∔⩞⊺∧⋋∨⋉∓⧸⊙⊖⊕⊘⊗±⋌⋊∖⊓⊔⋆◃▹⊎⊻≀');
const relationCharacters=new Set('≎≑⋈⋐⋑⊩⊪≈≊≍∍∽⋍∵≬≏≗≅⋞⋟⊣≐≖≂⪖⪕≡≒⌢≥≧⩾≫⋙⪊⪈≩⋧>⪆⋗⋛⪌≷≳∈≤≦⩽⪅⋖⋚⪋≶≲⊲≪⋘⪉⪇≨⋦<∣⊧⊸⊯⊮≇≠≱≯∋≰≮∤∉∦⊀⋠≁⊈⊁⋡⊉⋪⋬⋫⋭⊭⊬∥⟂⋔≺⪷≼⪯⪹⪵⋨≾∝⊳≓∼≃⌣⊏⊑⊐⊒⊂⊆⫅⊊⫋≻⪸≽⪰⪺⪶⋩≿⊃⊇⫆⊋⫌∴⊴≜⊵⊨⊢');
const isArrow=(character:string)=>/^[\u2190-\u21ff\u27f0-\u27ff\u2900-\u297f]$/u.test(character);

export function guiMathjaxSymbolCategory(command:MathJaxCommand):string {
  const definition=mathjaxCommandDefinition(command);
  if(!definition)return '其他符号';
  const {map,character='',attributes}=definition;
  if(definition.package==='textcomp')return '其他符号';
  if(definition.package==='mhchem'||definition.package==='gensymb'||command.name==='AA')return '化学与单位';
  if(map==='upgreek'||/mi/.test(map)&&/^\p{Script=Greek}$/u.test(character))return '希腊字母';
  if(map.startsWith('bboldx-delimiter'))return '括号与定界符';
  if(map.startsWith('Physics-vector'))return '物理记号';
  if(attributes?.texClass===6)return '其他符号';
  if(isArrow(character)||command.name==='multimap')return '箭头符号';
  if(map.includes('mo')){
    if(attributes?.texClass===1||largeOperatorCharacters.has(character))return '大型算符';
    if(attributes?.texClass===2||binaryCharacters.has(character))return '运算符号';
    if(attributes?.texClass===3||relationCharacters.has(character))return '关系符号';
  }
  return symbolCategory(command);
}

const canonicalGuiTypes=new Map<string,string>();
/** A retired duplicate remains a readable node; this identifies its GUI entry. */
export function guiSymbolCanonicalType(type:string):string {
  return canonicalGuiTypes.get(type)??type;
}

/** Call after operator initialization/variant registration, before candidates. */
export function organizeGuiSymbols(symbols:Definition[],catalog:Definition[]):void {
  canonicalGuiTypes.clear();
  const commands=new Map(mathjaxCommands.map(command=>[command.name,command]));
  const visible=(entry:Definition)=>!entry.hidden&&!entry.legacy;
  const hide=(entry:Definition,canonical:Definition)=>{
    entry.hidden=true;canonicalGuiTypes.set(entry.type,canonical.type);
  };
  for(const entry of catalog){
    const primary=entry.operatorCommand==='ointop'?'contourIntegral':['intop','smallint'].includes(entry.operatorCommand??'')?'integral':undefined;
    if(primary){
      entry.variantOf=primary;
      entry.variantLabel='\\'+entry.operatorCommand+(entry.operatorPlacement??'');
    }
  }
  const operators=new Map<string,Definition>();
  for(const entry of catalog.filter(entry=>visible(entry)&&entry.operator&&!entry.operatorPlacement)){
    if(entry.operatorCommand&&!operators.has(entry.operatorCommand))operators.set(entry.operatorCommand,entry);
  }
  for(const entry of symbols.filter(entry=>entry.type.startsWith('mathjax-symbol-'))){
    const command=commands.get(entry.command.slice(1));if(!command)continue;
    entry.category=guiMathjaxSymbolCategory(command);
    const operator=operators.get(command.name);
    if(operator){hide(entry,operator);entry.commandCandidate=false;continue;}
    const definition=mathjaxCommandDefinition(command);
    if(!definition?.character)continue;
    // Upright Greek aliases belong to the existing per-letter menu.
    // Match the alphabet and style, never merely a visually similar glyph.
    const style=definition.map==='upgreek'?'up':undefined;
    if(style){
      const glyph=unicodeMathGreek(definition.character,[style],'TeX');
      const target=glyph&&symbols.find(candidate=>visible(candidate)&&candidate.letter===definition.character&&candidate.glyphKey==='unicode:'+glyph);
      if(target){hide(entry,target);continue;}
    }
    if(definition.map==='AMSsymbols-mathchar0mi'&&definition.attributes?.mathvariant==='italic'){
      const base=symbols.find(candidate=>visible(candidate)&&candidate.letter===definition.character&&candidate.variantOf===candidate.type);
      if(base){entry.letter=definition.character;entry.variantOf=base.type;entry.variantLabel=entry.command;}
    }
    if(['bbdotlessi','bbdotlessj'].includes(command.name)){
      const target=symbols.find(candidate=>visible(candidate)&&candidate.type===`symbol-${command.name==='bbdotlessi'?'imath':'jmath'}--editorbboldx`);
      if(target){hide(entry,target);continue;}
    }
  }
  // True aliases share the same runtime map, handler, character and attributes.
  // In particular a textcomp glyph is never merged with a mathematical token.
  const signatures=new Map<string,Definition>();
  for(const entry of symbols.filter(visible)){
    const command=commands.get(entry.command.slice(1)),definition=command&&mathjaxCommandDefinition(command);
    if(!definition?.character||definition.kind!=='character')continue;
    const attributes=Object.entries(definition.attributes??{}).sort(([a],[b])=>a.localeCompare(b));
    const signature=JSON.stringify([definition.package,definition.map,definition.handler,definition.character,attributes]);
    const previous=signatures.get(signature);
    if(previous&&entry.type.startsWith('mathjax-symbol-'))hide(entry,previous);
    else if(!previous)signatures.set(signature,entry);
  }
  // Differences in punctuation spacing/vertical alignment belong to the
  // symbol's menu. Keep each native command and atom class intact on selection.
  for(const [primary,names] of [
    ['cdot',['cdot','cdotp','ldotp']],
    ['colon',['colon','ordinarycolon','vcentercolon']],
  ] as const){
    const base=symbols.find(entry=>entry.command==='\\'+primary&&!entry.hidden);if(!base)continue;
    for(const name of names){
      const entry=symbols.find(entry=>entry.command==='\\'+name&&!entry.hidden);if(!entry)continue;
      entry.variantOf=base.type;entry.variantLabel=entry.command;
    }
  }
}

export function guiFixedSymbolCommands():readonly MathJaxCommand[] {
  return mathjaxCommands.filter(command=>{
    const definition=mathjaxCommandDefinition(command);
    if(!definition)return false;
    return fixedSymbolHandlers.has(definition.handler)||
      noArgumentMacros.has(command.name)&&definition.syntax.kind==='macro-expansion'&&definition.syntax.arity===0||
      definition.handler==='NamedOp'&&operatorNames.has(command.name)||
      definition.kind==='character'&&definition.syntax.kind==='symbol'&&/^[#$%&_]$/.test(command.name);
  });
}

function symbolCategory(command:MathJaxCommand):string {
  const handler=mathjaxCommandDefinition(command)?.handler;
  if(handler==='Relation'||['iff','impliedby','implies'].includes(command.name))return '关系符号';
  if(handler==='NArrow')return '箭头符号';
  if(command.name==='bmod')return '运算符号';
  if(command.name==='vnabla')return '物理记号';
  return '其他符号';
}

export function registerGuiSymbols(symbols:Definition[],catalog:Definition[]):void {
  const registered=new Set([...symbols,...catalog].map(entry=>entry.command));
  const atom=(name:string,category:string,hidden=false)=>{
    const command='\\'+name;if(registered.has(command))return;
    registered.add(command);
    symbols.push({type:'mathjax-symbol-'+name,label:command,category,command,tex:command+' ',atom:true,labels:[],selectedIndex:0,render:()=>'',ungroupScriptBase:true,hidden});
  };
  for(const command of guiFixedSymbolCommands()){
    if(registered.has('\\'+command.name))continue;
    if(operatorNames.has(command.name)){
      // Match the existing operator registration pass: optional limits attach
      // to the operator; the surrounding sequence remains outside it.
      catalog.push({type:'operator-'+command.name,label:'\\'+command.name,category:'大型算符',labels:['Lower limit','Upper limit','Content'],selectedIndex:2,
        command:'\\'+command.name,render:r=>`\\${command.name}_{${r[0]}}^{${r[1]}} ${r[2]}`});
      registered.add('\\'+command.name);
    }else atom(command.name,symbolCategory(command));
  }
  for(const name of nativeLargeOperators){
    if(catalog.some(entry=>entry.command==='\\'+name||entry.operatorCommand===name))continue;
    catalog.push({type:'operator-'+name,label:'\\'+name,category:'大型算符',labels:['Lower limit','Upper limit','Content'],selectedIndex:2,
      command:'\\'+name,render:r=>`\\${name}_{${r[0]}}^{${r[1]}} ${r[2]}`});
  }
  // Delimiter-map keys carry the leading backslash; the ordinary character
  // inventory intentionally cannot normalize them because \gt, for example,
  // means > as an operator but an angle bracket in \left/\right context.
  for(const command of mathjaxCommands){
    const definition=command.definitions.find(entry=>entry.context==='math'&&entry.configured&&entry.kind==='delimiter');
    if(definition?.character&&/^\\[A-Za-z]+$/.test(command.name))atom(command.name.slice(1),'括号与定界符',true);
  }
  for(const name of ['llbracket','rrbracket','lBrack','rBrack'])atom(name,'括号与定界符',true);
  for(const [alias,canonical] of [['llbracket','lBrack'],['rrbracket','rBrack']]){
    const entry=symbols.find(entry=>entry.command==='\\'+alias);
    if(entry)entry.exportTex='\\'+canonical+' ';
  }
  // These native spellings are true aliases. Retain their relationship for
  // old nodes; the input policy decides whether to expose either spelling.
  const comma=symbols.find(entry=>entry.command==='\\qcomma'),qc=symbols.find(entry=>entry.command==='\\qc');
  if(comma&&qc){qc.hidden=true;comma.aliases=[...new Set([...(comma.aliases??[]),'qc'])];}
}

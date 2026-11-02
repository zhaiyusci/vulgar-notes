// SPDX-License-Identifier: GPL-3.0-or-later
import type {Definition} from './editor-model';
import {isSourceOnlyMathCommand} from './math-input-policy';

export interface GuiDelimiterPair {type:string;left:string;right:string;leftKey:string;rightKey:string}
/** Real MathJax delimiter glyphs. Keep command spellings in previews/exports. */
export const guiDelimiterPairs:readonly GuiDelimiterPair[]=[
  {type:'parens',left:'(',right:')',leftKey:'(',rightKey:')'},
  {type:'brackets',left:'[',right:']',leftKey:'[',rightKey:']'},
  {type:'doubleBrackets',left:'\\lBrack',right:'\\rBrack',leftKey:'doubleBracketL',rightKey:'doubleBracketR'},
  {type:'braces',left:'\\{',right:'\\}',leftKey:'{',rightKey:'}'},
  {type:'abs',left:'|',right:'|',leftKey:'|',rightKey:'|'},
  {type:'norm',left:'\\lVert',right:'\\rVert',leftKey:'||',rightKey:'||'},
  {type:'angles',left:'\\langle',right:'\\rangle',leftKey:'<',rightKey:'>'},
  {type:'floor',left:'\\lfloor',right:'\\rfloor',leftKey:'floorL',rightKey:'floorR'},
  {type:'ceil',left:'\\lceil',right:'\\rceil',leftKey:'ceilL',rightKey:'ceilR'},
  {type:'groupDelimiters',left:'\\lgroup',right:'\\rgroup',leftKey:'groupL',rightKey:'groupR'},
  {type:'moustacheDelimiters',left:'\\lmoustache',right:'\\rmoustache',leftKey:'moustacheL',rightKey:'moustacheR'},
  {type:'upperCorners',left:'\\ulcorner',right:'\\urcorner',leftKey:'upperCornerL',rightKey:'upperCornerR'},
  {type:'lowerCorners',left:'\\llcorner',right:'\\lrcorner',leftKey:'lowerCornerL',rightKey:'lowerCornerR'},
  {type:'slashFence',left:'/',right:'/',leftKey:'/',rightKey:'/'},
  {type:'backslashFence',left:'\\backslash',right:'\\backslash',leftKey:'backslash',rightKey:'backslash'},
  ...['uparrow','downarrow','updownarrow','Uparrow','Downarrow','Updownarrow','arrowvert','bracevert'].map(name=>
    ({type:'fence-'+name,left:'\\'+name,right:'\\'+name,leftKey:name,rightKey:name})),
];

export const guiDelimiterAliases:Readonly<Record<string,string>>={
  '⟦':'doubleBracketL','⟧':'doubleBracketR',llbracket:'doubleBracketL',rrbracket:'doubleBracketR',lBrack:'doubleBracketL',rBrack:'doubleBracketR',
  lgroup:'groupL',rgroup:'groupR',lmoustache:'moustacheL',rmoustache:'moustacheR',
  ulcorner:'upperCornerL',urcorner:'upperCornerR',llcorner:'lowerCornerL',lrcorner:'lowerCornerR',
  '<':'<','>':'>',lt:'<',gt:'>',Arrowvert:'||',
  ...Object.fromEntries(['uparrow','downarrow','updownarrow','Uparrow','Downarrow','Updownarrow','arrowvert','bracevert'].map(name=>[name,name])),
};

export const guiDelimiterTypes:Readonly<Record<string,string>>=Object.fromEntries(guiDelimiterPairs.flatMap(pair=>[
  [pair.leftKey+'|'+pair.rightKey,pair.type],
  [pair.leftKey+'|.',pair.type==='braces'?'leftBrace':pair.type+'-left-only'],
  ['.|'+pair.rightKey,pair.type==='braces'?'rightBrace':pair.type==='abs'?'evaluation':pair.type+'-right-only'],
]));

/** Pair geometry is a main button; size and single-sided forms are variants. */
export function registerDelimiterVariants(catalog:Definition[]):void {
  function add(type:string,left:string,right:string,primary:string,size?:string):Definition {
    let entry=catalog.find(item=>item.type===type);
    if(!entry){
      const render=(regions:string[])=>size?`\\${size}l${left} ${regions[0]}\\${size}r${right}`:`\\left${left} ${regions[0]}\\right${right}`;
      entry={type,label:left+' … '+right,category:'括号与定界符',labels:['Content'],render,selectedIndex:0,command:render(['…']),commandCandidate:false};
      catalog.push(entry);
    }
    entry.variantOf=primary;
    // The menu shows the actual rendered sample and command; no language leaks.
    entry.variantLabel=entry.command||entry.render(['…']);
    return entry;
  }
  for(const pair of guiDelimiterPairs){
    const variants=[add(pair.type,pair.left,pair.right,pair.type)];
    for(const size of ['big','Big','bigg','Bigg'])variants.push(add(pair.type==='parens'?'paren'+size:pair.type+'-'+size,pair.left,pair.right,pair.type,size));
    variants.push(add(pair.type==='braces'?'leftBrace':pair.type+'-left-only',pair.left,'.',pair.type));
    variants.push(add(pair.type==='braces'?'rightBrace':pair.type==='abs'?'evaluation':pair.type+'-right-only','.',pair.right,pair.type));
    // Delimiter construction pieces remain registered so saved nodes and
    // imported TeX retain their geometry; none of their sizes is a GUI choice.
    if(isSourceOnlyMathCommand(pair.left.replace(/^\\/,'')))for(const entry of variants)entry.hidden=true;
  }
}

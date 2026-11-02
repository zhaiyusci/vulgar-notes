// SPDX-License-Identifier: GPL-3.0-or-later
interface DelimiterInternals {
  input:{tex:{
    MapHandler:{MapHandler:{getMap(name:string):{lookup(name:string):unknown;add(name:string,token:unknown):void}}};
    Token:{Token:new(name:string,character:string,attributes:null)=>unknown};
  }};
}

/** Register the Unicode double brackets in the existing TeX delimiter map.
 * MathJax's font and operator dictionary already provide their glyphs and
 * stretching. Only the TeX delimiter names are absent from its base map.
 * Run before startup.defaultReady in both the editor and exported reader.
 */
export function installMathDelimiters(internals:unknown):void {
  const {MapHandler,Token}=(internals as DelimiterInternals).input.tex;
  const delimiters=MapHandler.MapHandler.getMap('delimiter');
  for(const [name,character] of [['\\llbracket','⟦'],['\\rrbracket','⟧'],['\\lBrack','⟦'],['\\rBrack','⟧'],['⟦','⟦'],['⟧','⟧']]){
    if(!delimiters.lookup(name))delimiters.add(name,new Token.Token(name,character,null));
  }
}

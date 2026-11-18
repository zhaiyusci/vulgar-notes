// SPDX-License-Identifier: GPL-3.0-or-later
export interface MathPaletteColor {readonly name:string;readonly color:string}

/** xcolor's 19 base colors, ordered by name (xcolor.dtx, Base colors).
 * RGB components are rounded to bytes; application/export use these explicit
 * values so CSS and MathJax named-color differences cannot change the result.
 */
export const palette:readonly MathPaletteColor[]=[
  {name:'black',color:'#000000'},
  {name:'blue',color:'#0000FF'},
  {name:'brown',color:'#BF8040'},
  {name:'cyan',color:'#00FFFF'},
  {name:'darkgray',color:'#404040'},
  {name:'gray',color:'#808080'},
  {name:'green',color:'#00FF00'},
  {name:'lightgray',color:'#BFBFBF'},
  {name:'lime',color:'#BFFF00'},
  {name:'magenta',color:'#FF00FF'},
  {name:'olive',color:'#808000'},
  {name:'orange',color:'#FF8000'},
  {name:'pink',color:'#FFBFBF'},
  {name:'purple',color:'#BF0040'},
  {name:'red',color:'#FF0000'},
  {name:'teal',color:'#008080'},
  {name:'violet',color:'#800080'},
  {name:'white',color:'#FFFFFF'},
  {name:'yellow',color:'#FFFF00'},
];

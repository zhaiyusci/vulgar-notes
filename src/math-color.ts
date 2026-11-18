// SPDX-License-Identifier: GPL-3.0-or-later
/** The color models provided by MathJax's own color extension. */
export interface MathColor {model:''|'named'|'RGB'|'rgb'|'gray';value:string}
export type MathColorTarget='text'|'background'|'border';
export type MathBoxStyle='textstyle'|'displaystyle'|'scriptstyle'|'scriptscriptstyle';

export function validMathColor(value:unknown):value is MathColor {
  if(!value||typeof value!=='object')return false;
  const color=value as MathColor;
  if(typeof color.value!=='string'||color.value.length>256)return false;
  if(color.model===''||color.model==='named')return !!color.value.trim()&&!/[{}\\;%\r\n]/.test(color.value);
  if(!['RGB','rgb','gray'].includes(color.model))return false;
  const parts=color.value.trim().split(/\s*,\s*/);
  if(parts.length!==(color.model==='gray'?1:3))return false;
  return parts.every(part=>(color.model==='RGB'?/^\d+$/:/^(\d+(\.\d*)?|\.\d+)$/).test(part)&&Number(part)<=(color.model==='RGB'?255:1));
}

export function hexMathColor(hex:string):MathColor|null {
  if(!/^#[\da-f]{6}$/i.test(hex))return null;
  return {model:'RGB',value:[1,3,5].map(start=>parseInt(hex.slice(start,start+2),16)).join(',')};
}

export function coloredTex(color:MathColor,content:string):string {
  return '\\textcolor'+(color.model?'['+color.model+']':'')+'{'+color.value+'}{'+content+'}';
}

/** GUI decorations use explicit RGB only; names may differ between TeX and CSS. */
export function validDecorationColor(value:unknown):value is MathColor {
  return validMathColor(value)&&value.model==='RGB';
}

export function mathDecorationTex(background:MathColor|undefined,border:MathColor|undefined,content:string):string {
  const hex=(color:MathColor)=>'#'+color.value.split(',').map(value=>Number(value.trim()).toString(16).padStart(2,'0')).join('').toUpperCase();
  // An outline paints outside the math box without contributing to its metrics.
  const options=['0px',...(background?[hex(background)]:[]),...(border?['outline:1px solid '+hex(border)]:[])];
  return '\\bbox['+options.join(',')+']{'+content+'}';
}

/** Recognize only the exact, inert bbox subset emitted by the GUI. */
export function parseMathDecorationOptions(options:string):{texBackground?:MathColor;texBorder?:MathColor}|null {
  const match=/^\[0px(?:,(#[\da-f]{6}))?(?:,outline:1px solid (#[\da-f]{6}))?\]$/i.exec(options);
  if(!match||!match[1]&&!match[2])return null;
  return {...(match[1]?{texBackground:hexMathColor(match[1])!}:{}),...(match[2]?{texBorder:hexMathColor(match[2])!}:{})};
}

/** ColorBox's argument is text mode in the native extension and in TeX. */
export function colorBoxTex(background:MathColor,border:MathColor|undefined,content:string,style?:MathBoxStyle):string {
  const argument=(color:MathColor,explicit=false)=>(color.model||explicit?'['+(color.model||'named')+']':'')+'{'+color.value+'}';
  const prefix=border?'\\fcolorbox'+argument(border)+argument(background,!!border.model&&!background.model):'\\colorbox'+argument(background);
  return prefix+'{$'+(style?'\\'+style+' ':'')+content+'$}';
}

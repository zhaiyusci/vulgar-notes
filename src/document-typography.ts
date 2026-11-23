export const mathFonts={'mathjax-newcm':'New Computer Modern','mathjax-stix2':'STIX Two Math'} as const;
export type MathFont=keyof typeof mathFonts;
export interface DocumentTypography {bodyFont:string;bodyPt:number;mathFont:MathFont;mathPt:number|null}
export const defaultTypography:DocumentTypography={bodyFont:'',bodyPt:12,mathFont:'mathjax-newcm',mathPt:null};

export function parseTypography(value:unknown):DocumentTypography {
  if(value===undefined)return defaultTypography;
  const v=value as DocumentTypography;
  const size=(n:number)=>Number.isFinite(n)&&n>=6&&n<=96;
  if(!v||typeof v.bodyFont!=='string'||v.bodyFont.length>100||!/^[\p{L}\p{N} ._-]*$/u.test(v.bodyFont)||
    !size(v.bodyPt)||!Object.hasOwn(mathFonts,v.mathFont)||!(v.mathPt===null||size(v.mathPt)))throw Error('Invalid document typography');
  return {bodyFont:v.bodyFont.trim(),bodyPt:v.bodyPt,mathFont:v.mathFont,mathPt:v.mathPt};
}

export function mathFontBase(font:MathFont,document:Document):string {
  const entry=Array.from(document.scripts).find(script=>script.src.includes('/vendor/mathjax/tex-chtml.js'));
  return entry?new URL('../'+font,entry.src).href:'https://cdn.jsdelivr.net/npm/@mathjax/'+font+'-font@4.1.3';
}

/** Reference-list entry formats; inline citations keep the document's numbers. */
export const bibliographyStyles=[
  {id:'simple',label:'Simple'},
  {id:'ieee',label:'IEEE'},
  {id:'vancouver',label:'Vancouver (NLM)'},
  {id:'apa',label:'APA 7th edition'},
  {id:'chicago',label:'Chicago 18th edition'},
  {id:'gbt7714-2025',label:'GB/T 7714–2025'},
] as const;
export type BibliographyStyle=typeof bibliographyStyles[number]['id'];
export function isBibliographyStyle(value:unknown):value is BibliographyStyle {
  return bibliographyStyles.some(style=>style.id===value);
}
export interface BibliographyRun {
  text:string;
  italic?:boolean;bold?:boolean;superscript?:boolean;subscript?:boolean;smallCaps?:boolean;
}
export interface FormattedBibliographyEntry {html:string;text:string;runs:BibliographyRun[]}

declare module 'citeproc' {
  import type {CSLItem} from './bibtex-csl';
  interface BibliographyParameters {entry_ids:string[][];bibliography_errors?:unknown[]}
  interface EngineInstance {
    updateItems(ids:string[]):void;
    makeBibliography():[BibliographyParameters,string[]]|false;
    setOutputFormat(format:'html'|'text'):void;
  }
  const citeproc:{Engine:new(sys:{retrieveLocale:(language:string)=>string|false;retrieveItem:(id:string)=>CSLItem},style:string,language?:string,forceLanguage?:boolean)=>EngineInstance};
  export default citeproc;
}

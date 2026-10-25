interface MathJaxRuntime {
  _:import('./mathjax-font-types').FontInternals;
  startup:{defaultReady():void;defaultPageReady():Promise<void>};
  typesetClear(elements:HTMLElement[]):void;
  typesetPromise(elements:HTMLElement[]):Promise<void>;
  tex2chtmlPromise(source:string,options:{display:boolean}):Promise<HTMLElement>;
}
declare const MathJax:MathJaxRuntime;
interface Window {
  MathJax:MathJaxConfiguration;
  ready?:boolean;
  mathjaxLoadFailed:()=>void;
}
interface MathJaxConfiguration {
  output?:{fontExtensions:string[]};
  options:{enableMenu:boolean;enableExplorer:boolean;enableExplorerHelp:boolean;renderActions:{explorable:never[]}};
  loader:{load:string[];paths?:Record<string,string>};
  tex:{packages:{'[+]':string[]};mathStyle:string;mathStyleGreekLC:boolean;mathStyleMathAlphabets:boolean};
  startup:{ready:()=>void;pageReady:()=>Promise<void>};
}

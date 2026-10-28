interface MathJaxRuntime {
  _:import('./mathjax-font-types').FontInternals;
  startup:{defaultReady():void;defaultPageReady():Promise<void>};
  typesetClear(elements:HTMLElement[]):void;
  texReset(start?:number):void;
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
  options:{enableSpeech?:boolean;enableBraille?:boolean;enableMenu:boolean;enableExplorer:boolean;enableExplorerHelp:boolean;renderActions:{explorable:never[];attachSpeech?:never[]}};
  loader:{load:string[];paths?:Record<string,string>};
  tex:{packages:{'[+]':import('./mathjax-extension-policy').MathJaxTexPackage[];'[-]'?:string[]};require?:{allow:Record<string,boolean>;defaultAllow:boolean};textmacros?:{packages:{'[+]':string[]}};tags?:'ams'|'cases'|'all'|'none';mathStyle:string;mathStyleGreekLC:boolean;mathStyleMathAlphabets:boolean};
  startup:{ready:()=>void;pageReady:()=>Promise<void>};
}

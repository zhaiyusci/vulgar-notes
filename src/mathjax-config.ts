import {installUnicodeFonts} from './mathjax-unicode-fonts';
const enabledLetterFonts=['bboldx'];
window.MathJax={
  output:{fontExtensions:enabledLetterFonts.map(name=>'https://cdn.jsdelivr.net/npm/@mathjax/mathjax-'+name+'-font-extension@4.1.3')},
  options:{enableMenu:false,enableSpeech:false,enableBraille:false,enableExplorer:false,enableExplorerHelp:false,renderActions:{explorable:[],attachSpeech:[]}},
  loader:{paths:Object.fromEntries(['bboldx'].map(name=>['mathjax-'+name+'-extension','https://cdn.jsdelivr.net/npm/@mathjax/mathjax-'+name+'-font-extension@4.1.3'])),load:['[tex]/html','[tex]/cancel','[tex]/mathtools','[tex]/physics','[tex]/mhchem','[tex]/textmacros','[tex]/bboldx']},
  tex:{packages:{'[+]':['html','cancel','mathtools','physics','mhchem','textmacros','bboldx']},tags:'ams',mathStyle:'TeX',mathStyleGreekLC:true,mathStyleMathAlphabets:true},
  startup:{ready:()=>{installUnicodeFonts(MathJax._);MathJax.startup.defaultReady();},pageReady:()=>MathJax.startup.defaultPageReady().then(()=>{
    window.ready=true;
    window.dispatchEvent(new Event('mathjax-ready'));
  })}
};

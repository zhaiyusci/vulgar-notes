import {installUnicodeFonts} from './mathjax-unicode-fonts';
import {applyColorScheme, readColorScheme} from './color-scheme';
import {mathJaxExtensionLoads,mathJaxTexPackages,mathJaxDisabledTexPackages,mathJaxRequireOptions} from './mathjax-extension-policy';
// This existing blocking head script runs before the first body paint.
applyColorScheme(readColorScheme());
const enabledLetterFonts=['bboldx'];
window.MathJax={
  output:{fontExtensions:enabledLetterFonts.map(name=>'https://cdn.jsdelivr.net/npm/@mathjax/mathjax-'+name+'-font-extension@4.1.3')},
  options:{enableMenu:false,enableSpeech:false,enableBraille:false,enableExplorer:false,enableExplorerHelp:false,renderActions:{explorable:[],attachSpeech:[]}},
  loader:{paths:Object.fromEntries(['bboldx'].map(name=>['mathjax-'+name+'-extension','https://cdn.jsdelivr.net/npm/@mathjax/mathjax-'+name+'-font-extension@4.1.3'])),load:mathJaxExtensionLoads},
  tex:{packages:{'[+]':mathJaxTexPackages,'[-]':mathJaxDisabledTexPackages},require:mathJaxRequireOptions,textmacros:{packages:{'[+]':['textcomp']}},tags:'cases',mathStyle:'TeX',mathStyleGreekLC:true,mathStyleMathAlphabets:true},
  startup:{ready:()=>{installUnicodeFonts(MathJax._);MathJax.startup.defaultReady();},pageReady:()=>MathJax.startup.defaultPageReady().then(()=>{
    window.ready=true;
    window.dispatchEvent(new Event('mathjax-ready'));
  })}
};

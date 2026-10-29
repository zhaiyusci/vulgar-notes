import {installUnicodeFonts} from './mathjax-unicode-fonts';
import {mathJaxExtensionLoads,mathJaxTexPackages,mathJaxDisabledTexPackages,mathJaxRequireOptions} from './mathjax-extension-policy';

// Exported formulas use the same TeX and alphabets as the editor, while the
// official menu supplies Show Math As and Copy to Clipboard to readers.
const configuration={
  output:{font:'mathjax-newcm',fontExtensions:['https://cdn.jsdelivr.net/npm/@mathjax/mathjax-bboldx-font-extension@4.1.3']},
  loader:{
    paths:{'mathjax-bboldx-extension':'https://cdn.jsdelivr.net/npm/@mathjax/mathjax-bboldx-font-extension@4.1.3'},
    load:['ui/menu',...mathJaxExtensionLoads],
  },
  options:{
    enableMenu:true,enableSpeech:false,enableBraille:false,enableExplorer:false,enableExplorerHelp:false,
    skipHtmlTags:['script','noscript','style','textarea','pre','code','annotation','annotation-xml','select','option','mjx-container'],
    renderActions:{explorable:[],attachSpeech:[]},
  },
  tex:{packages:{'[+]':mathJaxTexPackages,'[-]':mathJaxDisabledTexPackages},require:mathJaxRequireOptions,
    textmacros:{packages:{'[+]':['textcomp']}},tags:'cases' as const,mathStyle:'TeX',mathStyleGreekLC:true,mathStyleMathAlphabets:true},
  startup:{
    typeset:false,
    ready:()=>{installUnicodeFonts(MathJax._);MathJax.startup.defaultReady();},
    pageReady:async()=>{
      await MathJax.startup.defaultPageReady();
      const elements=Array.from(document.querySelectorAll<HTMLElement>('[data-export-math-source]'));
      if(!elements.length)return;
      const fallback=elements.map(element=>Array.from(element.childNodes,node=>node.cloneNode(true)));
      elements.forEach(element=>{element.textContent=element.dataset.exportMathSource??'';});
      try{await MathJax.typesetPromise(elements);}catch(error){
        MathJax.typesetClear(elements);
        elements.forEach((element,index)=>element.replaceChildren(...fallback[index]));
        throw error;
      }
    },
  },
};
window.MathJax=configuration;

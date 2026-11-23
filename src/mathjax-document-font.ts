import {mathFontBase,type MathFont} from './document-typography';

interface Output {
  setAdaptor(adaptor:unknown):void;
  initialize():void;
}
interface Runtime {
  config:{loader:{paths:Record<string,string>};chtml:Record<string,unknown>};
  loader:{load(name:string):Promise<unknown>};
  startup:{output:Output;getOutputJax():Output;document:{adaptor:unknown;outputJax:Output;rerenderPromise():Promise<void>}};
  _:{output:{fonts:Record<string,{chtml_ts?:{MathJaxStix2Font:unknown};chtml?:{install():void}}>}};
}
let current:MathFont='mathjax-newcm';
const outputs=new Map<MathFont,Output>();
/** Switch the CHTML output processor and its metrics together, preserving the
 * input processor, TeX extensions and document numbering. */
export async function selectMathFont(font:MathFont,doc:Document){
  if(font===current)return;
  const runtime=doc.defaultView!.MathJax as unknown as Runtime;
  const {startup,config}=runtime;
  outputs.set(current,startup.output);
  let next=outputs.get(font);
  if(!next){
    const base=mathFontBase(font,doc);
    config.loader.paths[font]=base;
    await runtime.loader.load('['+font+']/chtml');
    const fontData=runtime._.output.fonts[font]?.chtml_ts?.MathJaxStix2Font;
    if(!fontData)throw Error('Could not load the document math font.');
    Object.assign(config.chtml,{font:'['+font+']',fontData,fontURL:base+'/chtml/woff2',dynamicPrefix:'['+font+']/chtml/dynamic'});
    next=startup.getOutputJax();next.setAdaptor(startup.document.adaptor);next.initialize();
  }
  startup.document.outputJax=startup.output=next;
  config.chtml.font='['+font+']';
  if(!outputs.has(font))for(const name of ['mathjax-bboldx','mathjax-mhchem'])runtime._.output.fonts[name]?.chtml?.install();
  current=font;
  await startup.document.rerenderPromise();
}

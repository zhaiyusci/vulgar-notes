import {EditorModel} from './editor-model';
import {maxClipboardLength,nativeClipboardMime,nativeClipboardPayloadHtml,readNativeClipboardPayload,safeClipboardJson,
  type ClipboardReader,type ClipboardWriter} from './clipboard-fragment-wire';

export interface MathClipboardContent {snapshot?:string;source?:string}
export interface MathClipboardAdapter {
  read(data:ClipboardReader):MathClipboardContent|undefined;
  /** True means at least the readable text was written; only then may a cut delete. */
  write(data:ClipboardWriter,snapshot:string,latex:string):boolean;
}
interface MathPayload {version:1;kind:'math';snapshot:string}
function mathPayload(value:unknown):MathPayload|undefined {
  try{
    if(!value||typeof value!=='object'||!safeClipboardJson(value))return;
    const item=value as Record<string,unknown>;
    if(item.version!==1||item.kind!=='math'||typeof item.snapshot!=='string'||JSON.stringify(item).length>maxClipboardLength)return;
    if(!safeClipboardJson(JSON.parse(item.snapshot)))return;
    new EditorModel().restore(item.snapshot);
    return {version:1,kind:'math',snapshot:item.snapshot};
  }catch{return;}
}

/** Accept explicit source for one formula, never infer TeX from rendered glyphs. */
export function extractMathClipboardHtml(source:string):{source:string;display:boolean}|undefined {
  if(!source||source.length>maxClipboardLength*2)return;
  const parsed=new DOMParser().parseFromString(source,'text/html');
  parsed.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(element=>element.remove());
  const annotations:{source:string;display:boolean}[]=[];
  for(const element of parsed.querySelectorAll('[data-vulgar-tex],math,.katex,mjx-container')){
    if(!parsed.body.contains(element))continue;
    const annotation=element.querySelector('annotation[encoding="application/x-tex"],annotation[encoding="application/x-latex"]');
    const tex=element.getAttribute('data-vulgar-tex')??annotation?.textContent;
    if(tex===undefined||tex===null)continue;
    const display=element.getAttribute('data-vulgar-display')==='true'||element.getAttribute('display')==='block'||element.getAttribute('display')==='true'||!!element.closest('.katex-display');
    annotations.push({source:tex,display});element.remove();
  }
  return annotations.length===1&&parsed.body.textContent?.trim()===''?annotations[0]:undefined;
}

/** Formula-only default. It has no knowledge of document nodes, references or libraries. */
export const mathClipboard:MathClipboardAdapter={
  read(data){
    const native=mathPayload(readNativeClipboardPayload(data));
    if(native)return {snapshot:native.snapshot};
    try{const annotation=extractMathClipboardHtml(data.getData('text/html'));return annotation?{source:annotation.source}:undefined;}catch{return;}
  },
  write(data,snapshot,latex){
    try{data.setData('text/plain',latex);}catch{return false;}
    const payload=mathPayload({version:1,kind:'math',snapshot});
    if(!payload)return true;
    try{data.setData(nativeClipboardMime,JSON.stringify(payload));}catch{/* HTML may preserve the structure. */}
    try{
      const html=latex.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      data.setData('text/html',nativeClipboardPayloadHtml(payload,'<span>'+html+'</span>'));
    }catch{/* Readable text/custom MIME remain available. */}
    return true;
  },
};

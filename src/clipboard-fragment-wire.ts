/** Shared wire format only. Document and formula schemas validate their own payloads. */
export const nativeClipboardMime='application/x-vulgar-notes-fragment+json';
export const nativeClipboardAttribute='data-vulgar-notes-fragment';
export const maxClipboardLength=50*1024*1024;
const maxDepth=200;
export interface ClipboardReader {getData(type:string):string}
export interface ClipboardWriter {setData(type:string,value:string):void}

export function safeClipboardJson(value:unknown,depth=0,seen=new Set<object>()):boolean {
  if(depth>maxDepth)return false;
  if(value===null||typeof value==='string'||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(typeof value!=='object'||seen.has(value))return false;
  seen.add(value);
  const prototype=Object.getPrototypeOf(value);
  const okay=Array.isArray(value)?value.every(child=>safeClipboardJson(child,depth+1,seen)):
    prototype!==null&&Object.getPrototypeOf(prototype)!==null?false:
    Object.keys(value).every(key=>!['__proto__','prototype','constructor'].includes(key)&&safeClipboardJson((value as Record<string,unknown>)[key],depth+1,seen));
  seen.delete(value);return okay;
}

function parsePayload(source:string):unknown {
  if(!source||source.length>maxClipboardLength)return null;
  try{const value:unknown=JSON.parse(source);return safeClipboardJson(value)?value:null;}catch{return null;}
}

/** HTML is an inert string. An invalid direct payload never falls back to stale HTML. */
export function readNativeClipboardPayload(data:ClipboardReader):unknown {
  try{const direct=data.getData(nativeClipboardMime);if(direct)return parsePayload(direct);}catch{/* MIME may be unavailable. */}
  try{
    const html=data.getData('text/html');if(html.length>maxClipboardLength*2)return null;
    const marker=/\bdata-vulgar-notes-fragment\s*=\s*(["'])([A-Za-z0-9+/=]+)\1/i.exec(html);
    if(!marker||marker[2].length>Math.ceil(maxClipboardLength*4/3)+4)return null;
    const binary=atob(marker[2]),bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
    return parsePayload(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{return null;}
}

/** The caller must validate its schema and escape or sanitize the fallback HTML. */
export function nativeClipboardPayloadHtml(value:unknown,fallbackHtml:string):string {
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return '<span '+nativeClipboardAttribute+'="'+btoa(binary)+'">'+fallbackHtml+'</span>';
}

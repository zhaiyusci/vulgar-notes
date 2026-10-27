import {draftStorage,documentSessionId} from './platform';
import {parseDocumentEnvelope,documentContentKey,fromTiptap,isBlankDocument} from './plate-document';
import {migrateLegacy} from './document-format';
import {t} from './i18n';

const prefix='math-plate-document-v1';
const uuid=/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const metadataKey=(id:string)=>'editor.open-document:'+id;

async function fingerprint(source:string):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function copyMetadata(from:Storage,key:string,id:string):void{
  const raw=from.getItem(key);
  if(raw)try{const metadata=JSON.parse(raw);if(metadata.baseline)parseDocumentEnvelope(metadata.baseline);draftStorage().setItem(metadataKey(id),raw);}catch{/* Keep the original metadata; the content remains recoverable as unsaved. */}
}

/** One-way migration: old bytes stay intact, and each recovery gets an identity. */
export async function prepareDocumentRecovery():Promise<string|undefined>{
  const target=draftStorage();
  let remappedActive:string|undefined;
  // Web drafts used to live only in their tab. Preserve those before mounting
  // an editor against the new durable, per-document recovery store.
  const sessionKeys=Array.from({length:sessionStorage.length},(_,index)=>sessionStorage.key(index)).filter((key):key is string=>!!key);
  for(const key of sessionKeys){
    if(!key.startsWith(prefix+':'))continue;
    const id=key.slice(prefix.length+1);if(!uuid.test(id))continue;
    const source=sessionStorage.getItem(key);if(!source)continue;
    const stamp=await fingerprint(source),marker='vulgar-notes-session-migration:'+id;
    if(sessionStorage.getItem(marker)===stamp)continue;
    const existing=target.getItem(key);
    // If the original tab and another recovered view differ, retain both.
    let destination=id;
    if(existing&&documentContentKeySafe(existing)!==documentContentKeySafe(source))destination=crypto.randomUUID();
    if(destination!==id||!existing){
      target.setItem(prefix+':'+destination,source);
      copyMetadata(sessionStorage,metadataKey(id),destination);
    }
    if(destination!==id&&documentSessionId()===id)remappedActive=destination;
    sessionStorage.setItem(marker,stamp);
  }
  // Earlier versions used a singleton draft. It appears as a recovery item,
  // never as a document that automatically opens at application launch.
  const legacyKeys=[prefix,'math-tiptap-document-v1','math-text-flow-state'];
  const seen=new Set<string>();
  for(const storage of [target,sessionStorage]){
    const key=legacyKeys.find(candidate=>!!storage.getItem(candidate));if(!key)continue;
    const raw=storage.getItem(key)!;
    try{
      const envelope=key===prefix?parseDocumentEnvelope(raw):key==='math-tiptap-document-v1'?
        (()=>{const data=JSON.parse(raw);if(data.version!==2)throw Error('Invalid previous document');return {version:1,value:fromTiptap(data.doc)};})():
        {version:1,value:fromTiptap(migrateLegacy(raw))};
      const source=JSON.stringify(envelope),validated=parseDocumentEnvelope(source),stamp=await fingerprint(documentContentKey(source));
      if(seen.has(stamp))continue;seen.add(stamp);
      const marker='vulgar-notes-legacy-recovery:'+stamp;if(target.getItem(marker))continue;
      if(!isBlankDocument(validated.value,validated.bibliographyStyle)){
        const id=crypto.randomUUID();target.setItem(prefix+':'+id,source);
        copyMetadata(sessionStorage,'editor.open-document',id);
        target.setItem(marker,id);
      }
    }catch{/* Invalid legacy bytes are left untouched for recovery. */}
  }
  // A scoped URL may have inherited only session metadata from older versions.
  const active=documentSessionId();
  if(active&&!target.getItem(metadataKey(active)))copyMetadata(sessionStorage,metadataKey(active),active);
  return remappedActive;
}
function documentContentKeySafe(source:string):string{
  try{
    const parsed=parseDocumentEnvelope(source);
    return documentContentKey(JSON.stringify({version:1,value:parsed.value,...(parsed.bibliographyLibraries.length?{bibliographyLibraries:parsed.bibliographyLibraries}:{}),...(parsed.bibliographyStyle&&parsed.bibliographyStyle!=='simple'?{bibliographyStyle:parsed.bibliographyStyle}:{})}));
  }catch{return source;}
}
export interface RecoverableDocument {id:string;name:string;updatedAt?:number}
export function listRecoverableDocuments():RecoverableDocument[]{
  const storage=draftStorage(),items:RecoverableDocument[]=[];
  for(let index=0;index<storage.length;index++){
    const key=storage.key(index);if(!key?.startsWith(prefix+':'))continue;
    const id=key.slice(prefix.length+1);if(!uuid.test(id))continue;
    try{
      const source=storage.getItem(key)!,parsed=parseDocumentEnvelope(source);
      let metadata:{name?:unknown;baseline?:unknown}={};try{const value=JSON.parse(storage.getItem(metadataKey(id))||'{}');if(value&&typeof value==='object')metadata=value;}catch{}
      let baseline=typeof metadata.baseline==='string'?metadata.baseline:undefined;
      if(baseline)try{parseDocumentEnvelope(baseline);}catch{baseline=undefined;}
      if(baseline?documentContentKeySafe(source)===documentContentKeySafe(baseline):isBlankDocument(parsed.value,parsed.bibliographyStyle))continue;
      const updatedAt=Number(storage.getItem(key+'-updated-at'));
      items.push({id,name:typeof metadata.name==='string'?metadata.name:t('Untitled'),...(updatedAt>0?{updatedAt}:{})});
    }catch{/* A corrupt entry must never replace a usable document. */}
  }
  return items.sort((a,b)=>(b.updatedAt??0)-(a.updatedAt??0));
}

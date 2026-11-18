// SPDX-License-Identifier: GPL-3.0-or-later
import {resolveProofreadingEndpoint} from './proofreading-provider';
import {resolveLanguageToolEndpoint} from './languagetool-provider';
export interface ProofreadingSettings {
  enabled:boolean;
  provider:'languagetool'|'ai';
  languageToolEndpoint:string;
  languageToolLanguage:string;
  endpoint:string;
  apiKey:string;
  model:string;
  rememberKey:boolean;
}

const preferencesKey='editor.proofreading';
const sessionKey='editor.proofreading.apiKey';
const defaults:ProofreadingSettings=Object.freeze({enabled:false,provider:'languagetool',languageToolEndpoint:'http://127.0.0.1:8081/v2',languageToolLanguage:'en-US',endpoint:'',apiKey:'',model:'',rememberKey:false});
let snapshot:ProofreadingSettings|undefined;
const listeners=new Set<()=>void>();

const same=(left:ProofreadingSettings,right:ProofreadingSettings)=>
  left.enabled===right.enabled&&left.provider===right.provider&&left.languageToolEndpoint===right.languageToolEndpoint&&left.languageToolLanguage===right.languageToolLanguage&&left.endpoint===right.endpoint&&left.apiKey===right.apiKey&&left.model===right.model&&left.rememberKey===right.rememberKey;
const normalized=(value:ProofreadingSettings):ProofreadingSettings=>({
  // Calls from older clients used the AI-only shape. Only a new preference
  // store defaults to LanguageTool; saving an old shape keeps its AI semantics.
  provider:value.provider==='languagetool'?'languagetool':'ai',
  languageToolEndpoint:typeof value.languageToolEndpoint==='string'?value.languageToolEndpoint.trim():defaults.languageToolEndpoint,
  languageToolLanguage:typeof value.languageToolLanguage==='string'?value.languageToolLanguage.trim():defaults.languageToolLanguage,
  enabled:value.enabled===true,endpoint:value.endpoint.trim(),apiKey:value.apiKey.trim(),model:value.model.trim(),rememberKey:value.rememberKey===true,
});

export function validateProofreadingSettings(next:ProofreadingSettings):string|undefined {
  const value=normalized(next);
  if(value.provider==='languagetool'){
    if(value.enabled&&!value.languageToolEndpoint)return 'Enter a valid LanguageTool service address.';
    if(value.languageToolEndpoint){
      try{resolveLanguageToolEndpoint(value.languageToolEndpoint);}
      catch(error){return error instanceof Error?error.message:'Enter a valid LanguageTool service address.';}
    }
    if(value.enabled&&!value.languageToolLanguage||value.languageToolLanguage.length>35||value.languageToolLanguage&&value.languageToolLanguage!=='auto'&&!/^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u.test(value.languageToolLanguage))return 'Enter a valid LanguageTool language code.';
    return;
  }
  if(value.enabled&&!value.endpoint)return 'Enter a valid HTTP or HTTPS API address.';
  if(value.endpoint){
    try{resolveProofreadingEndpoint(value.endpoint);}
    catch(error){return error instanceof Error?error.message:'Enter a valid HTTP or HTTPS API address.';}
  }
  if(value.enabled&&!value.model||value.model.length>256||/[\u0000-\u001f\u007f]/u.test(value.model))return 'Enter a model name.';
  if(value.apiKey.length>16_384||/[\u0000-\u001f\u007f]/u.test(value.apiKey))return 'The API key contains invalid characters.';
}

function load():ProofreadingSettings {
  let stored:Record<string,unknown>={},hasStoredSettings=false;
  try{
    const parsed=JSON.parse(window.localStorage.getItem(preferencesKey)??'null');
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){stored=parsed;hasStoredSettings=true;}
  }catch{/* Unavailable or malformed preferences leave proofreading off. */}
  const rememberKey=stored.rememberKey===true;
  let apiKey=rememberKey&&typeof stored.apiKey==='string'?stored.apiKey:'';
  if(!rememberKey){
    try{apiKey=window.sessionStorage.getItem(sessionKey)??'';}
    catch{apiKey=snapshot&&!snapshot.rememberKey?snapshot.apiKey:'';}
  }
  const provider=stored.provider==='languagetool'?'languagetool':stored.provider==='ai'||hasStoredSettings?'ai':'languagetool';
  const value=normalized({enabled:stored.enabled===true&&(stored.provider===undefined||stored.provider==='ai'||stored.provider==='languagetool'),provider,
    languageToolEndpoint:typeof stored.languageToolEndpoint==='string'?stored.languageToolEndpoint:defaults.languageToolEndpoint,
    languageToolLanguage:typeof stored.languageToolLanguage==='string'?stored.languageToolLanguage:defaults.languageToolLanguage,
    endpoint:typeof stored.endpoint==='string'?stored.endpoint:'',
    apiKey,model:typeof stored.model==='string'?stored.model:'',rememberKey});
  // An externally edited or obsolete configuration must not start a request.
  if(validateProofreadingSettings(value))value.enabled=false;
  return value;
}

function publish(value:ProofreadingSettings):void {
  if(snapshot&&same(snapshot,value))return;
  snapshot=Object.freeze(value);
  for(const listener of listeners)listener();
}

export function readProofreadingSettings():ProofreadingSettings {
  if(!snapshot)snapshot=Object.freeze(typeof window==='undefined'?{...defaults}:load());
  return snapshot;
}

const restore=(storage:Storage,key:string,previous:string|null)=>{
  if(previous===null)storage.removeItem(key);else storage.setItem(key,previous);
};

/** Local application preferences only; neither storage record belongs in a document. */
export function saveProofreadingSettings(next:ProofreadingSettings):boolean {
  if(validateProofreadingSettings(next)||typeof window==='undefined')return false;
  const value=normalized(next);
  let local:Storage,session:Storage,previousLocal:string|null,previousSession:string|null;
  try{
    local=window.localStorage;session=window.sessionStorage;
    previousLocal=local.getItem(preferencesKey);previousSession=session.getItem(sessionKey);
  }catch{return false;}
  const {apiKey,...preferences}=value;
  try{
    if(value.rememberKey||!apiKey)session.removeItem(sessionKey);else session.setItem(sessionKey,apiKey);
    // Keeping remembered credentials in this one record makes cross-tab
    // preference updates atomic. Session-only keys never enter localStorage.
    local.setItem(preferencesKey,JSON.stringify({...preferences,...(value.rememberKey?{apiKey}:{})}));
  }catch{
    try{restore(local,preferencesKey,previousLocal);}catch{/* Best-effort rollback; report failure. */}
    try{restore(session,sessionKey,previousSession);}catch{/* Best-effort rollback; report failure. */}
    return false;
  }
  publish(value);return true;
}

function storageChanged(event:StorageEvent):void {
  if(event.key!==null&&event.key!==preferencesKey&&event.key!==sessionKey)return;
  publish(load());
}

export function subscribeProofreadingSettings(listener:()=>void):()=>void {
  readProofreadingSettings();
  if(!listeners.size&&typeof window!=='undefined'){
    window.addEventListener('storage',storageChanged);
    publish(load());
  }
  listeners.add(listener);
  return ()=>{
    listeners.delete(listener);
    if(!listeners.size&&typeof window!=='undefined')window.removeEventListener('storage',storageChanged);
  };
}

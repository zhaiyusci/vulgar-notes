import {isTauri} from '@tauri-apps/api/core';
import {parseDocumentFile,documentContentKey} from './plate-document';
import {defaultDocumentName,documentSessionId,draftStorage,newDocumentWindow,openDocumentFile,saveDocumentFile,type DocumentFile,type OpenedDocument} from './platform';
import {getRecentDocumentTarget,openRecentDocument,rememberRecentDocument} from './recent-documents';
import {t} from './i18n';
import {recordRuntimeEvent} from './runtime-diagnostics';

/** The controller does not depend on the rich-text editor or its UI framework. */
export interface DocumentLifecycleHost {
  persist():void;
  serializeDocument():string;
  hasUnsavedChanges():boolean;
  markDocumentSaved(source:string):void;
  openDocument(source:string):void;
}
export interface DocumentState {name:string;dirty:boolean;busy:boolean;active:boolean;sessionId:string|null}
interface DocumentMetadata {name:string;path?:string;recentId?:string;baseline?:string;pendingOpen?:boolean}
type DocumentCommand='new'|'open'|'save'|'saveAs'|'home';
type LeaveDecision='clean'|'save'|'discard'|'cancel';
interface LeaveAuthorization {host:DocumentLifecycleHost|null;contentKey:string|null}
/** Recovery copies belong to individual document sessions, never a default document. */
export const documentDraftKey=(id:string)=>'math-plate-document-v1:'+id;
export const documentMetadataKey=(id:string)=>'editor.open-document:'+id;
let host:DocumentLifecycleHost|null=null;
let currentFile:DocumentFile={name:defaultDocumentName};
let metadata:DocumentMetadata={name:defaultDocumentName};
let restoringTarget:Promise<void>=Promise.resolve();
let busy=false,suppressNextUnload=false,initialized=false,refreshing=false,leaving=false;
let state:DocumentState={name:t('Untitled'),dirty:false,busy:false,active:false,sessionId:documentSessionId()};
const listeners=new Set<()=>void>();

export function getDocumentState():DocumentState{return state;}
export function subscribeDocumentState(listener:()=>void):()=>void {listeners.add(listener);return ()=>listeners.delete(listener);}
function updateState(next:DocumentState){
  if(Object.keys(next).every(key=>next[key as keyof DocumentState]===state[key as keyof DocumentState]))return;
  state=next;for(const listener of listeners)listener();
  if(typeof document!=='undefined'){
    const title=next.active?`${next.dirty?'* ':''}${next.name} — Vulgar Notes`:'Vulgar Notes';document.title=title;
    if(isTauri())void import('@tauri-apps/api/window').then(({getCurrentWindow})=>getCurrentWindow().setTitle(title)).catch(()=>{});
  }
}
/** Call after prose, formula or document-setting changes. */
export function refreshDocumentState():void {
  if(refreshing||leaving)return;refreshing=true;
  try{updateState({name:metadata.baseline!==undefined?currentFile.name:t('Untitled'),dirty:host?.hasUnsavedChanges()??false,busy,active:host!==null,sessionId:documentSessionId()});}
  finally{refreshing=false;}
}
function readMetadata(id:string):DocumentMetadata {
  try{
    const source=draftStorage().getItem(documentMetadataKey(id))??sessionStorage.getItem(documentMetadataKey(id));
    if(!source)return {name:defaultDocumentName};
    const saved=JSON.parse(source);if(typeof saved.name!=='string'||!saved.name)throw Error('Invalid document metadata');
    if(saved.baseline!==undefined)parseDocumentFile(saved.baseline);
    return {name:saved.name,...(typeof saved.path==='string'?{path:saved.path}:{}),...(typeof saved.recentId==='string'?{recentId:saved.recentId}:{}),...(typeof saved.baseline==='string'?{baseline:saved.baseline}:{}),...(saved.pendingOpen===true?{pendingOpen:true}:{})};
  }catch{return {name:defaultDocumentName};}
}
function writeMetadata(id:string,value:DocumentMetadata):boolean {
  try{draftStorage().setItem(documentMetadataKey(id),JSON.stringify(value));return true;}catch{return false;}
}
/** Attach after the shell has selected its UUID and constructed an editor. */
export function attachDocumentHost(next:DocumentLifecycleHost):()=>void {
  leaving=false;host=next;const id=documentSessionId();metadata=id?readMetadata(id):{name:defaultDocumentName};
  currentFile={name:metadata.name,...(metadata.path?{path:metadata.path}:{})};
  if(metadata.pendingOpen){
    // Only first-open normalization establishes a new baseline; recovery must
    // keep the original saved baseline and show subsequent edits as unsaved.
    const originalBaseline=metadata.baseline;
    metadata.baseline=next.serializeDocument();delete metadata.pendingOpen;
    if(id&&!writeMetadata(id,metadata)){
      // Clearing the first-open flag is essential: it must never mark a later
      // recovered edit as clean merely because storage filled during startup.
      metadata.baseline=originalBaseline;
      if(!writeMetadata(id,metadata))throw Error(t('Unable to prepare document recovery. Your current document has been kept.'));
    }
  }
  if(metadata.baseline!==undefined)next.markDocumentSaved(metadata.baseline);
  const attachedFile=currentFile;
  restoringTarget=metadata.recentId?getRecentDocumentTarget(metadata.recentId).then(target=>{
    if(host===next&&currentFile===attachedFile&&target)currentFile=target;
  }).catch(()=>{/* Without a restored handle, Save falls back to the file picker. */}):Promise.resolve();
  refreshDocumentState();return ()=>{if(host===next){host=null;refreshDocumentState();}};
}
function reportError(action:DocumentCommand|'close',error:unknown){
  const message=t(action==='new'?'Unable to create document':action==='open'?'Unable to open document':action==='close'?'Unable to close document':'Unable to save document');
  window.dispatchEvent(new CustomEvent('vulgar-document-error',{detail:{action,message,error:String(error)}}));
}
function askToSave():Promise<'save'|'discard'|'cancel'> {
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='document-unsaved-dialog';dialog.dataset.documentUnsavedPrompt='';
    const heading=document.createElement('h2');heading.textContent=t('Save changes?');heading.id='document-unsaved-title';dialog.setAttribute('aria-labelledby',heading.id);
    const message=document.createElement('p');message.textContent=t('Save changes to this document before continuing?');
    const name=document.createElement('strong');name.textContent=state.name;
    const actions=document.createElement('div');actions.className='document-unsaved-actions';let settled=false;
    const finish=(choice:'save'|'discard'|'cancel')=>{if(settled)return;settled=true;dialog.close();dialog.remove();resolve(choice);};
    for(const [choice,label] of [['save','Save'],['discard','Discard'],['cancel','Cancel']] as const){
      const button=document.createElement('button');button.type='button';button.dataset.choice=choice;button.textContent=t(label);button.addEventListener('click',()=>finish(choice));actions.append(button);
    }
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish('cancel');});dialog.addEventListener('close',()=>{if(!settled)finish('cancel');});
    dialog.append(heading,name,message,actions);document.body.append(dialog);dialog.showModal();actions.querySelector<HTMLButtonElement>('[data-choice="save"]')!.focus();
  });
}
async function saveCurrent(saveAs=false):Promise<boolean> {
  const savingHost=host;if(!savingHost)return false;await restoringTarget;
  const source=savingHost.serializeDocument();const file=await saveDocumentFile(source,saveAs?undefined:currentFile,currentFile.name);if(!file)return false;
  // Retain the returned object: browser overwrite handles are private to it.
  currentFile=file;metadata={name:file.name,...(file.path?{path:file.path}:{}),baseline:source};
  try{metadata.recentId=(await rememberRecentDocument(file)).id;}catch{/* Saving remains successful when the recent-file catalog is unavailable. */}
  savingHost.markDocumentSaved(source);const id=documentSessionId();if(id)writeMetadata(id,metadata);refreshDocumentState();
  window.dispatchEvent(new CustomEvent('vulgar-document-saved'));
  // Do not navigate away if the document changed while its older snapshot saved.
  return host===savingHost&&!savingHost.hasUnsavedChanges();
}
async function mayLeave():Promise<LeaveDecision> {
  host?.persist();refreshDocumentState();if(!host?.hasUnsavedChanges())return 'clean';
  const choice=await askToSave();if(choice==='cancel')return 'cancel';
  if(choice==='save')return await saveCurrent()?'save':'cancel';return 'discard';
}
function discardRecovery():void {
  const id=documentSessionId();if(!id)return;const storage=draftStorage();
  try{if(metadata.baseline!==undefined)storage.setItem(documentDraftKey(id),metadata.baseline);else{storage.removeItem(documentDraftKey(id));storage.removeItem(documentMetadataKey(id));}}catch{}
}
function navigate(event:string,detail?:unknown):void {
  // Suppress only this already-confirmed navigation, not an unrelated later close.
  leaving=true;suppressNextUnload=true;window.dispatchEvent(new CustomEvent(event,{detail}));
  setTimeout(()=>{
    // A failed/blocked shell navigation must restore normal draft protection.
    // On success this page is already gone and this callback never runs.
    suppressNextUnload=false;leaving=false;host?.persist();refreshDocumentState();
  },1000);
}
function leaveAuthorization():LeaveAuthorization {
  return {host,contentKey:host?documentContentKey(host.serializeDocument()):null};
}
async function startOpenedDocument(file:OpenedDocument,discard:boolean,authorization:LeaveAuthorization):Promise<void> {
  parseDocumentFile(file.text);const id=crypto.randomUUID();
  const next:DocumentMetadata={name:file.name,...(file.path?{path:file.path}:{}),baseline:file.text,pendingOpen:true};
  try{next.recentId=(await rememberRecentDocument(file)).id;}catch{}
  // File reads, permission requests and recent-handle storage can outlast the
  // picker. Edits made during those awaits were not part of the earlier choice.
  // Recheck after every await and before any discard or navigation is committed.
  const current=leaveAuthorization();
  if(current.host!==authorization.host||current.contentKey!==authorization.contentKey)
    throw Error(t('The document changed while another file was opening. Your changes have been kept. Please try again.'));
  const storage=draftStorage();
  try{
    storage.setItem(documentDraftKey(id),file.text);
    storage.setItem(documentMetadataKey(id),JSON.stringify(next));
  }catch(error){
    try{storage.removeItem(documentDraftKey(id));storage.removeItem(documentMetadataKey(id));}catch{}
    throw error;
  }
  // Do not discard the current recovery until the next document is ready.
  if(discard)discardRecovery();
  void recordRuntimeEvent('document-open-complete');
  navigate('vulgar-document-start',{documentId:id,opened:file});
}
/** Home's New command starts one blank document in this window. */
export function startNewDocument():void {navigate('vulgar-document-start',{documentId:crypto.randomUUID()});}
async function exclusive(action:DocumentCommand|'close',operation:()=>Promise<void>):Promise<void> {
  if(busy)return;busy=true;refreshDocumentState();try{await operation();}catch(error){reportError(action,error);}finally{busy=false;refreshDocumentState();}
}
/** Home, toolbar and keyboard shortcuts share the same save/discard rules. */
export async function runDocumentCommand(action:DocumentCommand):Promise<void> {
  await exclusive(action,async()=>{
    if(action==='open')await recordRuntimeEvent('document-open-start');
    if(action==='new'){if(host){host.persist();await newDocumentWindow();}else startNewDocument();}
    else if(action==='save'||action==='saveAs')await saveCurrent(action==='saveAs');
    else{
      const decision=await mayLeave();if(decision==='cancel')return;
      if(action==='home'){if(decision==='discard')discardRecovery();navigate('vulgar-document-home');}
      else{const authorization=leaveAuthorization();const file=await openDocumentFile();if(!file)return;await recordRuntimeEvent('document-parse-start');parseDocumentFile(file.text);await recordRuntimeEvent('document-parse-complete');await startOpenedDocument(file,decision==='discard',authorization);}
    }
  });
}
/** Reopen the actual source; a cached snapshot is never presented as a file. */
export async function openRecentDocumentCommand(id:string):Promise<void> {
  await exclusive('open',async()=>{
    const decision=await mayLeave();if(decision==='cancel')return;
    const authorization=leaveAuthorization();const file=await openRecentDocument(id);if(!file)return;parseDocumentFile(file.text);await startOpenedDocument(file,decision==='discard',authorization);
  });
}
/** Install once, including on the home screen where no editor is attached. */
export function initDocumentLifecycle():()=>void {
  if(initialized)return ()=>{};initialized=true;
  const onKey=(event:KeyboardEvent)=>{
    if(event.isComposing||event.keyCode===229||!(event.ctrlKey||event.metaKey)||event.altKey||document.querySelector('dialog[open]'))return;
    const key=event.key.toLowerCase();if(key!=='s'&&key!=='o'&&(key!=='n'||event.shiftKey))return;
    event.preventDefault();event.stopPropagation();if(key==='n'&&event.repeat)return;
    void runDocumentCommand(key==='n'?'new':key==='o'?'open':event.shiftKey?'saveAs':'save');
  };
  const beforeUnload=(event:BeforeUnloadEvent)=>{
    // Native destruction may emit beforeunload after an explicit Discard.
    // Re-persisting here would recreate the recovery the user just discarded.
    if(isTauri()&&leaving)return;
    if(suppressNextUnload){suppressNextUnload=false;return;}host?.persist();
    if(!isTauri()&&host?.hasUnsavedChanges()){event.preventDefault();event.returnValue='';}
  };
  document.addEventListener('keydown',onKey,true);window.addEventListener('beforeunload',beforeUnload);
  let disposed=false,nativeUnlisten:(()=>void)|undefined;
  if(isTauri())void import('@tauri-apps/api/window').then(async({getCurrentWindow})=>{
    const current=getCurrentWindow();const unlisten=await current.onCloseRequested(event=>{
      if(!host?.hasUnsavedChanges())return;event.preventDefault();
      void exclusive('close',async()=>{
        const decision=await mayLeave();if(decision==='cancel')return;
        leaving=true;if(decision==='discard')discardRecovery();
        try{await current.destroy();}catch(error){leaving=false;host?.persist();throw error;}
      });
    });if(disposed)unlisten();else nativeUnlisten=unlisten;
  }).catch(error=>reportError('close',error));
  return ()=>{disposed=true;initialized=false;nativeUnlisten?.();document.removeEventListener('keydown',onKey,true);window.removeEventListener('beforeunload',beforeUnload);};
}

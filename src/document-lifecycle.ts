import {isTauri} from '@tauri-apps/api/core';
import {parseDocumentFile,documentContentKey} from './plate-document';
import {defaultDocumentName,documentSessionId,draftStorage,flushDocumentDraftStore,newDocumentWindow,openDocumentFile,saveDocumentFile,takeSystemDocumentFile} from './platform';
import {getRecentDocumentTarget,openRecentDocument,rememberRecentDocument} from './recent-documents';
import {createDocumentController,DocumentOperationError,documentMetadataKey,type DocumentAction,type DocumentSessionState,type DocumentOperationErrorCode} from './document-controller';
import {askToSaveDocument} from './document-dialogs';
import {t} from './i18n';
import {recordRuntimeEvent} from './runtime-diagnostics';

export {documentDraftKey,documentMetadataKey} from './document-controller';
export type {DocumentLifecycleHost} from './document-controller';
export interface DocumentState extends Omit<DocumentSessionState,'name'> {name:string}

const operationMessages:Record<DocumentOperationErrorCode,string>={
  'recovery-write-failed':'Unable to prepare document recovery. Your current document has been kept.',
  'document-changed':'The document changed while another file was opening. Your changes have been kept. Please try again.',
  'invalid-recovery':'Invalid document recovery.',
  'missing-recovery':'This recovery copy is no longer available.',
};
function reportError(action:DocumentAction,error:unknown):void {
  const message=t(action==='new'?'Unable to create document':action==='open'?'Unable to open document':action==='close'?'Unable to close document':'Unable to save document');
  const description=error instanceof DocumentOperationError?t(operationMessages[error.code]):String(error);
  window.dispatchEvent(new CustomEvent('vulgar-document-error',{detail:{action,message,error:description}}));
}

/** Application adapter: bind one UI-independent controller to this window's services. */
const controller=createDocumentController({
  defaultDocumentName,documentSessionId,draftStorage,flushDocumentDraftStore,
  parseDocumentFile,documentContentKey,newDocumentWindow,openDocumentFile,saveDocumentFile,takeSystemDocumentFile,
  getRecentDocumentTarget,openRecentDocument,rememberRecentDocument,recordRuntimeEvent,
  legacyMetadata:id=>sessionStorage.getItem(documentMetadataKey(id)),
  createId:()=>crypto.randomUUID(),
  askToSave:name=>askToSaveDocument(name??t('Untitled')),
  navigate:target=>window.dispatchEvent(target.kind==='home'?new CustomEvent('vulgar-document-home'):
    new CustomEvent('vulgar-document-start',{detail:{documentId:target.documentId,...(target.opened?{opened:target.opened}:{})}})),
  saved:()=>window.dispatchEvent(new CustomEvent('vulgar-document-saved')),
  reportError,
  schedule:(callback,delay)=>{setTimeout(callback,delay);},
});
export const {subscribeDocumentState,refreshDocumentState,attachDocumentHost,startNewDocument,runDocumentCommand,
  openRecentDocumentCommand,openRecoveredDocumentCommand,openSystemDocumentCommand}=controller;

let stateSource:DocumentSessionState|undefined;
let stateView:DocumentState;
/** Keep the translated view stable for useSyncExternalStore consumers. */
export function getDocumentState():DocumentState {
  const next=controller.getDocumentState();
  if(next!==stateSource){stateSource=next;stateView={...next,name:next.name??t('Untitled')};}
  return stateView;
}
function updateWindowTitle():void {
  const next=getDocumentState();
  const title=next.active?`${next.dirty?'* ':''}${next.name} — Vulgar Notes`:'Vulgar Notes';
  document.title=title;
  if(isTauri())void import('@tauri-apps/api/window').then(({getCurrentWindow})=>getCurrentWindow().setTitle(title)).catch(()=>{});
}

let initialized=false;
/** UI bindings only. Save, recovery, navigation and close decisions belong to the controller. */
export function initDocumentLifecycle():()=>void {
  if(initialized)return ()=>{};initialized=true;
  const unsubscribe=subscribeDocumentState(updateWindowTitle);updateWindowTitle();
  const onKey=(event:KeyboardEvent)=>{
    if(event.isComposing||event.keyCode===229||!(event.ctrlKey||event.metaKey)||event.altKey||document.querySelector('dialog[open]'))return;
    const key=event.key.toLowerCase();if(key!=='s'&&key!=='o'&&(key!=='n'||event.shiftKey))return;
    event.preventDefault();event.stopPropagation();if(key==='n'&&event.repeat)return;
    void runDocumentCommand(key==='n'?'new':key==='o'?'open':event.shiftKey?'saveAs':'save');
  };
  const beforeUnload=(event:BeforeUnloadEvent)=>{
    if(controller.prepareUnload(isTauri())){event.preventDefault();event.returnValue='';}
  };
  document.addEventListener('keydown',onKey,true);window.addEventListener('beforeunload',beforeUnload);
  let disposed=false,nativeUnlisten:(()=>void)|undefined;
  if(isTauri())void import('@tauri-apps/api/window').then(async({getCurrentWindow})=>{
    const current=getCurrentWindow();const unlisten=await current.onCloseRequested(event=>{
      if(!controller.hasActiveDocument())return;event.preventDefault();
      void controller.requestClose(()=>current.destroy());
    });if(disposed)unlisten();else nativeUnlisten=unlisten;
  }).catch(error=>reportError('close',error));
  return ()=>{disposed=true;initialized=false;unsubscribe();nativeUnlisten?.();document.removeEventListener('keydown',onKey,true);window.removeEventListener('beforeunload',beforeUnload);};
}

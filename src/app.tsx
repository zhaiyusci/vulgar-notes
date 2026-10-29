import {initLocale} from './i18n';
import {mountMathEditor} from './editor-ui';
import {PlateMathHost} from './plate-host';
import {initPreferences} from './preferences';
import {documentSessionId,initializeDocumentDraftStore,flushDocumentDraftStore,refreshDocumentDraftStore} from './platform';
import {DOCUMENT_DRAFT_STORAGE_ERROR,DOCUMENT_DRAFT_STORAGE_RESTORED} from './document-draft-store';
import {mountDocumentHome} from './document-home';
import {listRecentDocuments,removeRecentDocument} from './recent-documents';
import {prepareDocumentRecovery,listRecoverableDocuments} from './document-recovery';
import {attachDocumentHost,initDocumentLifecycle,refreshDocumentState,runDocumentCommand,openRecentDocumentCommand,openSystemDocumentCommand} from './document-lifecycle';
import {t} from './i18n';
import {recordRuntimeEvent} from './runtime-diagnostics';
initLocale();
initPreferences();

// Keep recovery failures separate from the formula renderer's transient status.
const recoveryWarning=document.createElement('p');
recoveryWarning.className='document-storage-warning';recoveryWarning.hidden=true;
recoveryWarning.setAttribute('role','status');recoveryWarning.setAttribute('aria-live','polite');
recoveryWarning.textContent=t('Local document recovery is unavailable. Your changes remain in this window. Please save the document to a file.');
document.body.append(recoveryWarning);
window.addEventListener(DOCUMENT_DRAFT_STORAGE_ERROR,()=>{recoveryWarning.hidden=false;});
window.addEventListener(DOCUMENT_DRAFT_STORAGE_RESTORED,()=>{recoveryWarning.hidden=true;});

function navigate(documentId?:string){
  const url=new URL(window.location.href);url.hash='';
  if(documentId)url.searchParams.set('document',documentId);else url.searchParams.delete('document');
  window.location.assign(url.href);
}
window.addEventListener('vulgar-document-start',event=>navigate((event as CustomEvent<{documentId:string}>).detail.documentId));
window.addEventListener('vulgar-document-home',()=>navigate());
window.addEventListener('vulgar-document-error',event=>{
  const {action,message,error}=(event as CustomEvent<{action?:string;message:string;error:string}>).detail;
  if(action==='open')void recordRuntimeEvent('document-open-error');
  if(action==='save'||action==='saveAs')void recordRuntimeEvent('document-save-error');
  const dialog=document.createElement('dialog');dialog.className='document-unsaved-dialog';
  const title=document.createElement('h2');title.textContent=message;
  const description=document.createElement('p');description.textContent=error;
  const actions=document.createElement('div');actions.className='document-unsaved-actions';
  const close=document.createElement('button');close.type='button';close.textContent=t('Close');
  close.addEventListener('click',()=>dialog.close());actions.append(close);dialog.append(title,description,actions);
  dialog.addEventListener('close',()=>{void recordRuntimeEvent('document-error-dialog-close');dialog.remove();},{once:true});
  document.body.append(dialog);void recordRuntimeEvent('document-error-dialog-start');dialog.showModal();void recordRuntimeEvent('document-error-dialog-visible');
});
let detachActiveHost:(()=>void)|undefined;
let failureShown=false;
function showDocumentFailure(){
  if(failureShown)return;failureShown=true;detachActiveHost?.();detachActiveHost=undefined;
  document.body.dataset.documentView='home';
  const container=document.getElementById('documentHome')!;container.hidden=false;container.replaceChildren();
  mountDocumentHome(container,{
    onNew:()=>runDocumentCommand('new'),onOpen:()=>runDocumentCommand('open'),
    onRecent:id=>openRecentDocumentCommand(id),onPreferences:()=>document.getElementById('openPreferences')!.click(),
  },{recentDocuments:listRecentDocuments(),error:t('The document could not be displayed. Its recovery data has been kept. You can open another file or create a new document.')});
}
window.addEventListener('vulgar-document-render-error',()=>{void recordRuntimeEvent('frontend-render-error');showDocumentFailure();});

async function start(){
  let recoveryError='';
  let draftsReady=false;
  try{await initializeDocumentDraftStore();draftsReady=true;}catch{recoveryError=t('Local recovery storage could not be read. Existing data has been kept.');}
  initDocumentLifecycle();
  // OS requests survive frontend loading in the native host. Claim only after
  // error handling and recovery storage are ready; navigation consumes it once.
  if(await openSystemDocumentCommand())return;
  try{const remapped=await prepareDocumentRecovery();await flushDocumentDraftStore();if(remapped){navigate(remapped);return;}}catch{recoveryError=t('Local recovery storage could not be read. Existing data has been kept.');}
  const homeContainer=document.getElementById('documentHome')!;
  if(documentSessionId()){
    // An unreadable IDB draft is not a blank document. Never let an empty or
    // stale localStorage fallback replace the same document's latest edits.
    if(!draftsReady){showDocumentFailure();return;}
    document.body.dataset.documentView='editor';homeContainer.hidden=true;
    mountMathEditor((mount,initial,hooks)=>{
      const host=new PlateMathHost(mount,initial,{...hooks,change:()=>{hooks.change();refreshDocumentState();}});
      detachActiveHost=attachDocumentHost(host);return host;
    });
    // Persist first-open normalization, including the cleared pendingOpen flag.
    // A cache failure must leave the mounted editor available for a real Save.
    try{await flushDocumentDraftStore();}catch{/* The recovery warning remains visible. */}
    return;
  }
  const home=mountDocumentHome(homeContainer,{
    onNew:()=>runDocumentCommand('new'),onOpen:()=>runDocumentCommand('open'),
    onRecent:id=>openRecentDocumentCommand(id),onRecover:id=>navigate(id),
    onRemoveRecent:async id=>{await removeRecentDocument(id);refreshHome();},
    onPreferences:()=>document.getElementById('openPreferences')!.click(),
  });
  function refreshHome(){
    home.refresh({recentDocuments:listRecentDocuments(),recoveries:listRecoverableDocuments(),...(recoveryError?{error:recoveryError}:{})});
  }
  refreshHome();
  const refreshStoredHome=()=>{void refreshDocumentDraftStore().then(refreshHome,refreshHome);};
  window.addEventListener('storage',refreshStoredHome);
  window.addEventListener('focus',refreshStoredHome);
}
void start().then(()=>recordRuntimeEvent('frontend-ready')).catch(()=>{void recordRuntimeEvent('frontend-start-error');showDocumentFailure();});

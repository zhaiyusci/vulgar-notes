import {initLocale} from './i18n';
import {mountMathEditor} from './editor-ui';
import {PlateMathHost} from './plate-host';
import {initPreferences} from './preferences';
import {documentSessionId} from './platform';
import {mountDocumentHome} from './document-home';
import {listRecentDocuments,removeRecentDocument} from './recent-documents';
import {prepareDocumentRecovery,listRecoverableDocuments} from './document-recovery';
import {attachDocumentHost,initDocumentLifecycle,refreshDocumentState,runDocumentCommand,openRecentDocumentCommand} from './document-lifecycle';
import {t} from './i18n';
import {recordRuntimeEvent} from './runtime-diagnostics';
initLocale();
initPreferences();
initDocumentLifecycle();

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
  try{const remapped=await prepareDocumentRecovery();if(remapped){navigate(remapped);return;}}catch{recoveryError=t('Local recovery storage could not be read. Existing data has been kept.');}
  const homeContainer=document.getElementById('documentHome')!;
  if(documentSessionId()){
    document.body.dataset.documentView='editor';homeContainer.hidden=true;
    mountMathEditor((mount,initial,hooks)=>{
      const host=new PlateMathHost(mount,initial,{...hooks,change:()=>{hooks.change();refreshDocumentState();}});
      detachActiveHost=attachDocumentHost(host);return host;
    });
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
  window.addEventListener('storage',refreshHome);
  window.addEventListener('focus',refreshHome);
}
void start().then(()=>recordRuntimeEvent('frontend-ready')).catch(()=>{void recordRuntimeEvent('frontend-start-error');showDocumentFailure();});

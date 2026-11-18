import {t} from './i18n';
import {recordRuntimeEvent} from './runtime-diagnostics';

/** UI only: the caller decides whether the returned choice permits navigation. */
export function askToSaveDocument(documentName:string):Promise<'save'|'discard'|'cancel'> {
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='document-unsaved-dialog';dialog.dataset.documentUnsavedPrompt='';
    const heading=document.createElement('h2');heading.textContent=t('Save changes?');heading.id='document-unsaved-title';dialog.setAttribute('aria-labelledby',heading.id);
    const message=document.createElement('p');message.textContent=t('Save changes to this document before continuing?');
    const name=document.createElement('strong');name.textContent=documentName;
    const actions=document.createElement('div');actions.className='document-unsaved-actions';let settled=false;
    const finish=(choice:'save'|'discard'|'cancel')=>{if(settled)return;settled=true;dialog.close();dialog.remove();resolve(choice);};
    for(const [choice,label] of [['save','Save'],['discard','Discard'],['cancel','Cancel']] as const){
      const button=document.createElement('button');button.type='button';button.dataset.choice=choice;button.textContent=t(label);button.addEventListener('click',()=>finish(choice));actions.append(button);
    }
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish('cancel');});dialog.addEventListener('close',()=>{if(!settled)finish('cancel');});
    dialog.append(heading,name,message,actions);document.body.append(dialog);dialog.showModal();actions.querySelector<HTMLButtonElement>('[data-choice="save"]')!.focus();
  });
}

/** Error presentation has no authority to replace, save or discard a document. */
export function showDocumentError({message,error}:{message:string;error:string}):void {
  const dialog=document.createElement('dialog');dialog.className='document-unsaved-dialog';
  const title=document.createElement('h2');title.textContent=message;
  const description=document.createElement('p');description.textContent=error;
  const actions=document.createElement('div');actions.className='document-unsaved-actions';
  const close=document.createElement('button');close.type='button';close.textContent=t('Close');
  close.addEventListener('click',()=>dialog.close());actions.append(close);dialog.append(title,description,actions);
  dialog.addEventListener('close',()=>{void recordRuntimeEvent('document-error-dialog-close');dialog.remove();},{once:true});
  document.body.append(dialog);void recordRuntimeEvent('document-error-dialog-start');dialog.showModal();void recordRuntimeEvent('document-error-dialog-visible');
}

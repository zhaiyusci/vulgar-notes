import {locale,t} from './i18n';
import type {RecoverableDocument} from './document-recovery';

/** Recovery is an explicit maintenance action, not another document list on Home. */
export function initDocumentRecoveryPreferences(options:{
  list:()=>Promise<readonly RecoverableDocument[]>;
  open:(id:string)=>void;
}):void {
  const dialog=document.getElementById('preferencesDialog') as HTMLDialogElement;
  const section=document.getElementById('documentRecovery') as HTMLDetailsElement;
  const list=document.getElementById('documentRecoveryList')!;
  const status=document.getElementById('documentRecoveryStatus')!;
  let generation=0;
  section.addEventListener('toggle',()=>{
    const request=++generation;
    list.replaceChildren();
    if(!section.open)return;
    status.textContent=t('Loading…');
    void options.list().then(items=>{
      if(request!==generation||!section.open||!dialog.open)return;
      status.textContent=items.length?'':t('No recovery copies');
      for(const item of items){
        const row=document.createElement('li');
        const button=document.createElement('button');button.type='button';
        button.className='document-recovery-file';button.dataset.recoveryId=item.id;
        const name=document.createElement('span');name.textContent=item.name??t('Untitled');button.append(name);
        if(item.updatedAt&&Number.isFinite(new Date(item.updatedAt).getTime())){
          const date=document.createElement('time');date.dateTime=new Date(item.updatedAt).toISOString();
          date.textContent=new Intl.DateTimeFormat(locale,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(item.updatedAt);
          date.title=t('Last edited');button.append(date);
        }
        button.addEventListener('click',()=>{
          if(!dialog.open)return;
          // Close Preferences first; its unapplied settings roll back normally.
          // The document lifecycle then protects the current file's edits.
          dialog.close();options.open(item.id);
        });
        row.append(button);list.append(row);
      }
    },()=>{
      if(request===generation&&section.open&&dialog.open)status.textContent=t('Local recovery storage could not be read. Existing data has been kept.');
    });
  });
  dialog.addEventListener('close',()=>{generation++;section.open=false;list.replaceChildren();status.textContent='';});
}

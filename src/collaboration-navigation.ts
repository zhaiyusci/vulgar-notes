import {isTauri} from '@tauri-apps/api/core';
import {documentSessionId} from './platform';
import {parseCollaborationInvite,collaborationInviteUrl,type CollaborationInvite} from './collaboration-invite';

const bindingKey=(id:string)=>'vulgar.collaboration-document:'+id;
/** Local session identifiers and file paths never appear in invitations. */
export function rememberCollaborationInvite(invite:CollaborationInvite,id=documentSessionId()):void {
  if(id)sessionStorage.setItem(bindingKey(id),invite.room);
}
export function forgetCollaborationInvite():void {
  const id=documentSessionId();if(id)sessionStorage.removeItem(bindingKey(id));
  const url=new URL(location.href);url.hash='';history.replaceState(null,'',url.href);
}
/** Every newly opened invitation owns a fresh local draft, even with a document query. */
export function prepareCollaborationInvitation():{invite:CollaborationInvite;redirected:boolean}|null {
  const invite=parseCollaborationInvite(location.href);if(!invite)return null;
  const url=new URL(location.href),id=documentSessionId();
  if(id&&sessionStorage.getItem(bindingKey(id))===invite.room)return {invite,redirected:false};
  const next=crypto.randomUUID();rememberCollaborationInvite(invite,next);url.searchParams.set('document',next);
  location.replace(url.href);return {invite,redirected:true};
}
export async function openCollaborationInvitation(invite:CollaborationInvite):Promise<void> {
  const link=collaborationInviteUrl(invite,location.href);
  if(!isTauri()){
    const tab=window.open(link,'_blank');
    if(!tab)throw Error('The new tab could not be opened. Please allow pop-ups for this site.');
    tab.opener=null;return;
  }
  const {WebviewWindow}=await import('@tauri-apps/api/webviewWindow');
  const local=new URL('index.html',location.href);local.search='';local.hash=new URL(link).hash;
  const view=new WebviewWindow('document-collaboration-'+crypto.randomUUID(),{url:local.href,title:'Vulgar Notes',width:1400,height:900,minWidth:800,minHeight:540,dragDropEnabled:false});
  await new Promise<void>((resolve,reject)=>{
    void view.once('tauri://created',()=>resolve());
    void view.once('tauri://error',event=>reject(Error(String(event.payload))));
  });
}

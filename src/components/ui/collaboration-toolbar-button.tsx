import {useContext,useRef,useState,useSyncExternalStore} from 'react';
import {CheckIcon,CopyIcon,LogOutIcon,UsersIcon} from 'lucide-react';
import {toast} from 'sonner';
import {HostContext} from '@/plate-math-element';
import {inactiveCollaboration,type CollaborationState} from '@/collaboration-types';
import {collaborationInviteUrl,parseCollaborationInvite} from '@/collaboration-invite';
import {openCollaborationInvitation} from '@/collaboration-navigation';
import {t} from '@/i18n';
import {ToolbarButton} from './toolbar';
import {Button} from './button';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from './dialog';

const noSubscription=()=>()=>{};
const inactiveState=()=>inactiveCollaboration;
const safeErrors=new Set([
  'This collaboration link is invalid.',
  'Secure collaboration links are unavailable in this browser.',
  'This collaboration room uses an unsupported document version.',
  'The new tab could not be opened. Please allow pop-ups for this site.',
  'Invalid shared bibliography record.',
  'Invalid shared formula.',
  'Invalid shared formula root.',
  'Invalid shared formula structure.',
  'Invalid shared formula item.',
  'Missing shared formula region.',
  'Missing shared formula node.',
  'The shared formula changed before the local edit was applied.',
  'This editor is already connected to a shared document.',
  'The shared document is already initialized.',
  'Wait for the shared document before connecting the editor.',
  'The collaborative editor binding has been destroyed.',
]);
function safeError(error:unknown):string {
  const message=error instanceof Error?error.message:typeof error==='string'?error:'';
  return t(safeErrors.has(message)?message:'Collaboration failed. Your local document has been kept.');
}
function statusLabel(state:CollaborationState):string {
  if(state.ended)return t('Session ended');
  if(state.active&&state.role==='guest'){
    if(!state.ready&&state.status!=='offline')return t('Connecting to the host…');
    if(state.ready&&state.status==='online'&&state.hostConnected!==false&&state.permission==='view')return t('View only');
    if(!state.writable)return t('Editing paused');
    return t('Connected to the host');
  }
  if(state.active&&!state.ready&&state.status!=='offline')return t('Preparing this document…');
  if(state.status==='online')return t(state.peers.length===1?'{count} collaborator online':'{count} collaborators online',{count:state.peers.length});
  return t({inactive:'Not sharing',connecting:'Connecting…',waiting:'Waiting for collaborators',offline:'Disconnected'}[state.status]);
}

export function CollaborationToolbarButton(){
  const host=useContext(HostContext);
  const state=useSyncExternalStore(host?.subscribeCollaboration??noSubscription,host?.getCollaborationState??inactiveState,inactiveState);
  const [open,setOpen]=useState(false),[name,setName]=useState(state.name),[joinLink,setJoinLink]=useState('');
  const [working,setWorking]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  const [recoveryIndex,setRecoveryIndex]=useState(0);
  const busy=useRef(false),shareInput=useRef<HTMLInputElement>(null);
  let link='';
  try{if(state.invite)link=collaborationInviteUrl(state.invite,location.href);}catch{/* A malformed invite cannot crash document rendering. */}
  const status=statusLabel(state),displayError=error||(state.error?safeError(state.error):'');
  const show=()=>{setName(state.name);setError('');setCopied(false);setOpen(true);};
  const applyName=()=>{
    const value=name.trim().slice(0,80)||'Collaborator';setName(value);host?.setCollaborationName(value);
  };
  const start=async()=>{
    if(!host||busy.current||state.active)return;
    busy.current=true;setWorking(true);setError('');setCopied(false);
    try{await host.startCollaboration();applyName();}
    catch(failure){setError(safeError(failure));}
    finally{busy.current=false;setWorking(false);}
  };
  const copy=async()=>{
    if(!link)return;
    setError('');
    try{
      if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(link);setCopied(true);toast.success(t('Invitation link copied.'));
    }catch{shareInput.current?.focus();shareInput.current?.select();setError(t('The link could not be copied. Select and copy it manually.'));}
  };
  const join=async()=>{
    if(busy.current)return;
    setError('');
    let invite;
    try{
      invite=parseCollaborationInvite(joinLink.trim());
      if(!invite){setError(t('Paste a collaboration invitation link.'));return;}
    }catch(failure){setError(safeError(failure));return;}
    busy.current=true;setWorking(true);
    try{await openCollaborationInvitation(invite);setJoinLink('');setOpen(false);}
    catch(failure){setError(safeError(failure));}
    finally{busy.current=false;setWorking(false);}
  };
  const leave=()=>{
    if(!host)return;
    try{host.leaveCollaboration();setError('');setCopied(false);}
    catch(failure){setError(safeError(failure));}
  };
  const reconnect=async()=>{
    if(!host||busy.current)return;
    busy.current=true;setWorking(true);setError('');
    try{await host.reconnectCollaboration();}
    catch(failure){setError(safeError(failure));}
    finally{busy.current=false;setWorking(false);}
  };
  const recover=()=>{
    try{host?.downloadCollaborationRecovery(recoveryIndex);setError('');}
    catch(failure){setError(safeError(failure));}
  };
  const detach=()=>{
    try{host?.detachCollaboration();setError('');setCopied(false);}
    catch(failure){setError(safeError(failure));}
  };
  const setPermission=(peerId:string,permission:'view'|'edit')=>{
    try{host?.setCollaborationPermission(peerId,permission);setError('');}
    catch(failure){setError(safeError(failure));}
  };
  const viewOnly=state.active&&state.role==='guest'&&state.ready&&state.status==='online'&&state.hostConnected!==false&&state.permission==='view';
  const paused=state.active&&state.role==='guest'&&!state.writable&&!viewOnly&&(state.ready||state.status==='offline');
  const indicator=paused?'bg-amber-500':state.status==='online'?'bg-emerald-500':state.status==='offline'?'bg-rose-500':'bg-amber-500';
  return <>
    <ToolbarButton className="relative" tooltip={t('Collaboration')+' · '+status} aria-label={t('Collaboration')}
      aria-haspopup="dialog" aria-expanded={open} data-collaboration-status={state.status} disabled={!host}
      onPointerDown={event=>event.preventDefault()} onClick={show}>
      <UsersIcon />{state.active&&<span aria-hidden="true" className={'absolute right-1 top-1 size-1.5 rounded-full '+indicator} />}
    </ToolbarButton>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" showCloseButton={false} onCloseAutoFocus={event=>event.preventDefault()}>
        <DialogTitle>{t('Collaboration')}</DialogTitle>
        <DialogDescription>{t(state.role==='host'?'You keep the main file. Save it as usual.':state.role==='guest'?'You are editing a document shared by someone else.':'Invite people to edit this document with you.')}</DialogDescription>
        <div className="flex items-center gap-2 text-sm" role="status">
          <span aria-hidden="true" className={'size-2 rounded-full '+(state.active?indicator:'bg-muted-foreground')} />
          <span>{status}</span>
        </div>
        {state.active&&state.role&&<p className="text-xs text-muted-foreground">{t(state.role==='host'?'Host':'Guest')} {t('(you)')}</p>}
        {state.role==='guest'&&state.pending>0&&<p className="text-sm" role="status">{t(state.pending===1?'Waiting for the host to accept {count} change.':'Waiting for the host to accept {count} changes.',{count:state.pending})}</p>}
        {viewOnly&&<p className="text-sm text-muted-foreground">{t('The host can give you permission to edit.')}</p>}
        {paused&&<div className="grid gap-2 rounded border p-3">
          <p className="text-sm">{t(state.ended?'The host ended this session. You can make an independent copy.':'Reconnect to continue editing, or make an independent copy.')}</p>
          {!state.ended&&<div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={working} onClick={()=>void reconnect()}>{t(working?'Connecting…':'Reconnect')}</Button>
          </div>}
        </div>}
        <label className="grid gap-1.5 text-sm">{t('Your name')}
          <input className="w-full rounded border bg-background px-2.5 py-2" maxLength={80} value={name}
            aria-label={t('Your name')} autoComplete="nickname" onChange={event=>setName(event.target.value)} onBlur={applyName}
            onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();applyName();event.currentTarget.blur();}}} />
        </label>
        {!state.active?<div><Button type="button" size="sm" disabled={!host||working} onClick={()=>void start()}><UsersIcon className="size-4" />{t(working?'Starting…':'Invite people to edit')}</Button></div>
          :<div className="grid gap-3 rounded border p-3">
            <label className="grid gap-1.5 text-sm">{t('Invitation link')}
              <span className="flex min-w-0 gap-2">
                <input ref={shareInput} className="min-w-0 flex-1 rounded border bg-background px-2 py-1.5 font-mono text-xs" aria-label={t('Invitation link')} readOnly value={link} onFocus={event=>event.currentTarget.select()} />
                <Button type="button" variant="outline" size="sm" disabled={!link} onClick={()=>void copy()} aria-label={t('Copy invitation link')}>
                  {copied?<CheckIcon className="size-4" />:<CopyIcon className="size-4" />}{t(copied?'Copied':'Copy link')}
                </Button>
              </span>
            </label>
            <div className="text-sm">
              <p className="mb-1.5 text-xs text-muted-foreground">{t('Participants')}</p>
              <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label={t('Participants')}>
                <li className="inline-flex min-w-0 items-center gap-1.5"><span className="size-2 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" /><span className="max-w-56 truncate">{state.name==='Collaborator'?t('Collaborator'):state.name} {t('(you)')}{state.role==='host'&&<> · {t('Host')}</>}</span></li>
                {state.peers.map(peer=><li key={peer.clientId} className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-full" aria-hidden="true" style={{backgroundColor:peer.color}} />
                  <span className="max-w-56 truncate" title={peer.name}>{peer.name==='Collaborator'?t('Collaborator'):peer.name}{peer.host&&<> · {t('Host')}</>}</span>
                  {state.role==='host'&&!peer.host&&peer.transportPeerId&&<select className="rounded border bg-background px-1.5 py-1 text-xs" aria-label={t('Permission for {name}',{name:peer.name})} value={peer.permission??'view'} onChange={event=>setPermission(peer.transportPeerId!,event.target.value==='edit'?'edit':'view')}>
                    <option value="view">{t('Can view')}</option><option value="edit">{t('Can edit')}</option>
                  </select>}
                </li>)}
              </ul>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={working} onClick={leave}><LogOutIcon className="size-4" />{t(state.role==='host'?'End collaboration':'Leave collaboration')}</Button>
              {state.role==='guest'&&state.recoveryAvailable&&<>
                {(state.recoveryCopies?.length??0)>1&&<select className="rounded border bg-background px-1.5 py-1 text-xs" aria-label={t('Recovery copy')} value={recoveryIndex} onChange={event=>setRecoveryIndex(Number(event.target.value))}>
                  {state.recoveryCopies?.map((copy,index)=><option key={index} value={index}>{index+1} · {new Date(copy.createdAt).toLocaleString()}</option>)}
                </select>}
                <Button type="button" variant="outline" size="sm" onClick={recover}>{t('Save recovery copy')}</Button>
              </>}
              {state.role==='guest'&&<Button type="button" variant="outline" size="sm" disabled={!state.ready||working} onClick={detach}>{t('Make an independent copy')}</Button>}
            </div>
            {state.role==='host'&&<p className="text-xs text-muted-foreground">{t('New participants can view. Choose who can edit.')}</p>}
          </div>}
        <div className="grid gap-2 border-t pt-3">
          <label className="grid gap-1.5 text-sm">{t('Join with invitation link')}
            <input className="w-full rounded border bg-background px-2.5 py-2 text-sm" value={joinLink} inputMode="url" autoComplete="off" spellCheck={false}
              aria-label={t('Join with invitation link')} placeholder="https://…/#collab=…" onChange={event=>{setJoinLink(event.target.value);setError('');}}
              onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void join();}}} />
          </label>
          <div><Button type="button" variant="outline" size="sm" disabled={!joinLink.trim()||working} title={t('Open in a new tab or window')} onClick={()=>void join()}>{t('Join collaboration')}</Button></div>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('Anyone with the link can view this document. The host chooses who can edit.')}</p>
        <details className="text-xs leading-relaxed text-muted-foreground">
          <summary className="cursor-pointer">{t('Connection details')}</summary>
          <p className="mt-2">{t('Guests connect directly to the host. Public services help establish the connection and do not store the document. Closing the host’s window ends the session.')}</p>
          <p className="mt-1">{t('Some networks may prevent direct connections.')}</p>
        </details>
        {displayError&&<p role="alert" className="break-words text-sm text-destructive">{displayError}</p>}
        <div className="flex justify-end"><Button type="button" variant="outline" size="sm" onClick={()=>setOpen(false)}>{t('Close')}</Button></div>
      </DialogContent>
    </Dialog>
  </>;
}

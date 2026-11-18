'use client';

import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {Settings2Icon,SpellCheckIcon,XIcon} from 'lucide-react';
import {t} from '@/i18n';
import type {ProofreadingClient,ProofreadingRow,ProofreadingState} from '@/proofreading-client';
import {Popover,PopoverContent,PopoverTrigger} from './popover';
import {ToolbarButton} from './toolbar';

export type ProofreadingToolsProps={service:ProofreadingClient;readOnly:boolean;onConfigure:()=>void};
type ToolsProps=Pick<ProofreadingToolsProps,'service'|'readOnly'>;

function Issue({issue,service,readOnly,onNotice}:{issue:ProofreadingRow;onNotice:(message:string)=>void}&ToolsProps){
  const locate=()=>{if(!service.locate(issue.id))onNotice(t('This suggestion is no longer available. Check the paragraph again.'));};
  const apply=(replacement:string)=>{
    if(readOnly)return;
    if(!service.apply(issue.id,replacement))onNotice(t('This suggestion is no longer available. Check the paragraph again.'));
  };
  return <div className="proofreading-issue" data-proofreading-issue={issue.id}>
    <div className="proofreading-issue-heading">
      <button type="button" className="proofreading-original" title={t('Locate in document')} onPointerDown={event=>event.preventDefault()} onClick={locate}>{issue.original}</button>
      <span className="proofreading-kind">{t(issue.kind==='spelling'?'Spelling':'Grammar')}</span>
    </div>
    <div className="proofreading-replacements">
      {issue.replacements.map((replacement,index)=><button type="button" key={index} disabled={readOnly}
        onPointerDown={event=>event.preventDefault()} onClick={()=>apply(replacement)}
        aria-label={replacement?t('Replace with {replacement}',{replacement}):t('Delete')}>
        {replacement.trim()?replacement:replacement?t('Whitespace'):t('Delete')}
      </button>)}
    </div>
    {issue.message&&<p className="proofreading-explanation">{issue.message}</p>}
    <button type="button" className="proofreading-ignore" onClick={()=>service.ignore(issue.id)}>{t('Ignore')}</button>
  </div>;
}

/** Reusable proofreading controls: the surrounding app supplies the service and settings action. */
export function ProofreadingTools({service,readOnly,onConfigure}:ProofreadingToolsProps){
  const state=useSyncExternalStore(service.subscribe,service.getSnapshot,service.getSnapshot);
  const [open,setOpen]=useState(false),[limit,setLimit]=useState(100),[notice,setNotice]=useState('');
  useEffect(()=>{if(state.menu)setOpen(false);},[state.menu]);
  const changeOpen=(next:boolean)=>{setOpen(next);setNotice('');setLimit(100);if(next)service.closeMenu();};
  const configure=()=>{setOpen(false);service.closeMenu();onConfigure();};
  const current=()=>{setNotice(service.checkCurrent()?'':t('Place the cursor in editable prose first.'));};
  const activeIssue=state.menu?state.issues.find(issue=>issue.id===state.menu!.id):undefined;
  const busy=state.checking||state.pending>0;
  const status=!state.enabled?'Disabled':busy?'Checking…':'Manual checking';
  return <>
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild><ToolbarButton tooltip={t('Proofreading')} aria-label={t('Proofreading')}
        className="proofreading-trigger" data-proofreading-active={state.enabled?'true':'false'}
        onPointerDown={event=>event.preventDefault()}><SpellCheckIcon />
        {state.issues.length>0&&<span className="proofreading-count" aria-hidden="true">{state.issues.length>99?'99+':state.issues.length}</span>}
      </ToolbarButton></PopoverTrigger>
      <PopoverContent className="proofreading-panel" side="left" align="start" collisionPadding={12}
        onOpenAutoFocus={event=>event.preventDefault()} onCloseAutoFocus={event=>event.preventDefault()} onFocusOutside={event=>event.preventDefault()}>
        <div className="proofreading-heading"><strong>{t('Proofreading')}</strong>
          <button type="button" className="proofreading-icon" title={t('Proofreading settings')} aria-label={t('Proofreading settings')} onClick={configure}><Settings2Icon /></button>
        </div>
        <div className="proofreading-status" role="status"><span>{t(status)}</span>
          {state.pending>0&&<span>{t('Queued: {count}',{count:state.pending})}</span>}
          {state.checked>0&&<span>{t('Paragraphs checked: {count}',{count:state.checked})}</span>}
        </div>
        {!state.enabled?<p className="proofreading-empty">{t('Choose a proofreading service in Preferences to enable checking.')}</p>:<>
          <div className="proofreading-actions">
            <button type="button" disabled={readOnly||busy} onPointerDown={event=>event.preventDefault()} onClick={current}>{t('Check paragraph')}</button>
            <button type="button" disabled={readOnly||busy} onPointerDown={event=>event.preventDefault()} onClick={()=>{setNotice('');service.checkDocument();}}>{t('Check document')}</button>
            {busy&&<button type="button" onPointerDown={event=>event.preventDefault()} onClick={()=>{setNotice('');service.stop();}}>{t('Cancel checking')}</button>}
          </div>
          {readOnly&&<p className="proofreading-empty">{t('This document is read-only.')}</p>}
          {state.error&&<p className="proofreading-error" role="alert">{t(state.error)}</p>}
          {notice&&<p className="proofreading-error" role="status">{notice}</p>}
          {state.issues.length?<>
            <div className="proofreading-list">{state.issues.slice(0,limit).map(issue=><Issue key={issue.id} issue={issue} service={service} readOnly={readOnly} onNotice={setNotice}/>)}</div>
            {state.issues.length>limit&&<button type="button" className="proofreading-more" onClick={()=>setLimit(value=>value+100)}>{t('Show more suggestions')}</button>}
          </>:!busy&&!state.error&&<p className="proofreading-empty">{t(state.checked>0?'No issues found in the checked text.':'Check a paragraph or the document to see suggestions.')}</p>}
        </>}
      </PopoverContent>
    </Popover>
    {state.menu&&activeIssue&&<SuggestionMenu key={state.menu.id} service={service} readOnly={readOnly} issue={activeIssue} menu={state.menu}/>}
  </>;
}

function SuggestionMenu({service,readOnly,issue,menu}:ToolsProps&{issue:ProofreadingRow;menu:NonNullable<ProofreadingState['menu']>}){
  const panel=useRef<HTMLDivElement>(null),[notice,setNotice]=useState('');
  const [position,setPosition]=useState({left:menu.x,top:menu.y});
  useLayoutEffect(()=>{
    const element=panel.current;if(!element)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const place=()=>{
      const rect=element.getBoundingClientRect(),gap=8;
      setPosition({left:Math.max(gap,Math.min(menu.x,window.innerWidth-rect.width-gap)),top:Math.max(gap,Math.min(menu.y,window.innerHeight-rect.height-gap))});
    };
    place();element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
    const outside=(event:Event)=>{if(event.target instanceof Node&&!element.contains(event.target))service.closeMenu();};
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape')return;
      event.preventDefault();event.stopPropagation();service.closeMenu();
      if(previous?.isConnected)previous.focus({preventScroll:true});
    };
    document.addEventListener('pointerdown',outside,true);document.addEventListener('scroll',outside,true);
    document.addEventListener('keydown',escape,true);window.addEventListener('resize',place);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('scroll',outside,true);
      document.removeEventListener('keydown',escape,true);window.removeEventListener('resize',place);};
  },[service,menu.id,menu.x,menu.y]);
  return createPortal(<div ref={panel} className="proofreading-panel proofreading-suggestion-menu" role="dialog" aria-label={t('Proofreading suggestion')}
    style={position} onKeyDown={event=>{
      if(!['ArrowDown','ArrowUp','Home','End','Tab'].includes(event.key))return;
      const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];if(!buttons.length)return;
      const index=buttons.indexOf(document.activeElement as HTMLButtonElement),back=event.key==='ArrowUp'||event.key==='Tab'&&event.shiftKey;
      const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(back?-1:1)+buttons.length)%buttons.length;
      event.preventDefault();event.stopPropagation();buttons[next].focus();
    }}>
    <div className="proofreading-heading"><strong>{t('Proofreading suggestion')}</strong>
      <button type="button" className="proofreading-icon" aria-label={t('Close')} onClick={()=>service.closeMenu()}><XIcon /></button>
    </div>
    <Issue issue={issue} service={service} readOnly={readOnly} onNotice={setNotice}/>
    {notice&&<p className="proofreading-error" role="status">{notice}</p>}
  </div>,document.body);
}

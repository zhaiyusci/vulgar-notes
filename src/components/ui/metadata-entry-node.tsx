// SPDX-License-Identifier: GPL-3.0-or-later
'use client';

import {useContext,useEffect,useRef} from 'react';
import {ChevronDownIcon,GripVerticalIcon,LinkIcon} from 'lucide-react';
import {NodeApi,type TElement} from 'platejs';
import type {RangeRef} from 'slate';
import {PlateElement,useEditorSelector,useReadOnly,type PlateEditor,type PlateElementProps} from 'platejs/react';
import {metadataIndex,metadataNoteSymbol,metadataOrderedIds,reorderMetadataEntries,type MetadataEntry,type MetadataRole} from '@/document-metadata';
import {HostContext} from '@/plate-math-element';
import {t} from '@/i18n';
import {findMetadataTitle,metadataRoles,metadataRoleLabel} from './metadata-node';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator} from './dropdown-menu';
import {Popover,PopoverTrigger,PopoverContent} from './popover';

const placeholders:Record<MetadataRole,string>={title:'Document title',author:'Author name',affiliation:'Affiliation',note:'Note text',text:'Text'};
const plain=(node:any):string=>typeof node.text==='string'?node.text:typeof node.texExpression==='string'?node.texExpression:(node.children||[]).map(plain).join('');
const refs=(value:unknown):string[]=>Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'):[];

/** Pointer capture avoids contenteditable/native drag differences in Firefox and Chromium. */
function startMetadataEntryDrag(editor:PlateEditor,handle:HTMLElement,pointerId:number,startX:number,startY:number,node:MetadataEntry){
  const root=handle.closest<HTMLElement>('[data-slate-editor]'),metadata=handle.closest<HTMLElement>('.document-metadata');
  const at=editor.api.findPath(node);
  if(!root||!metadata||!at||!['author','affiliation'].includes(node.role))return ()=>{};
  const parentPath=editor.api.pathRef(at.slice(0,-1));
  const doc=handle.ownerDocument,win=doc.defaultView!,scroller=root.closest<HTMLElement>('#preview')??root;
  const source=handle.closest<HTMLElement>('.document-metadata-entry');
  const line=doc.createElement('div');line.dataset.metadataDropLine=node.role;line.setAttribute('aria-hidden','true');
  Object.assign(line.style,{position:'fixed',pointerEvents:'none',zIndex:'10000',background:'var(--app-link, #3b82f6)',display:'none'});doc.body.append(line);
  const oldCursor=doc.body.style.cursor,oldSelection=root.style.userSelect;
  let active=false,valid=false,finished=false,beforeId:string|null=null,x=startX,y=startY,frame=0;
  const update=()=>{
    const bounds=metadata.getBoundingClientRect(),viewport=scroller.getBoundingClientRect();
    const all=[...metadata.querySelectorAll<HTMLElement>('.document-metadata-entry')]
      .filter(element=>element.closest('.document-metadata')===metadata&&element.dataset.metadataRole===node.role);
    const candidates=all.filter(element=>element.dataset.metadataEntryId!==node.id).map(element=>({element,rect:element.getBoundingClientRect()}));
    const band=all.map(element=>element.getBoundingClientRect());
    const withinX=x>=Math.max(bounds.left,viewport.left)&&x<=Math.min(bounds.right,viewport.right);
    const firstNote=node.role==='affiliation'?[...metadata.querySelectorAll<HTMLElement>('.document-metadata-entry')]
      .find(element=>element.closest('.document-metadata')===metadata&&element.dataset.metadataRole==='note')?.getBoundingClientRect():undefined;
    // The upper note edge is the end of the affiliation group, never a slot among notes.
    if(candidates.length&&withinX&&firstNote&&Math.abs(y-firstNote.top)<=10&&y>=viewport.top&&y<=viewport.bottom){
      valid=true;beforeId=null;
      Object.assign(line.style,{display:'block',left:firstNote.left+'px',top:firstNote.top+'px',width:Math.max(2,firstNote.width)+'px',height:'2px'});return;
    }
    valid=!!candidates.length&&withinX
      &&y>=Math.max(viewport.top,Math.min(...band.map(rect=>rect.top))-12)
      &&y<=Math.min(viewport.bottom,Math.max(...band.map(rect=>rect.bottom))+12);
    if(!valid){line.style.display='none';return;}
    const distance=(rect:DOMRect)=>Math.max(rect.left-x,0,x-rect.right)**2+Math.max(rect.top-y,0,y-rect.bottom)**2;
    const nearest=candidates.reduce((best,item)=>distance(item.rect)<distance(best.rect)?item:best);
    const after=node.role==='author'?x>(nearest.rect.left+nearest.rect.right)/2:y>(nearest.rect.top+nearest.rect.bottom)/2;
    const targetIndex=candidates.indexOf(nearest);
    beforeId=after?candidates[targetIndex+1]?.element.dataset.metadataEntryId??null:nearest.element.dataset.metadataEntryId!;
    const rect=nearest.rect;
    Object.assign(line.style,node.role==='author'
      ?{display:'block',left:(after?rect.right:rect.left)+'px',top:rect.top+'px',width:'2px',height:Math.max(2,rect.height)+'px'}
      :{display:'block',left:rect.left+'px',top:(after?rect.bottom:rect.top)+'px',width:Math.max(2,rect.width)+'px',height:'2px'});
  };
  const commit=(at:number[]|null)=>{
    if(editor.api.isReadOnly()||!at)return;
    const current=NodeApi.get(editor,at) as TElement|undefined;if(current?.type!=='document_metadata')return;
    const ordered=reorderMetadataEntries(current,node.id,beforeId);if(ordered===current)return;
    editor.tf.withNewBatch(()=>editor.tf.withoutNormalizing(()=>{
      ordered.children.forEach((wanted,index)=>{
        if(wanted.type!=='metadata_entry'||wanted.role!==node.role)return;
        const currentParent=NodeApi.get(editor,at) as TElement;
        const from=currentParent.children.findIndex(item=>item.id===wanted.id);
        if(from!==-1&&from!==index)editor.tf.moveNodes({at:[...at,from],to:[...at,index]});
      });
    }));
    editor.tf.focus();
  };
  const scroll=()=>{
    if(finished)return;
    const rect=scroller.getBoundingClientRect();
    if(active&&x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom){
      const speed=y<rect.top+36?-10:y>rect.bottom-36?10:0;
      if(speed){scroller.scrollTop+=speed;update();}
    }
    frame=win.requestAnimationFrame(scroll);
  };
  const cleanup=()=>{
    if(finished)return;finished=true;win.cancelAnimationFrame(frame);
    win.removeEventListener('pointermove',move,true);win.removeEventListener('pointerup',up,true);win.removeEventListener('pointercancel',cancel,true);
    win.removeEventListener('keydown',key,true);win.removeEventListener('blur',cleanup);handle.removeEventListener('lostpointercapture',cleanup);
    if(handle.hasPointerCapture?.(pointerId))handle.releasePointerCapture(pointerId);
    parentPath.unref();line.remove();source?.removeAttribute('data-metadata-dragging');doc.body.style.cursor=oldCursor;root.style.userSelect=oldSelection;
  };
  const move=(event:PointerEvent)=>{
    if(event.pointerId!==pointerId)return;x=event.clientX;y=event.clientY;
    if(!active&&Math.hypot(x-startX,y-startY)<4)return;
    active=true;event.preventDefault();event.stopPropagation();doc.body.style.cursor='grabbing';root.style.userSelect='none';
    source?.setAttribute('data-metadata-dragging','true');update();
  };
  const up=(event:PointerEvent)=>{
    if(event.pointerId!==pointerId)return;x=event.clientX;y=event.clientY;
    if(active){event.preventDefault();event.stopPropagation();update();}
    const shouldCommit=active&&valid,currentPath=parentPath.current?[...parentPath.current]:null;
    cleanup();if(shouldCommit)commit(currentPath);
  };
  const cancel=(event:PointerEvent)=>{if(event.pointerId===pointerId)cleanup();};
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cleanup();}};
  win.addEventListener('pointermove',move,{capture:true,passive:false});win.addEventListener('pointerup',up,true);win.addEventListener('pointercancel',cancel,true);
  win.addEventListener('keydown',key,true);win.addEventListener('blur',cleanup);handle.addEventListener('lostpointercapture',cleanup);
  try{handle.setPointerCapture?.(pointerId);}catch{/* Window capture still handles a pointer released by the platform. */}
  frame=win.requestAnimationFrame(scroll);return cleanup;
}

export function MetadataEntryElement(props:PlateElementProps){
  const editor=props.editor,node=props.element as MetadataEntry,readOnly=useReadOnly(),host=useContext(HostContext);
  const saved=useRef<RangeRef|null>(null),pointerCleanup=useRef<(()=>void)|null>(null);
  useEffect(()=>()=>{saved.current?.unref();saved.current=null;pointerCleanup.current?.();},[]);
  const {block,index,title}=useEditorSelector(current=>{
    const blocks=current.children.filter(child=>child.type==='document_metadata') as TElement[];
    const at=current.api.findPath(props.element);
    const parent=at?NodeApi.get(current,at.slice(0,-1)) as TElement:undefined;
    return {block:parent,index:metadataIndex(blocks),title:findMetadataTitle(current.children)};
  },[props.element]);
  const grouped=node.role==='affiliation'||node.role==='note'||node.role==='text';
  const groupStart=grouped&&block?.children.find(child=>child.type==='metadata_entry'&&child.role===node.role)?.id===node.id;
  const affiliationIds=node.role==='author'?refs(node.affiliationIds):[];
  const noteIds=node.role==='author'||node.role==='title'?refs(node.noteIds):[];
  const affiliations=block?.children.filter(child=>child.type==='metadata_entry'&&child.role==='affiliation') as MetadataEntry[]|undefined;
  const notes=block?.children.filter(child=>child.type==='metadata_entry'&&child.role==='note') as MetadataEntry[]|undefined;
  const localAffiliations=new Set(affiliations?.map(entry=>entry.id)),localNotes=new Set(notes?.map(entry=>entry.id));
  const affiliationMarks=metadataOrderedIds(affiliationIds,index.affiliationNumbers),noteMarks=metadataOrderedIds(noteIds,index.noteNumbers);
  const noteMark=(id:string)=>{const number=index.noteNumbers.get(id);return number?metadataNoteSymbol(number,index.noteNumbers.size):'??';};
  const marks=node.role==='author'||node.role==='title'
    ?[...affiliationMarks.map(id=>String(localAffiliations.has(id)?index.affiliationNumbers.get(id)??'??':'??')),...noteMarks.map(id=>localNotes.has(id)?noteMark(id):'??')].join(', ')
    :node.role==='affiliation'?String(index.affiliationNumbers.get(node.id)??'??')
    :node.role==='note'?(index.noteNumbers.has(node.id)?noteMark(node.id):''):'';
  const empty=node.children.length===1&&node.children[0].type==='p'&&(node.children[0] as TElement).children.every(child=>typeof child.text==='string'&&child.text==='');
  const remember=()=>{saved.current?.unref();saved.current=editor.selection?editor.api.rangeRef(editor.selection):null;};
  const focus=()=>{const range=saved.current?.unref();saved.current=null;if(range)editor.tf.select(range);editor.tf.focus();};
  const path=()=>editor.api.findPath(props.element);
  const setRole=(role:MetadataRole)=>{
    const at=path();if(!at||readOnly)return;
    const existing=role==='title'?findMetadataTitle(editor.children):undefined;
    if(existing&&existing[0].id!==node.id)return;
    editor.tf.withNewBatch(()=>editor.tf.setNodes({role},{at}));
  };
  const remove=()=>{
    const at=path();if(!at||readOnly)return;
    saved.current?.unref();saved.current=null;
    editor.tf.withNewBatch(()=>{
      editor.tf.removeNodes({at});
      const parent=NodeApi.get(editor,at.slice(0,-1)) as TElement|undefined;
      if(parent?.children.length)editor.tf.select(editor.api.start([...at.slice(0,-1),Math.min(at[at.length-1],parent.children.length-1)]));
    });
  };
  const toggle=(property:'affiliationIds'|'noteIds',id:string,checked:boolean)=>{
    const at=path();if(!at||readOnly)return;
    const current=NodeApi.get(editor,at) as MetadataEntry,ids=refs(current[property]);
    editor.tf.withNewBatch(()=>editor.tf.setNodes({[property]:checked?[...new Set([...ids,id])]:ids.filter(value=>value!==id)},{at}));
  };
  const choices=(kind:'affiliation'|'note',candidates:MetadataEntry[],selected:string[])=>{
    const property=kind==='affiliation'?'affiliationIds':'noteIds';
    const available=new Set(candidates.map(entry=>entry.id));
    const extra=selected.filter(id=>!available.has(id));
    return <section className="metadata-association-section">
      <div className="metadata-association-title">{t(kind==='affiliation'?'Affiliations':'Notes')}</div>
      {!candidates.length&&!extra.length&&<p className="metadata-association-empty">{t('No entries yet. Add one from Metadata.')}</p>}
      {[...candidates.map(entry=>({id:entry.id,entry})),...extra.map(id=>({id,entry:undefined}))].map(({id,entry})=>{
        const marker=!entry?'??':kind==='affiliation'?String(index.affiliationNumbers.get(id)??'??'):index.noteNumbers.has(id)?noteMark(id):'—';
        return <label className="metadata-association-option" key={id}>
          <input type="checkbox" data-metadata-target-id={id} data-metadata-association={kind} checked={selected.includes(id)} onChange={event=>toggle(property,id,event.target.checked)} />
          <span className="metadata-association-number">{marker}</span>
          <span>{entry?(plain(entry)||t(kind==='affiliation'?'Empty affiliation':'Empty note')):t('Missing target')+' ('+id+')'}</span>
        </label>;
      })}
    </section>;
  };
  const marker=marks&&<sup className="metadata-entry-markers" contentEditable={false} data-metadata-markers={marks}>{marks}</sup>;
  return <PlateElement {...props} className={'document-metadata-entry metadata-entry-'+node.role+(grouped&&!readOnly?' metadata-entry-grouped':'')} attributes={{...props.attributes,'data-metadata-role':node.role,'data-metadata-entry-id':node.id,'data-metadata-entry-empty':String(empty)}}>
    {!readOnly&&groupStart&&<div className="metadata-entry-group-label" contentEditable={false} data-metadata-group-label={node.role}>{t(metadataRoleLabel[node.role])}</div>}
    {!readOnly&&<div className="metadata-entry-controls" contentEditable={false}>
      {(node.role==='author'||node.role==='affiliation')&&<button type="button" className="metadata-entry-drag-handle" draggable={false} aria-label={t(node.role==='author'?'Drag author':'Drag affiliation')}
        onPointerDown={event=>{
          if(event.button!==0||editor.api.isReadOnly())return;
          event.preventDefault();event.stopPropagation();host?.prepareTextInsertion();pointerCleanup.current?.();
          pointerCleanup.current=startMetadataEntryDrag(editor,event.currentTarget,event.pointerId,event.clientX,event.clientY,node);
        }}
        onDragStart={event=>{event.preventDefault();event.stopPropagation();}}
        onClick={event=>{event.preventDefault();event.stopPropagation();}}><GripVerticalIcon aria-hidden="true" /></button>}
      <DropdownMenu modal={false} onOpenChange={open=>{if(open)remember();}}>
        <DropdownMenuTrigger asChild><button type="button" className="metadata-role-button" aria-label={t('Metadata role')} title={t(metadataRoleLabel[node.role])}>{!grouped&&<span>{t(metadataRoleLabel[node.role])}</span>}<ChevronDownIcon aria-hidden="true" /></button></DropdownMenuTrigger>
        <DropdownMenuContent className="metadata-entry-menu" align="start" onCloseAutoFocus={event=>{event.preventDefault();focus();}}>
          {metadataRoles.map(role=><DropdownMenuItem key={role} disabled={role==='title'&&!!title&&title[0].id!==node.id} data-metadata-set-role={role} onSelect={()=>setRole(role)}>{t(metadataRoleLabel[role])}</DropdownMenuItem>)}
          <DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={remove}>{t('Delete entry')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {(node.role==='title'||node.role==='author')&&<Popover onOpenChange={open=>{if(open)remember();}}>
        <PopoverTrigger asChild><button type="button" className="metadata-links-button" aria-label={t(node.role==='author'?'Author associations':'Title notes')}><LinkIcon aria-hidden="true" /></button></PopoverTrigger>
        <PopoverContent className="metadata-associations" align="start" onCloseAutoFocus={event=>{event.preventDefault();focus();}}>
          {node.role==='author'&&choices('affiliation',affiliations||[],affiliationIds)}
          {choices('note',notes||[],noteIds)}
        </PopoverContent>
      </Popover>}
    </div>}
    <div className="metadata-entry-main">
      {(node.role==='affiliation'||node.role==='note')&&marker}
      <div className="metadata-entry-body" data-metadata-placeholder={readOnly?undefined:t(placeholders[node.role])}>{props.children}</div>
      {(node.role==='title'||node.role==='author')&&marker}
    </div>
  </PlateElement>;
}

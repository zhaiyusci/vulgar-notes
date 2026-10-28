// SPDX-License-Identifier: GPL-3.0-or-later
'use client';

import {useContext,useEffect,useRef,useState} from 'react';
import {PlusIcon} from 'lucide-react';
import {NodeApi,type TElement} from 'platejs';
import type {RangeRef} from 'slate';
import {PlateElement,useEditorSelector,useReadOnly,type PlateElementProps} from 'platejs/react';
import {createMetadataEntry,metadataRoleOrder,type MetadataRole} from '@/document-metadata';
import {HostContext} from '@/plate-math-element';
import {t} from '@/i18n';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,DropdownMenuLabel,DropdownMenuSeparator} from './dropdown-menu';

export const metadataRoles:MetadataRole[]=['title','author','affiliation','note','text'];
export const metadataRoleLabel:Record<MetadataRole,string>={title:'Title',author:'Author',affiliation:'Affiliation',note:'Note',text:'Text'};

/** The title belongs to the whole document, including metadata in another block. */
export function findMetadataTitle(nodes:readonly TElement[]):[TElement,number[]]|undefined {
  for(let block=0;block<nodes.length;block++){
    if(nodes[block].type!=='document_metadata')continue;
    const children=nodes[block].children;
    for(let index=0;index<children.length;index++)
      if(children[index].type==='metadata_entry'&&children[index].role==='title')return [children[index] as TElement,[block,index]];
  }
}

/** The marker belongs to the editor, never to document content. */
export function MetadataElement(props:PlateElementProps){
  const editor=props.editor,host=useContext(HostContext),readOnly=useReadOnly();
  const title=useEditorSelector(current=>findMetadataTitle(current.children),[]);
  const saved=useRef<RangeRef|null>(null),legacy=useRef<number[]|undefined>(undefined);
  useEffect(()=>()=>{saved.current?.unref();saved.current=null;},[]);
  const [canConvert,setCanConvert]=useState(false);
  const remember=()=>{
    host?.prepareTextInsertion();saved.current?.unref();
    saved.current=editor.selection?editor.api.rangeRef(editor.selection):null;
    const path=editor.api.findPath(props.element),point=editor.selection?.anchor;
    const at=path&&point&&point.path[0]===path[0]?[...path,point.path[path.length]]:undefined;
    const child=at?NodeApi.get(editor,at):undefined;
    legacy.current=child&&/^(p|h[1-6]|blockquote|callout|code_block)$/.test(String(child.type))?at:undefined;
    setCanConvert(!!legacy.current);
  };
  const focus=()=>{
    const range=saved.current?.unref();saved.current=null;
    if(range)editor.tf.select(range);editor.tf.focus();
  };
  const add=(role:MetadataRole)=>{
    if(readOnly||editor.api.isReadOnly())return;
    const path=editor.api.findPath(props.element);if(!path)return;
    saved.current?.unref();saved.current=null;
    const existing=role==='title'?findMetadataTitle(editor.children):undefined;
    if(existing){editor.tf.select(editor.api.start(existing[1]));return;}
    editor.tf.withNewBatch(()=>{
      const parent=NodeApi.get(editor,path) as TElement;
      const rank=metadataRoles.indexOf(role);
      let insertionIndex=parent.children.findIndex(child=>metadataRoleOrder(child)>rank);
      if(insertionIndex===-1)insertionIndex=parent.children.length;
      const at=[...path,insertionIndex];
      editor.tf.insertNodes(createMetadataEntry(role),{at});editor.tf.select(editor.api.start(at));
    });
  };
  const convert=(role:MetadataRole)=>{
    if(readOnly||editor.api.isReadOnly()||!legacy.current)return;
    if(role==='title'&&findMetadataTitle(editor.children))return;
    const at=legacy.current;
    // Wrapping the selected paragraph preserves every child, mark and cursor position.
    editor.tf.withNewBatch(()=>editor.tf.wrapNodes({...createMetadataEntry(role),children:[]},{at}));
  };
  return <PlateElement {...props} className="document-metadata">
    {!readOnly&&<div className="document-metadata-marker" contentEditable={false}>
      <span>{t('Metadata')}</span>
      <DropdownMenu modal={false} onOpenChange={open=>{if(open)remember();}}>
        <DropdownMenuTrigger asChild><button type="button" className="metadata-add-button" aria-label={t('Add metadata entry')} title={t('Add metadata entry')}><PlusIcon aria-hidden="true" /></button></DropdownMenuTrigger>
        <DropdownMenuContent className="metadata-entry-menu" align="start" onCloseAutoFocus={event=>{event.preventDefault();focus();}}>
          <DropdownMenuLabel>{t('Add metadata entry')}</DropdownMenuLabel>
          {metadataRoles.map(role=><DropdownMenuItem key={role} data-metadata-add-role={role} onSelect={()=>add(role)}>{t(metadataRoleLabel[role])}</DropdownMenuItem>)}
          <DropdownMenuSeparator /><DropdownMenuLabel>{t('Set current paragraph as')}</DropdownMenuLabel>
          {metadataRoles.map(role=><DropdownMenuItem key={role} disabled={!canConvert||role==='title'&&!!title} data-metadata-convert-role={role} onSelect={()=>convert(role)}>{t(metadataRoleLabel[role])}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>}
    <div className="document-metadata-body metadata-author-flow">{props.children}</div>
  </PlateElement>;
}

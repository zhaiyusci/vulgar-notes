'use client';
import {useState,type MouseEvent} from 'react';
import {NodeApi,type TElement} from 'platejs';
import {PlateElement,useEditorSelector,useReadOnly,type PlateElementProps} from 'platejs/react';
import {deleteColumn,deleteRow,insertTableColumn,insertTableRow} from '@platejs/table';
import {floatBody,floatNumbers,type FloatNode} from '@/document-floats';
import {locale,t} from '@/i18n';
import {LabelMarker} from './label-marker';
import {ContextMenu,ContextMenuTrigger,ContextMenuContent,ContextMenuItem,ContextMenuSeparator,ContextMenuCheckboxItem,ContextMenuLabel} from './context-menu';
export function FloatElement(props:PlateElementProps){
  const node=props.element as FloatNode,editor=props.editor,readOnly=useReadOnly();
  const [cell,setCell]=useState<number[]|undefined>();
  const path=()=>editor.api.findPath(node);
  const set=(attributes:Partial<FloatNode>)=>{const at=path();if(at&&!readOnly)editor.tf.setNodes(attributes,{at});};
  const restoreCell=()=>{if(cell)editor.tf.select(editor.api.start(cell));};
  const tableAction=(action:()=>void)=>{if(readOnly)return;editor.tf.withNewBatch(()=>{restoreCell();action();});editor.tf.focus();};
  const body=<div className="document-float-content">{props.children}</div>;
  const contents=<PlateElement {...props} as="figure" className="document-float" attributes={{...props.attributes,'data-float-kind':node.kind,'data-float-id':node.id,
    onContextMenuCapture:(event:MouseEvent<HTMLElement>)=>{
      const target=(event.target as HTMLElement).closest('[data-slate-node="element"]');
      if(!target){setCell(undefined);return;}
      try{
        const found=editor.api.toSlateNode(target);const at=found?editor.api.findPath(found):undefined;
        const nearest=at?editor.api.above({at,match:n=>n.type==='td'||n.type==='th'}):undefined;
        // The right-clicked cell, rather than an old text selection, owns grid actions.
        setCell(nearest?.[1]||(found?.type==='td'||found?.type==='th'?at:undefined));
      }catch{setCell(undefined);}
    }}}>
    {readOnly?body:<ContextMenuTrigger asChild>{body}</ContextMenuTrigger>}
    {node.texLabel&&<span className="float-label-anchor"><LabelMarker id={node.id} label={node.texLabel} /></span>}
  </PlateElement>;
  if(readOnly)return contents;
  return <ContextMenu>{contents}<ContextMenuContent onCloseAutoFocus={event=>event.preventDefault()}>
    <ContextMenuLabel>{t(node.kind==='figure'?'Figure':'Table')}</ContextMenuLabel>
    {node.kind==='figure'&&<ContextMenuItem onSelect={()=>document.dispatchEvent(new CustomEvent('edit-document-figure',{detail:node.id}))}>{t('Change image')}</ContextMenuItem>}
    <ContextMenuCheckboxItem checked={node.numbered} onCheckedChange={value=>set({numbered:value===true})}>{t('Numbered')}</ContextMenuCheckboxItem>
    <ContextMenuItem onSelect={()=>document.dispatchEvent(new CustomEvent('edit-tex-label',{detail:node.id}))}>{t('Set label')}</ContextMenuItem>
    {node.kind==='table'&&<><ContextMenuSeparator />
      <ContextMenuItem disabled={!cell} onSelect={()=>tableAction(()=>insertTableRow(editor,{before:true}))}>{t('Insert row above')}</ContextMenuItem>
      <ContextMenuItem disabled={!cell} onSelect={()=>tableAction(()=>insertTableRow(editor))}>{t('Insert row below')}</ContextMenuItem>
      <ContextMenuItem disabled={!cell} onSelect={()=>tableAction(()=>insertTableColumn(editor,{before:true}))}>{t('Insert column before')}</ContextMenuItem>
      <ContextMenuItem disabled={!cell} onSelect={()=>tableAction(()=>insertTableColumn(editor))}>{t('Insert column after')}</ContextMenuItem>
      <ContextMenuItem disabled={!cell||floatBody(node).children.length<2} onSelect={()=>tableAction(()=>deleteRow(editor))}>{t('Delete row')}</ContextMenuItem>
      <ContextMenuItem disabled={!cell||(floatBody(node).children[0] as TElement)?.children.length<2} onSelect={()=>tableAction(()=>deleteColumn(editor))}>{t('Delete column')}</ContextMenuItem>
    </>}
  </ContextMenuContent></ContextMenu>;
}
export function FloatCaptionElement(props:PlateElementProps){
  const details=useEditorSelector(editor=>{
    const at=editor.api.findPath(props.element);if(!at||at.length<2)return undefined;
    const node=NodeApi.get(editor,at.slice(0,-1));if(node?.type!=='float')return undefined;
    return floatNumbers(editor.children).get(String(node.id));
  },[props.element]);
  const empty=NodeApi.string(props.element)==='';
  return <PlateElement {...props} as="figcaption" className="document-float-caption" attributes={{...props.attributes,'data-caption-empty':String(empty),'data-caption-placeholder':t('Write a caption…')}}>
    {details?.number&&<span contentEditable={false} className="document-float-number">{locale==='zh-CN'?t(details.kind==='figure'?'Figure':'Table')+details.number+'　':t(details.kind==='figure'?'Figure':'Table')+' '+details.number+'. '}</span>}{props.children}
  </PlateElement>;
}

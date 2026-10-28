'use client';
import {useContext,useEffect,useRef,useState} from 'react';
import {NodeApi} from 'platejs';
import {ImagePlusIcon,Table2Icon} from 'lucide-react';
import {useEditorRef} from 'platejs/react';
import type {Range} from 'slate';
import {HostContext} from '@/plate-math-element';
import {createFigure,createTableFloat,floatBody,floatCaption,validFloatImageUrl,type FloatNode} from '@/document-floats';
import {t} from '@/i18n';
import {ToolbarButton} from './toolbar';
import {Button} from './button';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './dialog';

/** Low-frequency structure insertion is explicit and never intercepts ordinary typing. */
export function InsertFloatToolbarButton(){
  const editor=useEditorRef(),host=useContext(HostContext),selection=useRef<Range|null>(null);
  const editing=useRef<string|undefined>(undefined),imageRequest=useRef(0);
  const [open,setOpen]=useState(false),[url,setUrl]=useState(''),[alt,setAlt]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const remember=()=>{host?.prepareTextInsertion();selection.current=editor.selection?structuredClone(editor.selection):null;};
  useEffect(()=>{
    const edit=(event:Event)=>{
      if(editor.api.isReadOnly())return;
      const id=(event as CustomEvent).detail;
      const found=[...NodeApi.nodes(editor)].find(([node])=>node.type==='float'&&node.kind==='figure'&&node.id===id);
      if(!found)return;
      const image=floatBody(found[0] as FloatNode);remember();editing.current=String(id);imageRequest.current++;
      setUrl(String(image.url));setAlt(String(image.alt||''));setError('');setLoading(false);setOpen(true);
    };
    document.addEventListener('edit-document-figure',edit);
    return ()=>{document.removeEventListener('edit-document-figure',edit);imageRequest.current++;};
  },[editor,host]);
  const insert=(node:FloatNode)=>{
    if(editor.api.isReadOnly())return;
    editor.tf.withNewBatch(()=>{
      if(selection.current)editor.tf.select(selection.current);
      // A figure/table is a document block, even when insertion starts in a table cell.
      const index=editor.selection?editor.selection.anchor.path[0]+1:editor.children.length;
      editor.tf.insertNodes(node,{at:[index]});
      editor.tf.select(editor.api.start(node.kind==='table'?[index,node.children.indexOf(floatBody(node)),0,0]:[index,node.children.indexOf(floatCaption(node))]));
    });
    setOpen(false);requestAnimationFrame(()=>editor.tf.focus());
  };
  const imageFile=async(file:File|undefined)=>{
    if(!file)return;
    if(!['image/png','image/jpeg'].includes(file.type)){setError(t('Choose a PNG or JPEG image.'));return;}
    const request=++imageRequest.current;
    setLoading(true);setError('');
    try{
      const result=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error(t('The image could not be read.')));reader.readAsDataURL(file);});
      if(request===imageRequest.current){setUrl(result);setAlt(file.name);}
    }catch{if(request===imageRequest.current)setError(t('The image could not be read.'));}finally{if(request===imageRequest.current)setLoading(false);}
  };
  const submit=()=>{
    if(!validFloatImageUrl(url.trim())){setError(t('Use an HTTP(S) image URL or a PNG/JPEG image.'));return;}
    try{
      if(editing.current){
        const found=[...NodeApi.nodes(editor)].find(([node])=>node.type==='float'&&node.kind==='figure'&&node.id===editing.current);
        if(!found){setError(t('This figure is no longer available.'));return;}
        const target=found[0] as FloatNode;
        editor.tf.withNewBatch(()=>editor.tf.setNodes({url:url.trim(),alt},{at:[...found[1],target.children.indexOf(floatBody(target))]}));
        setOpen(false);return;
      }
      insert(createFigure(url.trim(),alt));
    }catch(cause){setError(cause instanceof Error?t(cause.message):t('The image could not be read.'));}
  };
  return <>
    <ToolbarButton tooltip={t('Insert figure')} onPointerDown={event=>event.preventDefault()} onClick={()=>{if(editor.api.isReadOnly())return;remember();editing.current=undefined;imageRequest.current++;setUrl('');setAlt('');setError('');setLoading(false);setOpen(true);}}><ImagePlusIcon /></ToolbarButton>
    <ToolbarButton tooltip={t('Insert table with caption')} onPointerDown={event=>event.preventDefault()} onClick={()=>{if(editor.api.isReadOnly())return;remember();insert(createTableFloat());}}><Table2Icon /></ToolbarButton>
    <Dialog open={open} onOpenChange={value=>{if(!value)imageRequest.current++;setOpen(value);}}><DialogContent onCloseAutoFocus={event=>event.preventDefault()}>
      <DialogTitle>{t(editing.current?'Change image':'Insert figure')}</DialogTitle>
      <DialogDescription>{t('Choose a local image to keep it with the document, or enter an image URL.')}</DialogDescription>
      <label>{t('Local image')}<input className="mt-1 block w-full rounded border p-2 text-sm" type="file" accept="image/png,image/jpeg" disabled={loading} onChange={event=>void imageFile(event.target.files?.[0])} /></label>
      <label>{t('Image URL')}<input className="mt-1 block w-full rounded border p-2" type="url" value={url.startsWith('data:')?'':url} placeholder={url.startsWith('data:')?t('Local image selected'):'https://…'} onChange={event=>setUrl(event.target.value)} /></label>
      <label>{t('Alternative text')}<input className="mt-1 block w-full rounded border p-2" value={alt} onChange={event=>setAlt(event.target.value)} /></label>
      {error&&<p role="alert" className="text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>{imageRequest.current++;setOpen(false);}}>{t('Cancel')}</Button><Button disabled={loading||!url.trim()} onClick={submit}>{t(editing.current?'Apply':'Insert')}</Button></div>
    </DialogContent></Dialog>
  </>;
}

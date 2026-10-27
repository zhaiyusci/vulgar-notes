'use client';

import * as React from 'react';
import {FilePlusIcon, FolderOpenIcon, SaveIcon, CopyIcon} from 'lucide-react';
import {toast} from 'sonner';
import {HostContext} from '@/plate-math-element';
import {parseDocumentFile} from '@/plate-document';
import {openDocumentFile, saveDocumentFile, confirmReplaceDocument, defaultDocumentName, newDocumentWindow, documentSessionId} from '@/platform';
import {t} from '@/i18n';
import {ToolbarButton} from './toolbar';

export function DocumentFileToolbarButtons() {
  const host = React.useContext(HostContext);
  const sessionId = documentSessionId();
  const metadataKey = 'editor.open-document' + (sessionId ? ':' + sessionId : '');
  const currentFile = React.useRef<{path?:string; name:string}>({name:defaultDocumentName});
  React.useEffect(()=>{
    try {
      const saved=sessionStorage.getItem(metadataKey);
      if(saved){const file=JSON.parse(saved);if(file.baseline)parseDocumentFile(file.baseline);currentFile.current={name:file.name,path:file.path};if(file.baseline)host?.markDocumentSaved(file.baseline);}
    }catch{/* Start with an untitled document if session metadata is invalid. */}
  },[host,metadataKey]);
  const busy = React.useRef(false);
  const [working,setWorking] = React.useState(false);
  const remember = (baseline:string) => {
    try {sessionStorage.setItem(metadataKey,JSON.stringify({...currentFile.current,baseline}));}
    catch {/* Saving the actual file must not fail because session metadata is full. */}
  };
  const run = React.useCallback(async (action:'new'|'open'|'save'|'saveAs') => {
    if (!host || busy.current) return;
    busy.current=true;setWorking(true);
    try {
      if (action==='new') {
        host.persist();
        await newDocumentWindow();
      } else if (action==='open') {
        if(host.hasUnsavedChanges() && !await confirmReplaceDocument())return;
        const file=await openDocumentFile();
        if(!file)return;
        parseDocumentFile(file.text);
        host.openDocument(file.text);
        currentFile.current={name:file.name,path:file.path};
        remember(host.serializeDocument());
      } else {
        const source=host.serializeDocument();
        const file=await saveDocumentFile(source,action==='save'?currentFile.current.path:undefined,currentFile.current.name);
        if(file){currentFile.current=file;host.markDocumentSaved(source);remember(source);toast.success(t('Document saved'));}
      }
    }catch(error){toast.error(t(action==='new'?'Unable to create document':action==='open'?'Unable to open document':'Unable to save document'),{description:String(error)});}
    finally{busy.current=false;setWorking(false);}
  },[host,metadataKey]);
  React.useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(!(event.ctrlKey||event.metaKey)||event.altKey||document.querySelector('dialog[open]'))return;
      const key=event.key.toLowerCase();
      if(key!=='s'&&key!=='o'&&(key!=='n'||event.shiftKey))return;
      event.preventDefault();event.stopPropagation();
      if(key==='n'&&event.repeat)return;
      void run(key==='n'?'new':key==='o'?'open':event.shiftKey?'saveAs':'save');
    };
    document.addEventListener('keydown',onKey,true);
    return ()=>document.removeEventListener('keydown',onKey,true);
  },[run]);
  return <>
    <ToolbarButton tooltip="New document" aria-label={t('New document')} disabled={working} onClick={()=>void run('new')}><FilePlusIcon className="size-4" /></ToolbarButton>
    <ToolbarButton tooltip="Open document" aria-label={t('Open document')} disabled={working} onClick={()=>void run('open')}><FolderOpenIcon className="size-4" /></ToolbarButton>
    <ToolbarButton tooltip="Save document" aria-label={t('Save document')} disabled={working} onClick={()=>void run('save')}><SaveIcon className="size-4" /></ToolbarButton>
    <ToolbarButton tooltip="Save document as" aria-label={t('Save document as')} disabled={working} onClick={()=>void run('saveAs')}><CopyIcon className="size-4" /></ToolbarButton>
  </>;
}

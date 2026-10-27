import {useContext,useMemo,useRef,useState} from 'react';
import {LibraryBigIcon,PlusIcon,RefreshCwIcon,Trash2Icon} from 'lucide-react';
import {useEditorRef} from 'platejs/react';
import type {Range} from 'slate';
import {HostContext} from '@/plate-math-element';
import {bibLibraryWarnings,parseBibLibraries,type BibEntry,type BibLibrary} from '@/bibtex';
import {useBibliographyLibraries,useBibliographyStyle} from '@/use-bibliography';
import {openBibliographySource,refreshBibliographySource,rememberBibliographySource,forgetBibliographySource} from '@/bibliography-source';
import {bibliographyStyles,isBibliographyStyle} from '@/bibliography-style';
import {formatBibliography} from '@/bibliography-format';
import {BibliographyText} from './bibliography-text';
import {CSLAttribution} from './csl-attribution';
import {t} from '@/i18n';
import {ToolbarButton} from './toolbar';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from './dialog';
import {Button} from './button';

export function BibtexLibrariesButton({compact=false,onChooseKey}:{compact?:boolean;onChooseKey?:(key:string)=>void}){
  const editor=useEditorRef(),host=useContext(HostContext),libraries=useBibliographyLibraries(),style=useBibliographyStyle();
  const entries=useMemo(()=>parseBibLibraries(libraries),[libraries]);
  const warnings=useMemo(()=>libraries.flatMap(library=>bibLibraryWarnings(library).map(message=>({libraryId:library.id,libraryName:library.name,message}))),[libraries]);
  const [open,setOpen]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState('');
  const [selectedId,setSelectedId]=useState(''),[query,setQuery]=useState(''),[removeId,setRemoveId]=useState('');
  const [status,setStatus]=useState('');
  const selection=useRef<Range|null>(null),busy=useRef(false);
  const start=()=>{
    host?.prepareTextInsertion();selection.current=editor.selection?structuredClone(editor.selection):null;
    setError('');setStatus('');setRemoveId('');setOpen(true);
  };
  const read=async(refresh?:BibLibrary)=>{
    if(!host||busy.current)return;
    busy.current=true;setWorking(true);setError('');setStatus('');
    try{
      const file=refresh?await refreshBibliographySource(host.getBibliographySourceId(refresh.id),refresh.name):await openBibliographySource();if(!file)return;
      const current=host.getBibliographyLibraries();
      if(refresh&&!current.some(library=>library.id===refresh.id))throw Error(t('This library is no longer available.'));
      if(!refresh&&current.some(library=>library.name===file.name))throw Error(t('A library with this filename already exists. Refresh that library to update it.'));
      const library:BibLibrary={id:refresh?.id??crypto.randomUUID(),name:refresh?.name??file.name,source:file.text};
      const next=refresh?current.map(item=>item.id===refresh.id?library:item):[...current,library];
      host.setBibliographyLibraries(next,[library.id]);
      const registered=await rememberBibliographySource(host.getBibliographySourceId(library.id),file);
      if(!refresh){setSelectedId(library.id);setQuery('');}setRemoveId('');
      setStatus(t(refresh?'Library refreshed.':'Library added.')+(!registered.persisted?' '+t('The source link could not be saved. You may need to select the original file again after reopening.'):''));
    }catch(err){setError(err instanceof Error?err.message:String(err));}
    finally{busy.current=false;setWorking(false);}
  };
  const remove=async()=>{
    if(!host||!removeId)return;
    try{
      const sourceId=host.getBibliographySourceId(removeId);
      host.setBibliographyLibraries(host.getBibliographyLibraries().filter(library=>library.id!==removeId));
      await forgetBibliographySource(sourceId);if(sourceId!==removeId)await forgetBibliographySource(removeId);
      if(selectedId===removeId)setSelectedId('');setRemoveId('');setError('');
    }catch(err){setError(err instanceof Error?err.message:String(err));}
  };
  const choose=(entry:BibEntry)=>{
    try{
      if(onChooseKey)onChooseKey(entry.key);
      else{
        editor.tf.withNewBatch(()=>{
          if(selection.current)editor.tf.select(selection.current);
          editor.tf.insertNodes({type:'tex_reference',id:crypto.randomUUID(),command:'cite',keys:[entry.key],children:[{text:''}]},{select:true});
          editor.tf.move({distance:1,unit:'offset'});
        });
        host?.persist();
      }
      setOpen(false);if(!onChooseKey)editor.tf.focus();
    }catch(err){setError(err instanceof Error?err.message:String(err));}
  };
  const search=query.trim().toLocaleLowerCase();
  const filtered=entries.filter(entry=>(!selectedId||entry.libraryId===selectedId)&&(!search||[entry.key,entry.title,entry.author,entry.year].join(' ').toLocaleLowerCase().includes(search)));
  const previewEntry=filtered[0];
  const preview=useMemo(()=>previewEntry?formatBibliography([previewEntry],style).get(previewEntry.key):undefined,[previewEntry,style]);
  const selected=libraries.find(library=>library.id===selectedId);
  const notices=warnings.filter(warning=>!selectedId||warning.libraryId===selectedId);
  return <>
    {compact?<Button type="button" variant="outline" size="sm" onClick={start}><LibraryBigIcon className="mr-1 size-4" />{t('BibTeX libraries')}</Button>
      :<ToolbarButton tooltip={t('BibTeX libraries')} aria-label={t('BibTeX libraries')} onPointerDown={event=>event.preventDefault()} onClick={start}><LibraryBigIcon /></ToolbarButton>}
    <Dialog open={open} onOpenChange={value=>{if(!busy.current)setOpen(value);}}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl" onCloseAutoFocus={event=>event.preventDefault()}>
        <DialogTitle>{t('BibTeX libraries')}</DialogTitle>
        <DialogDescription>{t('Full libraries are kept on this device. Only cited entries and their required dependencies are saved with this document.')}</DialogDescription>
        {libraries.some(library=>host?.isCapturedBibliographyLibrary(library.id))&&<p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">{t('This document contains only its cited entries. Load the original .bib file to browse the full library.')}</p>}
        {!!host?.getBibliographyNotices().length&&<div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">{host.getBibliographyNotices().map((notice,index)=><p key={index}>{notice}</p>)}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={working||!host} onClick={()=>void read()}><PlusIcon className="mr-1 size-4" />{t('Add .bib library')}</Button>
          <span className="text-sm text-muted-foreground">{t('Libraries')}: {libraries.length} · {t('Entries')}: {entries.length}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <label className="flex items-center gap-2 text-sm">{t('Reference list format')}
            <select className="rounded border bg-background px-2 py-1" aria-label={t('Reference list format')} value={style} disabled={working||!host}
              onChange={event=>{const value=event.target.value;if(isBibliographyStyle(value))try{host?.setBibliographyStyle(value);setError('');}catch(err){setError(err instanceof Error?err.message:String(err));}}}>
              {bibliographyStyles.map(item=><option key={item.id} value={item.id}>{t(item.label)}</option>)}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">{t('Formats the reference list. Inline citations and endnotes keep their shared numbering.')}</p>
        </div>
        {preview&&<div className="rounded border bg-muted/30 p-3 text-sm leading-relaxed" aria-label={t('Format preview')}>
          <div className="mb-1 text-xs text-muted-foreground">{t('Format preview')} · {previewEntry.key}</div>
          <BibliographyText description={preview.text} runs={preview.runs} />
          {style!=='simple'&&<CSLAttribution />}
        </div>}
        <div className="grid min-h-64 gap-4 sm:grid-cols-[minmax(150px,1fr)_minmax(0,2fr)]">
          <div className="max-h-96 overflow-auto rounded border p-1">
            <button type="button" className={'mb-1 w-full rounded px-2 py-2 text-left text-sm '+(!selectedId?'bg-muted':'hover:bg-muted')} onClick={()=>setSelectedId('')}>{t('All libraries')}</button>
            {libraries.map(library=><div key={library.id} className={'mb-1 rounded border '+(selectedId===library.id?'bg-muted':'')}>
              <button type="button" className="w-full break-all px-2 pt-2 text-left text-sm" onClick={()=>{setSelectedId(library.id);setRemoveId('');}}>{library.name}</button>
              {host?.isCapturedBibliographyLibrary(library.id)&&<div className="px-2 text-xs text-muted-foreground">{t('Document references only')} <button type="button" className="text-blue-700 underline" disabled={working} onClick={()=>void read(library)}>{t('Load full library')}</button></div>}
              <div className="flex items-center justify-between gap-1 px-2 pb-1">
                <span className="text-xs text-muted-foreground">{entries.filter(entry=>entry.libraryId===library.id).length} {t('Entries')}</span>
                <span className="flex">
                  <button type="button" className="rounded p-1 hover:bg-background disabled:opacity-50" title={t('Refresh library')} aria-label={t('Refresh library')+': '+library.name} disabled={working} onClick={()=>void read(library)}><RefreshCwIcon className="size-4" /></button>
                  <button type="button" className="rounded p-1 hover:bg-background disabled:opacity-50" title={t('Remove library')} aria-label={t('Remove library')+': '+library.name} disabled={working} onClick={()=>setRemoveId(library.id)}><Trash2Icon className="size-4" /></button>
                </span>
              </div>
            </div>)}
            {!libraries.length&&<p className="px-2 py-4 text-sm text-muted-foreground">{t('No BibTeX libraries yet.')}</p>}
          </div>
          <div className="min-w-0">
            <input type="search" className="mb-2 w-full rounded border px-3 py-2 text-sm" aria-label={t('Search bibliography')} placeholder={t('Search by author, title or citation key')} value={query} onChange={event=>setQuery(event.target.value)} />
            <div className="max-h-80 overflow-auto rounded border" aria-label={t('Library entries')}>
              {filtered.slice(0,100).map(entry=><div key={entry.libraryId+':'+entry.key} className="border-b p-3 last:border-0">
                <div className="flex items-start justify-between gap-2"><code className="break-all text-xs">{entry.key}</code><Button type="button" size="sm" variant="outline" disabled={working} onClick={()=>choose(entry)}>{t('Insert citation')}</Button></div>
                <p className="break-words text-sm font-medium">{entry.title||entry.key}</p>
                <p className="break-words text-xs text-muted-foreground">{entry.author}{entry.year?' · '+entry.year:''}</p>
                {!selectedId&&<p className="mt-1 text-xs text-muted-foreground">{entry.libraryName}</p>}
              </div>)}
              {!filtered.length&&<p className="p-4 text-sm text-muted-foreground">{t('No matching bibliography entries.')}</p>}
            </div>
            {filtered.length>100&&<p className="mt-1 text-xs text-muted-foreground">{t('Showing the first 100 matches. Refine your search to find an entry.')}</p>}
          </div>
        </div>
        {!!notices.length&&<details className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
          <summary className="cursor-pointer">{t('BibTeX warnings')} ({notices.length})</summary>
          <p className="mt-2">{t('Undefined BibTeX strings are shown by name.')}</p>
          <ul className="mt-2 max-h-32 list-inside list-disc overflow-auto break-words text-xs">{notices.map((notice,index)=>{
            const missing=notice.message.match(/^unresolved @string reference (.*)$/);
            return <li key={notice.libraryId+':'+index}>{!selectedId&&notice.libraryName+': '}{missing?t('Undefined BibTeX string:')+' '+missing[1]:notice.message}</li>;
          })}</ul>
        </details>}
        {selected&&<details><summary className="cursor-pointer text-sm">{t('View BibTeX source')}</summary><textarea className="mt-2 max-h-40 w-full rounded border p-2 font-mono text-xs" rows={5} readOnly value={selected.source} aria-label={t('BibTeX source')} /></details>}
        {removeId&&<div className="rounded border p-3 text-sm">
          <p>{t('Remove library')}: <strong>{libraries.find(library=>library.id===removeId)?.name}</strong>?</p>
          <p className="mt-1 text-muted-foreground">{t('Existing citations will be kept and marked unresolved. You can add the .bib file again to restore them.')}</p>
          <div className="mt-2 flex justify-end gap-2"><Button type="button" variant="outline" size="sm" onClick={()=>setRemoveId('')}>{t('Cancel')}</Button><Button type="button" variant="destructive" size="sm" onClick={()=>void remove()}>{t('Remove library')}</Button></div>
        </div>}
        {error&&<p role="alert" className="whitespace-pre-wrap break-words text-sm text-red-600">{error}</p>}
        {status&&<p role="status" className="text-sm text-muted-foreground">{status}</p>}
        <div className="flex justify-end"><Button type="button" variant="outline" disabled={working} onClick={()=>setOpen(false)}>{t('Close')}</Button></div>
      </DialogContent>
    </Dialog>
  </>;
}

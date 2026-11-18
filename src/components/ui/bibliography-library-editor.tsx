import {useEffect,useRef,useState} from 'react';
import type {BibLibrary} from '@/bibtex';
import {createBibliographyEditorController,type BibliographyEditorAccess,type BibliographyEditorController} from '@/bibliography-editor-controller';
import type {BibliographyStore} from '@/generated/bib-library';
import {Button} from './button';
import {locale,t} from '@/i18n';

/** Reusable library editor: the parent supplies document capabilities explicitly. */
export function BibliographyLibraryEditor({library,access,onClose,onStore,readOnly=false}:{library:BibLibrary;access:BibliographyEditorAccess;onClose:()=>void;onStore?:(store:BibliographyStore)=>void;readOnly?:boolean}){
  const container=useRef<HTMLDivElement>(null);
  const storeRef=useRef<BibliographyStore|null>(null),controllerRef=useRef<BibliographyEditorController|null>(null),base=useRef(library);
  const callbacks=useRef({onStore,access,readOnly});callbacks.current={onStore,access,readOnly};
  const [count,setCount]=useState(0),[ready,setReady]=useState(false),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const [pending,setPending]=useState<readonly string[]|null>(null);

  useEffect(()=>{
    let cancelled=false,unsubscribe:(()=>void)|undefined,element:(HTMLElement&{dispose?:()=>void})|undefined;
    base.current={...library};setReady(false);setError('');setPending(null);setCount(0);
    void (async()=>{
      try{
        // Load the optional editor only when it is opened, not during prose editing.
        const {BibliographyStore,MemoryBackend,toBibtex}=await import('@/generated/bib-library');
        if(cancelled)return;
        const controller=createBibliographyEditorController(base.current,{
          isReadOnly:()=>callbacks.current.readOnly||callbacks.current.access.isReadOnly(),
          getLibraries:()=>callbacks.current.access.getLibraries(),
          getCitedKeys:()=>callbacks.current.access.getCitedKeys(),
          commitLibraries:next=>callbacks.current.access.commitLibraries(next),
        },toBibtex);
        const store=new BibliographyStore({backend:new MemoryBackend()});
        await store.ready();if(cancelled)return;
        const imported=await store.importItems(controller.initialItems);
        if(imported.errors.length)throw Error(imported.errors.join('\n'));
        if(cancelled)return;
        const widget=document.createElement('bib-library') as HTMLElement&{connect(store:BibliographyStore):Promise<void>;dispose?:()=>void};
        widget.style.display='block';widget.style.height='100%';widget.setAttribute('lang',locale);
        // Connecting before insertion avoids the component's automatic IndexedDB backend.
        await widget.connect(store);element=widget;
        if(cancelled){widget.dispose?.();widget.remove();return;}
        container.current?.replaceChildren(widget);
        storeRef.current=store;controllerRef.current=controller;
        unsubscribe=store.subscribe(()=>{controller.changed();setCount(store.size);setPending(null);setError('');});
        setCount(store.size);setReady(true);callbacks.current.onStore?.(store);
      }catch(err){
        if(!cancelled){setError(t(err instanceof Error?err.message:'Could not load this library.'));setReady(false);}
      }
    })();
    return ()=>{cancelled=true;unsubscribe?.();element?.dispose?.();element?.remove();storeRef.current=null;controllerRef.current=null;};
    // A remote source refresh must not discard this draft. Saving compares the original source.
  },[library.id]);

  const save=()=>{
    const store=storeRef.current,controller=controllerRef.current;
    if(!ready||saving||!store||!controller)return;
    setError('');
    try{
      setSaving(true);
      const result=controller.save(store.items());
      if(result.status==='confirmation-required'){setPending(result.keys);return;}
      onClose();
    }catch(err){setError(t(err instanceof Error?err.message:'Could not load this library.'));}
    finally{setSaving(false);}
  };

  return <div className="flex h-[78dvh] min-h-0 flex-col gap-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground">{library.name} · {count} {t('Entries')}</p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onClose}>{t('Cancel')}</Button>
        <Button type="button" onClick={save} disabled={saving||!ready||readOnly}>{pending?t('Save anyway'):saving?t('Saving…'):t('Save library')}</Button>
      </div>
    </div>
    {pending&&<div role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">
      {t('These citations will no longer resolve:')} <span className="break-all font-mono text-xs">{pending.join(', ')}</span>
      <span className="ml-1">{t('Save again to keep this library.')}</span>
    </div>}
    {!!error&&<p role="alert" className="whitespace-pre-wrap text-sm text-red-600">{error}</p>}
    {readOnly&&<p role="status" className="text-sm text-muted-foreground">{t('This document is read-only.')}</p>}
    {!ready&&!error&&<p role="status" className="text-sm text-muted-foreground">{t('Loading library…')}</p>}
    <p className="text-xs text-muted-foreground">{t('Changes are saved with this document. Unchanged BibTeX fields and comments are preserved.')}</p>
    <div ref={container} inert={readOnly} className="min-h-0 flex-1 overflow-hidden rounded border"/>
  </div>;
}

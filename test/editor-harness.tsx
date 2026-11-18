import React from 'react';
import {createRoot,type Root} from 'react-dom/client';
import type {MockHost} from './mock-host';
import {BibliographyLibraryEditor} from '@/components/ui/bibliography-library-editor';
import type {BibLibrary} from '@/bibtex';
let root:Root|null=null;
const attachStore=(host:MockHost)=>(store:unknown)=>{host.store=store;};

export function mount(container:HTMLElement,host:MockHost,library:BibLibrary,getCitedKeys?:()=>string[],readOnly=false):void{
  root=createRoot(container);
  root.render(<BibliographyLibraryEditor library={library} access={{
    isReadOnly:()=>readOnly||!!host.readOnly,
    getLibraries:()=>host.getBibliographyLibraries(),
    getCitedKeys:()=>getCitedKeys?.()??[],
    commitLibraries:next=>host.setBibliographyLibraries(next),
  }} onClose={()=>{host.closed=true;}} onStore={attachStore(host)} readOnly={readOnly}/>);
}
export function unmount():void{root?.unmount();root=null;}
export {flushSync} from 'react-dom';
export {missingCitations} from '@/bibliography-editor-controller';
export {createLibraryEditSession} from '@/bibliography-library-edit';
export {citedReferenceKeys} from '@/references';

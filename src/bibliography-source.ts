import {isTauri} from '@tauri-apps/api/core';
import type {OpenedDocument} from './platform';
import {t} from './i18n';

/** Source links are device-local and never become part of a portable library. */
export const BIBLIOGRAPHY_SOURCE_KEY='vulgar-notes-bibliography-sources-v1';
const HANDLE_DATABASE='vulgar-notes-bibliography-file-handles';
const HANDLE_STORE='handles';

interface BibliographyFileHandle {
  kind:'file';
  name:string;
  getFile():Promise<File>;
  queryPermission?:(options:{mode:'read'})=>Promise<PermissionState>;
  requestPermission?:(options:{mode:'read'})=>Promise<PermissionState>;
}
type SourceMetadata={id:string;name:string;kind:'desktop';path:string}|{id:string;name:string;kind:'browser';hasHandle:boolean};
type SourceOrigin={kind:'desktop';name:string;path:string}|{kind:'browser';name:string;handle?:BibliographyFileHandle};
type PickerWindow=Window&{showOpenFilePicker?:(options:{id:string;multiple:false;excludeAcceptAllOption:true;types:{description:string;accept:Record<string,string[]>}[]})=>Promise<BibliographyFileHandle[]>};

export type OpenedBibliographySource=OpenedDocument;
export interface BibliographySourceRegistration {persisted:boolean}
const pendingOrigins=new WeakMap<OpenedBibliographySource,SourceOrigin>();
const memorySources=new Map<string,SourceMetadata>();
const memoryHandles=new Map<string,BibliographyFileHandle>();

function checkName(name:string,expectedName?:string):void {
  if(!/\.bib$/i.test(name))throw Error(t('Please choose a BibTeX library (.bib).'));
  if(expectedName&&name!==expectedName)throw Error(t('Please select the original .bib file:')+' '+expectedName);
}
function samePath(path:string,expected:string):boolean {
  // Native Windows dialogs can normalize drive-letter case and separators.
  const normalize=(value:string)=>/^(?:[a-z]:[\\/]|\\\\)/i.test(value)?value.replace(/\//g,'\\').toLowerCase():value;
  return normalize(path)===normalize(expected);
}
function opened(origin:SourceOrigin,text:string):OpenedBibliographySource {
  const file:OpenedBibliographySource={name:origin.name,text,...(origin.kind==='desktop'?{path:origin.path}:{})};
  pendingOrigins.set(file,origin);return file;
}
function sourceStorage():Storage {return window.localStorage;}
function readMetadata():SourceMetadata[] {
  const raw=sourceStorage().getItem(BIBLIOGRAPHY_SOURCE_KEY);if(raw===null)return [];
  const value=JSON.parse(raw);
  if(value?.version!==1||!Array.isArray(value.sources))throw Error('Invalid local bibliography source registry');
  return value.sources.filter((item:unknown):item is SourceMetadata=>{
    if(!item||typeof item!=='object')return false;
    const source=item as Record<string,unknown>;
    return typeof source.id==='string'&&!!source.id&&typeof source.name==='string'&&/\.bib$/i.test(source.name)&&
      (source.kind==='browser'&&typeof source.hasHandle==='boolean'||source.kind==='desktop'&&typeof source.path==='string'&&!!source.path&&/\.bib$/i.test(source.path));
  });
}
function findSource(id:string):SourceMetadata|undefined {
  if(memorySources.has(id))return memorySources.get(id);
  try{return readMetadata().find(source=>source.id===id);}catch{return undefined;}
}
function writeMetadata(id:string,source?:SourceMetadata):boolean {
  try{
    const sources=readMetadata().filter(item=>item.id!==id);if(source)sources.push(source);
    sourceStorage().setItem(BIBLIOGRAPHY_SOURCE_KEY,JSON.stringify({version:1,sources}));return true;
  }catch{return false;}
}

/** File-system handles support structured cloning into IndexedDB, unlike JSON. */
function handleStore(action:'get'|'put'|'delete',id:string,handle?:BibliographyFileHandle):Promise<BibliographyFileHandle|undefined> {
  return new Promise((resolve,reject)=>{
    const factory=window.indexedDB;if(!factory){reject(Error('File handle storage is unavailable.'));return;}
    const request=factory.open(HANDLE_DATABASE,1);
    let finished=false;
    const fail=(error:unknown)=>{if(!finished){finished=true;reject(error);}};
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(HANDLE_STORE))request.result.createObjectStore(HANDLE_STORE);};
    request.onerror=()=>fail(request.error??Error('Could not open file handle storage.'));
    request.onblocked=()=>fail(Error('File handle storage is blocked.'));
    request.onsuccess=()=>{
      const database=request.result;if(finished){database.close();return;}
      try{
        const transaction=database.transaction(HANDLE_STORE,action==='get'?'readonly':'readwrite');
        const store=transaction.objectStore(HANDLE_STORE);
        const operation=action==='get'?store.get(id):action==='put'?store.put(handle,id):store.delete(id);
        transaction.oncomplete=()=>{database.close();if(!finished){finished=true;resolve(action==='get'?operation.result:undefined);}};
        transaction.onerror=transaction.onabort=()=>{database.close();fail(transaction.error??Error('Could not save file handle.'));};
      }catch(error){database.close();fail(error);}
    };
  });
}

async function browserPicker(expectedName?:string):Promise<OpenedBibliographySource|null> {
  const pickerWindow=window as PickerWindow;
  if(pickerWindow.showOpenFilePicker){
    try{
      // Invoke before the first await so opening retains the user's gesture.
      const [handle]=await pickerWindow.showOpenFilePicker({id:'bibliography',multiple:false,excludeAcceptAllOption:true,types:[{description:t('BibTeX library'),accept:{'application/x-bibtex':['.bib']}}]});
      if(!handle)return null;
      return readHandle(handle,expectedName);
    }catch(error){
      const name=(error as {name?:string})?.name;
      if(name==='AbortError')return null;
      // Embedded browsers can expose the API but forbid its picker. A normal
      // file input remains available without granting broader file access.
      if(name!=='SecurityError'&&name!=='NotSupportedError')throw error;
    }
  }
  return new Promise((resolve,reject)=>{
    const input=document.createElement('input');input.type='file';input.accept='.bib,application/x-bibtex,text/x-bibtex';input.hidden=true;
    document.body.append(input);
    input.addEventListener('cancel',()=>{input.remove();resolve(null);},{once:true});
    input.addEventListener('change',async()=>{
      const file=input.files?.[0];input.remove();if(!file){resolve(null);return;}
      try{checkName(file.name,expectedName);resolve(opened({kind:'browser',name:file.name},await file.text()));}catch(error){reject(error);}
    },{once:true});
    input.click();
  });
}
async function readHandle(handle:BibliographyFileHandle,expectedName?:string):Promise<OpenedBibliographySource> {
  const file=await handle.getFile();checkName(file.name,expectedName);
  return opened({kind:'browser',name:file.name,handle},await file.text());
}
async function desktopPicker(expectedName?:string,expectedPath?:string):Promise<OpenedBibliographySource|null> {
  const [{open},{readTextFile}]=await Promise.all([import('@tauri-apps/plugin-dialog'),import('@tauri-apps/plugin-fs')]);
  const path=await open({multiple:false,directory:false,defaultPath:expectedPath,filters:[{name:t('BibTeX library'),extensions:['bib']}]});
  if(!path)return null;
  if(expectedPath&&!samePath(path,expectedPath))throw Error(t('Please select the original .bib file:')+' '+expectedPath);
  const name=path.split(/[\\/]/).pop()!;checkName(name,expectedName);
  return opened({kind:'desktop',name,path},await readTextFile(path));
}

/** Select a new source. Remember its link only after the library validates. */
export async function openBibliographySource():Promise<OpenedBibliographySource|null> {
  return isTauri()?desktopPicker():browserPicker();
}

/** Retain local access separately from the library's portable name/source. */
export async function rememberBibliographySource(id:string,file:OpenedBibliographySource):Promise<BibliographySourceRegistration> {
  const origin=pendingOrigins.get(file);if(!origin)return {persisted:false};
  const source:SourceMetadata=origin.kind==='desktop'?{id,kind:'desktop',name:origin.name,path:origin.path}:{id,kind:'browser',name:origin.name,hasHandle:!!origin.handle};
  memorySources.set(id,source);
  let handlePersisted=true;
  if(origin.kind==='browser'&&origin.handle){
    memoryHandles.set(id,origin.handle);
    try{await handleStore('put',id,origin.handle);}catch{handlePersisted=false;}
  }else{
    memoryHandles.delete(id);
    // A reselected plain File must not retain a previous, unrelated handle.
    try{await handleStore('delete',id);}catch{/* Metadata still supports a same-name selection. */}
  }
  return {persisted:writeMetadata(id,source)&&handlePersisted};
}

/** Read fresh bytes from the original source; cancellation never changes it. */
export async function refreshBibliographySource(id:string,expectedName:string):Promise<OpenedBibliographySource|null> {
  checkName(expectedName);
  const source=findSource(id);
  if(isTauri()){
    if(source?.kind==='desktop'){
      checkName(source.name,expectedName);
      try{
        const {readTextFile}=await import('@tauri-apps/plugin-fs');
        return opened({kind:'desktop',name:source.name,path:source.path},await readTextFile(source.path));
      }catch{
        // Older app versions did not persist dialog grants. Reauthorization
        // accepts the same path only; it cannot replace the library's source.
        return desktopPicker(expectedName,source.path);
      }
    }
    return desktopPicker(expectedName);
  }
  let handle=memoryHandles.get(id);
  if(!handle&&source?.kind==='browser'&&source.hasHandle){try{handle=await handleStore('get',id);}catch{/* A fresh same-name selection is the portable browser fallback. */}}
  if(handle&&handle.kind==='file'&&typeof handle.getFile==='function'){
    const permission=await handle.queryPermission?.({mode:'read'});
    if(permission&&permission!=='granted'){
      if(!handle.requestPermission||await handle.requestPermission({mode:'read'})!=='granted')return null;
    }
    return readHandle(handle,expectedName);
  }
  // File objects are immutable snapshots: rereading an old File would silently
  // reuse stale bytes. Ask for a fresh selection with the original filename.
  return browserPicker(expectedName);
}

export async function forgetBibliographySource(id:string):Promise<void> {
  memorySources.delete(id);memoryHandles.delete(id);writeMetadata(id);
  try{await handleStore('delete',id);}catch{/* Removing a library must not fail because browser storage is unavailable. */}
}

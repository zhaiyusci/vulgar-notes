import {isTauri} from '@tauri-apps/api/core';
import {t} from './i18n';
import {
  documentFileHandle,documentFromHandle,documentTargetFromHandle,openDocumentFile,sameDocumentPath,
  type DocumentFile,type DocumentFileHandle,type OpenedDocument,
} from './platform';

/** Device-local file links; portable .vulgar documents never contain this data. */
export const RECENT_DOCUMENTS_KEY='vulgar-notes-recent-documents-v1';
const HANDLE_DATABASE='vulgar-notes-document-file-handles';
const HANDLE_STORE='handles';
const MAX_RECENT_DOCUMENTS=30;
export interface RecentDocument {
  id:string;name:string;kind:'desktop'|'browser';lastOpened:number;path?:string;hasHandle?:boolean;
}
const memoryHandles=new Map<string,DocumentFileHandle>();
const fileIds=new WeakMap<DocumentFile,string>();
const memoryEntries=new Map<string,RecentDocument>();
const removedEntries=new Set<string>();

function storedEntries():RecentDocument[] {
  try{
    const raw=window.localStorage.getItem(RECENT_DOCUMENTS_KEY);if(!raw)return [];
    const parsed=JSON.parse(raw);if(parsed?.version!==1||!Array.isArray(parsed.documents))return [];
    return parsed.documents.filter((entry:unknown):entry is RecentDocument=>{
      if(!entry||typeof entry!=='object')return false;
      const value=entry as Record<string,unknown>;
      return typeof value.id==='string'&&!!value.id&&typeof value.name==='string'&&/\.(vulgar|json)$/i.test(value.name)&&
        typeof value.lastOpened==='number'&&Number.isFinite(value.lastOpened)&&
        (value.kind==='desktop'&&typeof value.path==='string'&&/\.(vulgar|json)$/i.test(value.path)||value.kind==='browser'&&typeof value.hasHandle==='boolean');
    });
  }catch{return [];}
}
export function listRecentDocuments():RecentDocument[] {
  const merged=new Map(storedEntries().map(entry=>[entry.id,entry]));
  for(const [id,entry]of memoryEntries)merged.set(id,entry);
  for(const id of removedEntries)merged.delete(id);
  return [...merged.values()].sort((a,b)=>b.lastOpened-a.lastOpened).slice(0,MAX_RECENT_DOCUMENTS).map(entry=>({...entry}));
}
function persistEntries(entries:RecentDocument[]):void {
  try{
    window.localStorage.setItem(RECENT_DOCUMENTS_KEY,JSON.stringify({version:1,documents:entries}));
    memoryEntries.clear();removedEntries.clear();
  }catch{/* A blocked storage area must not make successful Open/Save fail. */}
}
function handleStore(action:'get'|'put'|'delete',id:string,handle?:DocumentFileHandle):Promise<DocumentFileHandle|undefined> {
  return new Promise((resolve,reject)=>{
    const factory=window.indexedDB;if(!factory){reject(Error('File handle storage is unavailable.'));return;}
    const request=factory.open(HANDLE_DATABASE,1);let finished=false;
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
async function storedHandle(entry:RecentDocument):Promise<DocumentFileHandle|undefined> {
  let handle=memoryHandles.get(entry.id);
  if(!handle&&entry.kind==='browser'&&entry.hasHandle){try{handle=await handleStore('get',entry.id);}catch{/* A new file selection remains possible. */}}
  if(handle?.kind==='file'&&typeof handle.getFile==='function'){memoryHandles.set(entry.id,handle);return handle;}
  return undefined;
}

/** Call after document validation or a successful save, retaining its object. */
export async function rememberRecentDocument(file:DocumentFile):Promise<RecentDocument> {
  if(!/\.(vulgar|json)$/i.test(file.name))throw Error(t('Please choose a Vulgar Notes document (.vulgar or legacy .json).'));
  const entries=listRecentDocuments(),handle=documentFileHandle(file);
  let previous=entries.find(entry=>entry.id===fileIds.get(file));
  if(!previous&&file.path)previous=entries.find(entry=>entry.kind==='desktop'&&!!entry.path&&sameDocumentPath(file.path!,entry.path));
  if(!previous&&handle){
    for(const entry of entries.filter(entry=>entry.kind==='browser'&&entry.hasHandle)){
      const other=await storedHandle(entry);if(!other)continue;
      try{if(handle===other||await handle.isSameEntry?.(other)){previous=entry;break;}}catch{/* Unavailable old grants do not identify a different file. */}
    }
  }
  const entry:RecentDocument={id:previous?.id??crypto.randomUUID(),name:file.name,lastOpened:Date.now(),
    ...(file.path?{kind:'desktop' as const,path:file.path}:{kind:'browser' as const,hasHandle:!!handle})};
  fileIds.set(file,entry.id);removedEntries.delete(entry.id);memoryEntries.set(entry.id,entry);
  if(handle){
    memoryHandles.set(entry.id,handle);try{await handleStore('put',entry.id,handle);}catch{/* Memory access survives for this session. */}
  }else if(previous?.hasHandle){
    memoryHandles.delete(entry.id);try{await handleStore('delete',entry.id);}catch{/* Metadata no longer advertises the handle. */}
  }
  persistEntries(listRecentDocuments());return {...entry};
}

/** Restore a Save target without reading bytes or requesting any permission. */
export async function getRecentDocumentTarget(id:string):Promise<DocumentFile|null> {
  const entry=listRecentDocuments().find(item=>item.id===id);if(!entry)return null;
  const handle=entry.kind==='browser'?await storedHandle(entry):undefined;
  const file=handle?documentTargetFromHandle(handle):{name:entry.name,...(entry.kind==='desktop'?{path:entry.path}:{})};
  fileIds.set(file,id);return file;
}

/** Every open reads the current file, never an old File or stored JSON snapshot. */
export async function openRecentDocument(id:string):Promise<OpenedDocument|null> {
  const entry=listRecentDocuments().find(item=>item.id===id);if(!entry)return null;
  let file:OpenedDocument|null;
  if(isTauri()&&entry.kind==='desktop'&&entry.path){
    try{
      const {readTextFile}=await import('@tauri-apps/plugin-fs');
      file={name:entry.name,path:entry.path,text:await readTextFile(entry.path)};
    }catch{file=await openDocumentFile({name:entry.name,path:entry.path});}
  }else if(!isTauri()){
    const handle=await storedHandle(entry);
    if(handle){
      const permission=await handle.queryPermission?.({mode:'read'});
      if(permission&&permission!=='granted'&&(!handle.requestPermission||await handle.requestPermission({mode:'read'})!=='granted'))return null;
      file=await documentFromHandle(handle,entry.name);
    }else file=await openDocumentFile({name:entry.name});
  }else file=await openDocumentFile({name:entry.name});
  if(file)fileIds.set(file,id);return file;
}

/** Remove only the local recent-file link; never touch the user's file. */
export async function removeRecentDocument(id:string):Promise<void> {
  memoryEntries.delete(id);memoryHandles.delete(id);removedEntries.add(id);persistEntries(listRecentDocuments());
  try{await handleStore('delete',id);}catch{/* Recent-list removal does not depend on IndexedDB. */}
}

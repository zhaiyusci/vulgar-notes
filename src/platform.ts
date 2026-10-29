import {invoke,isTauri} from '@tauri-apps/api/core';
import {t} from './i18n';
import {recordRuntimeEvent} from './runtime-diagnostics';
import {getDocumentDraftStorage} from './document-draft-store';
export {initializeDocumentDraftStore,flushDocumentDraftStore,refreshDocumentDraftStore} from './document-draft-store';

export interface DocumentFile {name: string; path?: string}
export interface OpenedDocument extends DocumentFile {text: string}

/** Browser handles stay out of the document's serializable data. */
export interface DocumentFileHandle {
  kind:'file';
  name:string;
  getFile():Promise<File>;
  createWritable?():Promise<{write(data:string):Promise<void>;close():Promise<void>;abort?():Promise<void>}>;
  queryPermission?:(options:{mode:'read'|'readwrite'})=>Promise<PermissionState>;
  requestPermission?:(options:{mode:'read'|'readwrite'})=>Promise<PermissionState>;
  isSameEntry?:(other:DocumentFileHandle)=>Promise<boolean>;
}
type DocumentPickerWindow=Window&{
  showOpenFilePicker?:(options:{id:string;multiple:false;excludeAcceptAllOption:true;types:{description:string;accept:Record<string,string[]>}[]})=>Promise<DocumentFileHandle[]>;
  showSaveFilePicker?:(options:{id:string;suggestedName:string;excludeAcceptAllOption:true;types:{description:string;accept:Record<string,string[]>}[]})=>Promise<DocumentFileHandle>;
};
const documentHandles=new WeakMap<DocumentFile,DocumentFileHandle>();
export function documentFileHandle(file:DocumentFile):DocumentFileHandle|undefined {return documentHandles.get(file);}
export function documentTargetFromHandle(handle:DocumentFileHandle):DocumentFile {
  const file:DocumentFile={name:handle.name};documentHandles.set(file,handle);return file;
}
export function sameDocumentPath(path:string,expected:string):boolean {
  const normalize=(value:string)=>/^(?:[a-z]:[\\/]|\\\\)/i.test(value)?value.replace(/\//g,'\\').toLowerCase():value;
  return normalize(path)===normalize(expected);
}

function checkDocumentName(name:string,expectedName?:string):void {
  if(!documentFilePattern.test(name))throw Error(t('Please choose a Vulgar Notes document (.vulgar or legacy .json).'));
  if(expectedName&&name!==expectedName)throw Error(t('Please select the original document:')+' '+expectedName);
}
export async function documentFromHandle(handle:DocumentFileHandle,expectedName?:string):Promise<OpenedDocument> {
  const file=await handle.getFile();checkDocumentName(file.name,expectedName);
  const result:OpenedDocument={name:file.name,text:await file.text()};documentHandles.set(result,handle);return result;
}

export const defaultDocumentName = 'document.vulgar';
const documentFilePattern = /\.(vulgar|json)$/i;
const documentName = (name: string): string => name.replace(documentFilePattern, '') + '.vulgar';
const documentSessionPattern = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

/** Only an explicit, valid session URL gets a separate document draft. */
export function documentSessionId(): string|null {
  if (typeof window === 'undefined') return null;
  try {
    const ids = new URL(window.location.href).searchParams.getAll('document');
    return ids.length === 1 && documentSessionPattern.test(ids[0]) ? ids[0].toLowerCase() : null;
  } catch {return null;}
}

/** Keep the current document in place and create a separate blank editor. */
export async function newDocumentWindow(): Promise<void> {
  const id = crypto.randomUUID();
  const url = new URL(window.location.href);
  url.searchParams.set('document', id);
  url.hash = '';
  if (!isTauri()) {
    // This must precede any await so the browser still sees the user's gesture.
    // With noopener, even a successfully opened tab can return null.
    window.open(url.href, '_blank', 'noopener');
    return;
  }
  const {WebviewWindow} = await import('@tauri-apps/api/webviewWindow');
  const appPath = './' + (url.pathname.replace(/^\/+/, '') || 'index.html') + url.search;
  const created = new WebviewWindow(`document-${id}`, {
    url: appPath, title: 'Vulgar Notes', width: 1400, height: 900,
    minWidth: 800, minHeight: 540, dragDropEnabled: false,
  });
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const unlisteners: Array<() => void> = [];
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      for (const unlisten of unlisteners) unlisten();
      if (error !== undefined) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve();
    };
    const remember = (unlisten: () => void) => settled ? unlisten() : unlisteners.push(unlisten);
    void created.once('tauri://created', () => finish()).then(remember, finish);
    void created.once('tauri://error', event => finish(event.payload ?? 'Could not create a new document window.')).then(remember, finish);
  });
}

async function openTextFile(extensions:string[],filterName:string,accept:string,errorMessage:string):Promise<OpenedDocument|null>{
  const supported=(name:string)=>extensions.some(extension=>name.toLowerCase().endsWith('.'+extension));
  if (isTauri()) {
    const [{open}, {readTextFile}] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')]);
    const path = await open({multiple:false, directory:false, filters:[{name:t(filterName),extensions}]});
    if (!path) return null;
    if (!supported(path)) throw Error(t(errorMessage));
    return {path, name:path.split(/[\\/]/).pop()!, text:await readTextFile(path)};
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.hidden = true;
    document.body.append(input);
    input.addEventListener('cancel', () => {input.remove(); resolve(null);}, {once:true});
    input.addEventListener('change', async () => {
      const file = input.files?.[0]; input.remove();
      if (!file) {resolve(null); return;}
      try {
        if (!supported(file.name)) throw Error(t(errorMessage));
        resolve({name:file.name, text:await file.text()});
      } catch (error) {reject(error);}
    }, {once:true});
    input.click();
  });
}

export async function openDocumentFile(expected?:DocumentFile):Promise<OpenedDocument|null>{
  if(isTauri()){
    await recordRuntimeEvent('document-picker-start');
    const [{open},{readTextFile}]=await Promise.all([import('@tauri-apps/plugin-dialog'),import('@tauri-apps/plugin-fs')]);
    const path=await open({multiple:false,directory:false,...(expected?.path?{defaultPath:expected.path}:{}),filters:[{name:t('Vulgar Notes document'),extensions:['vulgar','json']}]});
    await recordRuntimeEvent('document-picker-complete');
    if(!path)return null;
    if(expected?.path&&!sameDocumentPath(path,expected.path))throw Error(t('Please select the original document:')+' '+expected.path);
    const name=path.split(/[\\/]/).pop()!;checkDocumentName(name,expected?.path?undefined:expected?.name);
    await recordRuntimeEvent('document-read-start');
    const text=await readTextFile(path);await recordRuntimeEvent('document-read-complete');
    return {path,name,text};
  }
  const pickerWindow=window as DocumentPickerWindow;
  if(pickerWindow.showOpenFilePicker){
    let handle:DocumentFileHandle|undefined;
    try{
      [handle]=await pickerWindow.showOpenFilePicker({id:'vulgar-document',multiple:false,excludeAcceptAllOption:true,types:[{description:t('Vulgar Notes document'),accept:{'application/json':['.vulgar','.json']}}]});
      if(!handle)return null;
    }catch(error){
      const name=(error as {name?:string})?.name;
      if(name==='AbortError')return null;
      if(name!=='SecurityError'&&name!=='NotSupportedError')throw error;
    }
    if(handle)return documentFromHandle(handle,expected?.name);
  }
  const file=await openTextFile(['vulgar','json'],'Vulgar Notes document','.vulgar,.json,application/json','Please choose a Vulgar Notes document (.vulgar or legacy .json).');
  if(file)checkDocumentName(file.name,expected?.name);return file;
}

/** The native host binds a one-time OS-open request to this window, never a URL path. */
export async function takeSystemDocumentFile():Promise<OpenedDocument|null> {
  if(!isTauri())return null;
  const file=await invoke<OpenedDocument|null>('take_system_document');
  if(file==null)return null;
  if(typeof file.name!=='string'||typeof file.path!=='string'||typeof file.text!=='string')
    throw Error(t('The system-open request is invalid.'));
  checkDocumentName(file.name);
  return file;
}

/** Adding a bibliography source is separate from opening a native document. */
export async function openBibtexFile():Promise<OpenedDocument|null>{
  return openTextFile(['bib'],'BibTeX library','.bib,application/x-bibtex,text/x-bibtex','Please choose a BibTeX library (.bib).');
}

export async function confirmReplaceDocument(): Promise<boolean> {
  const message = t('This document has unsaved changes. Open another document without saving?');
  if (isTauri()) {
    const {confirm} = await import('@tauri-apps/plugin-dialog');
    return confirm(message, {title:t('Unsaved changes'), kind:'warning'});
  }
  return window.confirm(message);
}

/** Pass the opened/saved object to reuse a browser handle. Null means cancelled. */
export async function saveDocumentFile(text: string, target?: string|DocumentFile, name = typeof target==='object'?target.name:defaultDocumentName): Promise<DocumentFile | null> {
  const suggestedName = documentName(name);
  if (isTauri()) {
    const currentPath=typeof target==='string'?target:target?.path;
    const [{save}, {writeFile}] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')]);
    const path = currentPath ?? await save({defaultPath:suggestedName, filters:[{name:t('Vulgar Notes document'),extensions:['vulgar']}]});
    if (!path) return null;
    if (!(currentPath ? documentFilePattern : /\.vulgar$/i).test(path)) throw Error(t('Please use the .vulgar extension.'));
    await writeFile(path, new TextEncoder().encode(text));
    return {path, name:path.split(/[\\/]/).pop()!};
  }
  const oldHandle=typeof target==='object'?documentHandles.get(target):undefined;
  const pickerWindow=window as DocumentPickerWindow;
  let handle=oldHandle;
  if(!handle&&pickerWindow.showSaveFilePicker){
    try{
      handle=await pickerWindow.showSaveFilePicker({id:'vulgar-document',suggestedName,excludeAcceptAllOption:true,types:[{description:t('Vulgar Notes document'),accept:{'application/json':['.vulgar']}}]});
      if(!handle)return null;
    }catch(error){
      const name=(error as {name?:string})?.name;
      if(name==='AbortError')return null;
      // When an embedded browser forbids the picker, retain download support.
      if(name!=='SecurityError'&&name!=='NotSupportedError')throw error;
    }
  }
  if(handle){
    if(oldHandle){
      const permission=await handle.queryPermission?.({mode:'readwrite'});
      if(permission&&permission!=='granted'&&(!handle.requestPermission||await handle.requestPermission({mode:'readwrite'})!=='granted'))return null;
    }
    if(!(oldHandle?documentFilePattern:/\.vulgar$/i).test(handle.name))throw Error(t('Please use the .vulgar extension.'));
    if(!handle.createWritable)throw Error(t('This browser cannot save changes to the selected file.'));
    const stream=await handle.createWritable();
    try{await stream.write(text);await stream.close();}catch(error){try{await stream.abort?.();}catch{/* Keep the original write failure. */}throw error;}
    const saved:DocumentFile={name:handle.name};documentHandles.set(saved,handle);return saved;
  }
  await saveExport(new Blob([text], {type:'application/json;charset=utf-8'}), suggestedName);
  if(typeof target==='object'&&target.name===suggestedName)return target;
  return {name:suggestedName};
}

/** Recovery belongs to a document UUID, including after its tab/window closes. */
export function draftStorage(): Storage {
  return getDocumentDraftStorage();
}

export async function saveExport(blob: Blob, filename: string): Promise<void> {
  if (isTauri()) {
    const [{save}, {writeFile}] = await Promise.all([
      import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs'),
    ]);
    const extension = filename.split('.').pop()!;
    const path = await save({defaultPath: filename, filters: [{name: extension.toUpperCase(), extensions: [extension]}]});
    if (path) await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

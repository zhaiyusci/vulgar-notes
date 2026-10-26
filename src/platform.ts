import {isTauri} from '@tauri-apps/api/core';
import {t} from './i18n';

export interface OpenedDocument {text: string; name: string; path?: string}

export const defaultDocumentName = 'document.vulgar';
const documentFilePattern = /\.(vulgar|json)$/i;
const documentName = (name: string): string => name.replace(documentFilePattern, '') + '.vulgar';

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

export async function openDocumentFile():Promise<OpenedDocument|null>{
  return openTextFile(['vulgar','json'],'Vulgar Notes document','.vulgar,.json,application/json','Please choose a Vulgar Notes document (.vulgar or legacy .json).');
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

/** Null means cancelled; a browser download has no reusable filesystem path. */
export async function saveDocumentFile(text: string, currentPath?: string, name = defaultDocumentName): Promise<{path?:string; name:string} | null> {
  const suggestedName = documentName(name);
  if (isTauri()) {
    const [{save}, {writeFile}] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')]);
    const path = currentPath ?? await save({defaultPath:suggestedName, filters:[{name:t('Vulgar Notes document'),extensions:['vulgar']}]});
    if (!path) return null;
    if (!(currentPath ? documentFilePattern : /\.vulgar$/i).test(path)) throw Error(t('Please use the .vulgar extension.'));
    await writeFile(path, new TextEncoder().encode(text));
    return {path, name:path.split(/[\\/]/).pop()!};
  }
  await saveExport(new Blob([text], {type:'application/json;charset=utf-8'}), suggestedName);
  return {name:suggestedName};
}

/** Browser tabs remain independent; the desktop window restores its last draft. */
export function draftStorage(): Storage {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? localStorage : sessionStorage;
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

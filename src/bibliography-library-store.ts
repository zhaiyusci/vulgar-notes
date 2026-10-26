import {citedBibLibraries,parseBibLibrary,parseBibLibraries,validateBibLibraries,type BibLibrary} from './bibtex';

/** Full local sources are deliberately separate from cited-only document data. */
export const CACHE_KEY='vulgar-notes-bibliography-library-catalog-v1';
type ReadStorage=Pick<Storage,'getItem'>;
type WriteStorage=Pick<Storage,'setItem'>&Partial<ReadStorage>;
export interface LibraryCacheReadResult {libraries:BibLibrary[];error?:string}
export interface LibraryAttachmentConflict {
  libraryId:string;
  name:string;
  keys:string[];
  reason:'source-mismatch'|'duplicate-key';
}
export interface LibraryAttachmentResult {
  libraries:BibLibrary[];
  fullLibraryIds:string[];
  cacheLibraryIds:Record<string,string>;
  capturedOnlyIds:string[];
  conflicts:LibraryAttachmentConflict[];
}

function localCacheStorage():Storage {
  // Use the owning window in browser tests/iframes as well as Tauri. Browser
  // drafts use sessionStorage, but attached full libraries survive refresh.
  if(typeof window!=='undefined')return window.localStorage;
  if(typeof localStorage!=='undefined')return localStorage;
  throw Error('Local bibliography storage is unavailable.');
}

function parseCache(source:string):BibLibrary[] {
  const saved=JSON.parse(source);
  if(saved?.version!==1||!Array.isArray(saved.libraries))throw Error('Invalid bibliography library cache');
  return validateBibLibraries(saved.libraries);
}

/** Invalid or inaccessible caches stay untouched so they can be recovered. */
export function readLibraryCache(storage?:ReadStorage):LibraryCacheReadResult {
  try{
    const source=(storage??localCacheStorage()).getItem(CACHE_KEY);
    if(source===null)return {libraries:[]};
    return {libraries:parseCache(source)};
  }catch(error){
    return {libraries:[],error:error instanceof Error?error.message:String(error)};
  }
}

/** Call only for explicit full-library changes, never with a native snapshot. */
export function writeLibraryCache(libraries:readonly BibLibrary[],storage?:WriteStorage):void {
  const checked=validateBibLibraries(libraries);
  const source=JSON.stringify({version:1,libraries:checked});
  const target=storage??localCacheStorage();
  if(target.getItem){
    const prior=target.getItem(CACHE_KEY);
    if(prior!==null){
      let corrupt=false;try{parseCache(prior);}catch{corrupt=true;}
      if(corrupt&&target.getItem(CACHE_KEY+'-recovery')===null)target.setItem(CACHE_KEY+'-recovery',prior);
    }
  }
  // Validate and serialize before the single atomic localStorage write. A
  // parser/quota/security failure cannot replace the previous good catalog.
  target.setItem(CACHE_KEY,source);
}

function sameCapturedSource(captured:BibLibrary,full:BibLibrary,keys:readonly string[]):boolean {
  if(captured.source===full.source)return true;
  if(!keys.length)return !captured.source.trim();
  const available=new Set(parseBibLibrary(full).map(entry=>entry.key));
  if(keys.some(key=>!available.has(key)))return false;
  // The document capture retains raw records and required declarations. This
  // comparison also detects changed macro/preamble context, not just equal
  // citation keys or filenames. It never rewrites a captured version.
  return citedBibLibraries([full],keys)[0]?.source===captured.source;
}

/**
 * Restore a global local catalog alongside portable document captures.
 * Captures remain authoritative on conflicts. A matching full source is used
 * only when the saved copy is exactly its original source or cited subset.
 * A skipped full source remains in the caller's catalog for explicit recovery;
 * callers must not save this merged attachment view back as the full catalog.
 */
export function restoreLibraryAttachments(capturedLibraries:readonly BibLibrary[],cachedLibraries:readonly BibLibrary[],reservedCitationKeys:readonly string[]=[]):LibraryAttachmentResult {
  const captured=validateBibLibraries(capturedLibraries),cached=validateBibLibraries(cachedLibraries);
  const capturedKeys=new Map(captured.map(library=>[library.id,parseBibLibrary(library).map(entry=>entry.key)]));
  const capturedOwners=new Map(captured.flatMap(library=>capturedKeys.get(library.id)!.map(key=>[key,library.id] as const)));
  const fullLibraryIds:string[]=[],capturedOnlyIds:string[]=[],conflicts:LibraryAttachmentConflict[]=[],used=new Set<string>();
  const cacheLibraryIds:Record<string,string>=Object.create(null),reserved=new Set(reservedCitationKeys);
  const libraries:BibLibrary[]=[];
  for(const copy of captured){
    const keys=capturedKeys.get(copy.id)!;
    let full=cached.find(library=>library.id===copy.id);
    if(!full&&keys.length){
      // A portable document can carry a different attachment id. The name is
      // only a hint: exact source/subset identity is still mandatory.
      full=cached.find(library=>!used.has(library.id)&&library.name===copy.name&&sameCapturedSource(copy,library,keys));
    }
    if(!full){libraries.push(copy);capturedOnlyIds.push(copy.id);continue;}
    used.add(full.id);
    cacheLibraryIds[copy.id]=full.id;
    if(!sameCapturedSource(copy,full,keys)){
      libraries.push(copy);capturedOnlyIds.push(copy.id);
      conflicts.push({libraryId:copy.id,name:copy.name,keys:[...keys],reason:'source-mismatch'});continue;
    }
    const ownKeys=new Set(keys);
    const duplicateKeys=parseBibLibrary(full).map(entry=>entry.key).filter(key=>capturedOwners.has(key)&&capturedOwners.get(key)!==copy.id||reserved.has(key)&&!ownKeys.has(key));
    if(duplicateKeys.length){
      libraries.push(copy);capturedOnlyIds.push(copy.id);
      conflicts.push({libraryId:copy.id,name:copy.name,keys:duplicateKeys,reason:'duplicate-key'});continue;
    }
    libraries.push({...full,id:copy.id,name:copy.name});fullLibraryIds.push(copy.id);
  }
  const activeKeys=new Set([...reserved,...parseBibLibraries(libraries).map(entry=>entry.key)]);
  for(const full of cached){
    if(used.has(full.id))continue;
    const keys=parseBibLibrary(full).map(entry=>entry.key),duplicates=keys.filter(key=>activeKeys.has(key));
    if(duplicates.length||libraries.some(library=>library.id===full.id)){
      conflicts.push({libraryId:full.id,name:full.name,keys:duplicates,reason:duplicates.length?'duplicate-key':'source-mismatch'});continue;
    }
    libraries.push(full);fullLibraryIds.push(full.id);cacheLibraryIds[full.id]=full.id;keys.forEach(key=>activeKeys.add(key));
  }
  // Check the final attachment set too; no merge path may hide a duplicate.
  parseBibLibraries(libraries);
  return {libraries,fullLibraryIds,cacheLibraryIds,capturedOnlyIds,conflicts};
}

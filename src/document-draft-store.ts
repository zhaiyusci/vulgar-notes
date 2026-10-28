/** Large document drafts belong in IndexedDB, not the small preference store. */
const DATABASE_NAME='vulgar-notes-document-drafts';
const ENTRY_STORE='entries';
export const DOCUMENT_DRAFT_STORAGE_ERROR='vulgar-draft-storage-error';
export const DOCUMENT_DRAFT_STORAGE_RESTORED='vulgar-draft-storage-restored';

type Entry={value:string|null};
type Mutation=Entry&{revision:number};
const cache=new Map<string,string>();
const pending=new Map<string,Mutation>();
const producers=new Set<()=>void>();
let database:IDBDatabase|null=null;
let initialized=false;
let initialization:Promise<void>|null=null;
let writing:Promise<void>|null=null;
let scheduled:number|null=null;
let revision=0;
let storageFailed=false;
// A fixed window coalesces typing without postponing recovery indefinitely when
// the user keeps typing. Explicit save/navigation barriers bypass this delay.
const WRITE_DELAY_MS=350;

function storageError(error:unknown):void {
  storageFailed=true;
  window.dispatchEvent(new CustomEvent(DOCUMENT_DRAFT_STORAGE_ERROR,{detail:{error}}));
}
function storageRestored():void {
  if(!storageFailed)return;
  storageFailed=false;
  window.dispatchEvent(new CustomEvent(DOCUMENT_DRAFT_STORAGE_RESTORED));
}
function failure(transaction:IDBTransaction):Error|DOMException {
  return transaction.error??Error('Could not save document drafts.');
}
function openDatabase():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const factory=window.indexedDB;
    if(!factory){reject(Error('Document draft storage is unavailable.'));return;}
    let finished=false;
    const request=factory.open(DATABASE_NAME,1);
    const fail=(error:unknown)=>{if(!finished){finished=true;reject(error);}};
    request.onupgradeneeded=()=>{
      if(!request.result.objectStoreNames.contains(ENTRY_STORE))request.result.createObjectStore(ENTRY_STORE);
    };
    request.onblocked=()=>fail(Error('Document draft storage is blocked by another window.'));
    request.onerror=()=>fail(request.error??Error('Could not open document draft storage.'));
    request.onsuccess=()=>{
      const result=request.result;
      if(finished){result.close();return;}
      finished=true;
      result.onversionchange=()=>{
        result.close();
        if(database===result)database=null;
      };
      resolve(result);
    };
  });
}
function readEntries(db:IDBDatabase):Promise<Map<string,string>> {
  return new Promise((resolve,reject)=>{
    const entries=new Map<string,string>();
    const transaction=db.transaction(ENTRY_STORE,'readonly');
    transaction.oncomplete=()=>resolve(entries);
    transaction.onabort=transaction.onerror=()=>reject(failure(transaction));
    const request=transaction.objectStore(ENTRY_STORE).openCursor();
    request.onsuccess=()=>{
      const cursor=request.result;if(!cursor)return;
      if(typeof cursor.key==='string'){
        const raw:unknown=cursor.value;
        // Accept early string records too; tombstones prevent reimporting deleted
        // legacy drafts while leaving the user's original localStorage intact.
        const value=typeof raw==='string'?raw:raw&&typeof raw==='object'?(raw as Entry).value:null;
        if(typeof value==='string')entries.set(cursor.key,value);
      }
      cursor.continue();
    };
  });
}
function legacyEntries():Map<string,string> {
  const entries=new Map<string,string>();
  try{
    const storage=window.localStorage;
    for(let index=0;index<storage.length;index++){
      const key=storage.key(index);
      if(key&&!['math-plate-document-v1','editor.open-document:','math-tiptap-document-v1',
        'math-text-flow-state','vulgar-notes-legacy-recovery:'].some(prefix=>key.startsWith(prefix)))continue;
      if(key){const value=storage.getItem(key);if(value!==null)entries.set(key,value);}
    }
  }catch{/* IndexedDB can remain usable when preference storage is unavailable. */}
  return entries;
}
function importLegacyEntries(db:IDBDatabase,entries:Map<string,string>):Promise<void> {
  if(!entries.size)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(ENTRY_STORE,'readwrite');
    transaction.oncomplete=()=>resolve();
    transaction.onabort=transaction.onerror=()=>reject(failure(transaction));
    const store=transaction.objectStore(ENTRY_STORE);
    const fail=(error:unknown)=>{try{transaction.abort();}catch{/* Already aborted. */}reject(error);};
    for(const [key,value]of entries){
      try{
        const request=store.get(key);
        // Test inside the same write transaction so a second window cannot import
        // stale localStorage over a value which another window has just committed.
        request.onsuccess=()=>{
          try{if(request.result===undefined)store.put({value} satisfies Entry,key);}catch(error){fail(error);}
        };
      }catch(error){fail(error);return;}
    }
  });
}

/** Hydrate before mounting the editor. Failed initialization leaves the old
 * synchronous localStorage API in place and can be retried explicitly. */
export function initializeDocumentDraftStore():Promise<void> {
  if(initialized)return Promise.resolve();
  if(initialization)return initialization;
  initialization=(async()=>{
    const opened=await openDatabase();
    try{
      await importLegacyEntries(opened,legacyEntries());
      const entries=await readEntries(opened);
      cache.clear();for(const [key,value]of entries)cache.set(key,value);
      database=opened;initialized=true;storageRestored();
      if(typeof window.addEventListener==='function')window.addEventListener('pagehide',flushBeforeBackground);
      if(typeof document!=='undefined'&&typeof document.addEventListener==='function')
        document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushBeforeBackground();});
    }catch(error){opened.close();throw error;}
  })();
  initialization.then(()=>{initialization=null;},error=>{initialization=null;storageError(error);});
  return initialization;
}

function commit(db:IDBDatabase,mutations:Map<string,Mutation>):Promise<void> {
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(ENTRY_STORE,'readwrite');
    transaction.oncomplete=()=>resolve();
    transaction.onabort=transaction.onerror=()=>reject(failure(transaction));
    const store=transaction.objectStore(ENTRY_STORE);
    try{
      for(const [key,{value}]of mutations)store.put({value} satisfies Entry,key);
    }catch(error){
      // A synchronous DataClone/transaction failure must never commit a partial
      // document/baseline pair. Keep every mutation queued for an explicit retry.
      try{transaction.abort();}catch{/* It may already have aborted. */}
      reject(error);
    }
  });
}
function drain():Promise<void> {
  if(writing)return writing;
  if(!pending.size){storageRestored();return Promise.resolve();}
  writing=(async()=>{
    try{
      while(pending.size){
        if(!database)throw Error('Document draft storage is closed. Please reopen the app.');
        const mutations=new Map(pending);
        await commit(database,mutations);
        for(const [key,mutation]of mutations){
          if(pending.get(key)?.revision===mutation.revision)pending.delete(key);
        }
      }
      storageRestored();
    }catch(error){storageError(error);throw error;}
  })();
  writing.then(()=>{writing=null;},()=>{writing=null;});
  return writing;
}
function scheduleWrite():void {
  if(scheduled!==null||writing)return;
  scheduled=window.setTimeout(()=>{
    scheduled=null;
    if(pending.size)void drain().catch(()=>{/* Reported by the storage-error event. */});
  },WRITE_DELAY_MS);
}

const storage:Storage={
  get length(){return cache.size;},
  key(index:number):string|null{return [...cache.keys()][index]??null;},
  getItem(key:string):string|null{return cache.get(String(key))??null;},
  setItem(key:string,value:string):void {
    key=String(key);value=String(value);
    cache.set(key,value);pending.set(key,{value,revision:++revision});scheduleWrite();
  },
  removeItem(key:string):void {
    key=String(key);cache.delete(key);pending.set(key,{value:null,revision:++revision});scheduleWrite();
  },
  clear():void {
    // Delete only keys this window knows. Never clear the shared object store:
    // another window can own drafts added since this window last hydrated.
    for(const key of [...cache.keys()])storage.removeItem(key);
  },
};

/** Existing editor code keeps its synchronous Storage contract. */
export function getDocumentDraftStorage():Storage {
  return initialized?storage:localStorage;
}
/** Hosts with deferred serialization join explicit save/navigation barriers.
 * Producers must only flush already-pending work, not recreate discarded drafts.
 */
export function registerDocumentDraftProducer(producer:()=>void):()=>void {
  producers.add(producer);return ()=>{producers.delete(producer);};
}
/** Resolve only after transaction commit; failure retains memory and pending
 * mutations. Calling again retries those exact mutations. */
export function flushDocumentDraftStore():Promise<void> {
  try{for(const producer of producers)producer();}
  catch(error){
    if(scheduled!==null){window.clearTimeout(scheduled);scheduled=null;}
    storageError(error);return Promise.reject(error);
  }
  if(scheduled!==null){window.clearTimeout(scheduled);scheduled=null;}
  return initialized?drain():Promise.resolve();
}
/** Refresh recent drafts on focus without overwriting this window's edits. */
export async function refreshDocumentDraftStore():Promise<void> {
  if(!initialized)return;
  await flushDocumentDraftStore();
  if(!database)throw Error('Document draft storage is closed. Please reopen the app.');
  const entries=await readEntries(database);
  // Edits may have been queued while the read transaction was running.
  for(const key of [...cache.keys()])if(!pending.has(key)&&!entries.has(key))cache.delete(key);
  for(const [key,value]of entries)if(!pending.has(key))cache.set(key,value);
}

// Hidden/background pages may have their timers throttled. Start the current
// recovery transaction before that happens; the app's leave flow also awaits
// flush explicitly after serializing its latest editor state.
const flushBeforeBackground=()=>{void flushDocumentDraftStore().catch(()=>{/* Already reported. */});};

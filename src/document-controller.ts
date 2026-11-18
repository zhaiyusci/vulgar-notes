import type {DocumentFile,OpenedDocument} from './document-file';

/** Editor data operations; no dependency on Plate, React or DOM nodes. */
export interface DocumentLifecycleHost {
  isCollaborationGuest?():boolean;
  persist():void;
  cancelPendingRecovery?():void;
  serializeDocument():string;
  hasUnsavedChanges():boolean;
  markDocumentSaved(source:string):void;
  openDocument(source:string):void;
}
/** null names are untitled documents; only the UI chooses their display text. */
export interface DocumentSessionState {name:string|null;dirty:boolean;busy:boolean;active:boolean;sessionId:string|null}
interface DocumentMetadata {name:string;path?:string;recentId?:string;baseline?:string;pendingOpen?:boolean}
export type DocumentCommand='new'|'open'|'save'|'saveAs'|'home';
export type DocumentAction=DocumentCommand|'close';
export type SaveDecision='save'|'discard'|'cancel';
type LeaveDecision='clean'|SaveDecision;
interface LeaveAuthorization {host:DocumentLifecycleHost|null;contentKey:string|null}
export type DocumentNavigation={kind:'home'}|{kind:'document';documentId:string;opened?:OpenedDocument};
export type DocumentOperationErrorCode='recovery-write-failed'|'document-changed'|'invalid-recovery'|'missing-recovery';
export class DocumentOperationError extends Error {
  constructor(readonly code:DocumentOperationErrorCode){super(code);this.name='DocumentOperationError';}
}
/** Browser/native capabilities and user decisions are supplied by the application. */
export interface DocumentControllerPorts {
  defaultDocumentName:string;
  documentSessionId():string|null;
  draftStorage():{getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void};
  legacyMetadata(id:string):string|null;
  flushDocumentDraftStore():Promise<void>;
  createId():string;
  parseDocumentFile(source:string):unknown;
  documentContentKey(source:string):string;
  newDocumentWindow():Promise<void>;
  openDocumentFile():Promise<OpenedDocument|null>;
  saveDocumentFile(source:string,target?:DocumentFile,name?:string):Promise<DocumentFile|null>;
  takeSystemDocumentFile():Promise<OpenedDocument|null>;
  getRecentDocumentTarget(id:string):Promise<DocumentFile|null>;
  openRecentDocument(id:string):Promise<OpenedDocument|null>;
  rememberRecentDocument(file:DocumentFile):Promise<{id:string}>;
  askToSave(name:string|null):Promise<SaveDecision>;
  navigate(target:DocumentNavigation):void;
  saved():void;
  reportError(action:DocumentAction,error:unknown):void;
  recordRuntimeEvent(event:string):Promise<unknown>;
  schedule(callback:()=>void,delay:number):void;
}
export const documentDraftKey=(id:string)=>'math-plate-document-v1:'+id;
export const documentMetadataKey=(id:string)=>'editor.open-document:'+id;

/** One independent controller per document window, with no UI or global storage. */
export function createDocumentController(ports:DocumentControllerPorts){
  const {defaultDocumentName,documentSessionId,draftStorage,flushDocumentDraftStore,
    parseDocumentFile,documentContentKey,newDocumentWindow,openDocumentFile,saveDocumentFile,takeSystemDocumentFile,
    getRecentDocumentTarget,openRecentDocument,rememberRecentDocument,recordRuntimeEvent}=ports;
  let host:DocumentLifecycleHost|null=null;
  let currentFile:DocumentFile={name:defaultDocumentName};
  let metadata:DocumentMetadata={name:defaultDocumentName};
  let restoringTarget:Promise<void>=Promise.resolve();
  let busy=false,suppressNextUnload=false,refreshing=false,leaving=false;
  let state:DocumentSessionState={name:null,dirty:false,busy:false,active:false,sessionId:documentSessionId()};
  const listeners=new Set<()=>void>();

  function getDocumentState():DocumentSessionState{return state;}
  function subscribeDocumentState(listener:()=>void):()=>void {listeners.add(listener);return ()=>listeners.delete(listener);}
  function updateState(next:DocumentSessionState){
    if(Object.keys(next).every(key=>next[key as keyof DocumentSessionState]===state[key as keyof DocumentSessionState]))return;
    state=next;for(const listener of listeners)listener();
  }
  /** Call after prose, formula or document-setting changes. */
  function refreshDocumentState():void {
    if(refreshing||leaving)return;refreshing=true;
    try{updateState({name:metadata.baseline!==undefined?currentFile.name:null,dirty:host?.hasUnsavedChanges()??false,busy,active:host!==null,sessionId:documentSessionId()});}
    finally{refreshing=false;}
  }
  function readMetadata(id:string):DocumentMetadata {
    try{
      const source=draftStorage().getItem(documentMetadataKey(id))??ports.legacyMetadata(id);
      if(!source)return {name:defaultDocumentName};
      const saved=JSON.parse(source);if(typeof saved.name!=='string'||!saved.name)throw Error('Invalid document metadata');
      if(saved.baseline!==undefined)parseDocumentFile(saved.baseline);
      return {name:saved.name,...(typeof saved.path==='string'?{path:saved.path}:{}),...(typeof saved.recentId==='string'?{recentId:saved.recentId}:{}),...(typeof saved.baseline==='string'?{baseline:saved.baseline}:{}),...(saved.pendingOpen===true?{pendingOpen:true}:{})};
    }catch{return {name:defaultDocumentName};}
  }
  function writeMetadata(id:string,value:DocumentMetadata):boolean {
    try{draftStorage().setItem(documentMetadataKey(id),JSON.stringify(value));return true;}catch{return false;}
  }
  /** Attach after the shell has selected its UUID and constructed an editor. */
  function attachDocumentHost(next:DocumentLifecycleHost):()=>void {
    leaving=false;host=next;const id=documentSessionId();metadata=id?readMetadata(id):{name:defaultDocumentName};
    currentFile={name:metadata.name,...(metadata.path?{path:metadata.path}:{})};
    if(metadata.pendingOpen){
      // Only first-open normalization establishes a new baseline; recovery must
      // keep the original saved baseline and show subsequent edits as unsaved.
      const originalBaseline=metadata.baseline;
      metadata.baseline=next.serializeDocument();delete metadata.pendingOpen;
      if(id&&!writeMetadata(id,metadata)){
        // Clearing the first-open flag is essential: it must never mark a later
        // recovered edit as clean merely because storage filled during startup.
        metadata.baseline=originalBaseline;
        if(!writeMetadata(id,metadata))throw new DocumentOperationError('recovery-write-failed');
      }
    }
    if(metadata.baseline!==undefined)next.markDocumentSaved(metadata.baseline);
    const attachedFile=currentFile;
    restoringTarget=metadata.recentId?getRecentDocumentTarget(metadata.recentId).then(target=>{
      if(host===next&&currentFile===attachedFile&&target)currentFile=target;
    }).catch(()=>{/* Without a restored handle, Save falls back to the file picker. */}):Promise.resolve();
    refreshDocumentState();return ()=>{if(host===next){host=null;refreshDocumentState();}};
  }
  async function saveCurrent(saveAs=false):Promise<boolean> {
    const savingHost=host;if(!savingHost)return false;await restoringTarget;
    if(savingHost.isCollaborationGuest?.()){
      // A participant can save a detached snapshot, never overwrite the host's
      // main file or bind a local path as if it were the shared document.
      return !!await saveDocumentFile(savingHost.serializeDocument(),undefined,'shared-copy.vulgar');
    }
    const source=savingHost.serializeDocument();const file=await saveDocumentFile(source,saveAs?undefined:currentFile,currentFile.name);if(!file)return false;
    // Retain the returned object: browser overwrite handles are private to it.
    currentFile=file;metadata={name:file.name,...(file.path?{path:file.path}:{}),baseline:source};
    try{metadata.recentId=(await rememberRecentDocument(file)).id;}catch{/* Saving remains successful when the recent-file catalog is unavailable. */}
    savingHost.markDocumentSaved(source);const id=documentSessionId();if(id)writeMetadata(id,metadata);refreshDocumentState();
    // The file write already succeeded. Recovery/cache availability must not
    // turn a real Save into a reported file-save failure.
    try{await flushDocumentDraftStore();}catch{}
    ports.saved();
    // Do not navigate away if the document changed while its older snapshot saved.
    return host===savingHost&&!savingHost.hasUnsavedChanges();
  }
  async function mayLeave():Promise<LeaveDecision> {
    host?.persist();refreshDocumentState();
    // Give the latest recovery a chance to commit before opening a picker or
    // closing this view. A failed cache must still allow Save to a real file.
    try{await flushDocumentDraftStore();}catch{}
    // New edits can arrive while the recovery transaction is committing.
    refreshDocumentState();if(!host?.hasUnsavedChanges())return 'clean';
    const choice=await ports.askToSave(state.name);if(choice==='cancel')return 'cancel';
    if(choice==='save')return await saveCurrent()?'save':'cancel';return 'discard';
  }
  function discardRecovery():void {
    const id=documentSessionId();if(!id)return;const storage=draftStorage();
    host?.cancelPendingRecovery?.();
    if(metadata.baseline!==undefined)storage.setItem(documentDraftKey(id),metadata.baseline);else{storage.removeItem(documentDraftKey(id));storage.removeItem(documentMetadataKey(id));}
  }
  function navigate(target:DocumentNavigation):void {
    // Suppress only this already-confirmed navigation, not an unrelated later close.
    leaving=true;suppressNextUnload=true;ports.navigate(target);
    ports.schedule(()=>{
      // A failed/blocked shell navigation must restore normal draft protection.
      // On success this page is already gone and this callback never runs.
      suppressNextUnload=false;leaving=false;host?.persist();refreshDocumentState();
    },1000);
  }
  function leaveAuthorization():LeaveAuthorization {
    return {host,contentKey:host?documentContentKey(host.serializeDocument()):null};
  }
  function checkLeaveAuthorization(authorization:LeaveAuthorization):void {
    const current=leaveAuthorization();
    if(current.host!==authorization.host||current.contentKey!==authorization.contentKey)
      throw new DocumentOperationError('document-changed');
  }
  function discardRecoveryBeforeDeparture():void {
    discardRecovery();
    // Do not await between Discard and navigation: a fresh serialization there
    // would recreate discarded content. A stale recovery is safer than losing
    // unconfirmed edits; preparing a new document is committed separately.
    void flushDocumentDraftStore().catch(()=>{});
  }
  async function startOpenedDocument(file:OpenedDocument,discard:boolean,authorization:LeaveAuthorization):Promise<void> {
    parseDocumentFile(file.text);const id=ports.createId();
    const next:DocumentMetadata={name:file.name,...(file.path?{path:file.path}:{}),baseline:file.text,pendingOpen:true};
    try{next.recentId=(await rememberRecentDocument(file)).id;}catch{}
    // File reads, permission requests and recent-handle storage can outlast the
    // picker. Edits made during those awaits were not part of the earlier choice.
    // Recheck after every await and before any discard or navigation is committed.
    checkLeaveAuthorization(authorization);
    const storage=draftStorage();
    try{
      storage.setItem(documentDraftKey(id),file.text);
      storage.setItem(documentMetadataKey(id),JSON.stringify(next));
      await flushDocumentDraftStore();
      checkLeaveAuthorization(authorization);
      // Do not discard the current recovery until the next document is durable.
      if(discard)discardRecoveryBeforeDeparture();
    }catch(error){
      try{storage.removeItem(documentDraftKey(id));storage.removeItem(documentMetadataKey(id));}catch{}
      try{await flushDocumentDraftStore();}catch{}
      throw error;
    }
    void recordRuntimeEvent('document-open-complete');
    navigate({kind:'document',documentId:id,opened:file});
  }
  /** Home's New command starts one blank document in this window. */
  function startNewDocument():void {navigate({kind:'document',documentId:ports.createId()});}
  async function exclusive(action:DocumentCommand|'close',operation:()=>Promise<void>):Promise<void> {
    if(busy)return;busy=true;refreshDocumentState();try{await operation();}catch(error){ports.reportError(action,error);}finally{busy=false;refreshDocumentState();}
  }
  /** Home, toolbar and keyboard shortcuts share the same save/discard rules. */
  async function runDocumentCommand(action:DocumentCommand):Promise<void> {
    await exclusive(action,async()=>{
      if(action==='open')await recordRuntimeEvent('document-open-start');
      if(action==='new'){if(host){host.persist();await newDocumentWindow();}else startNewDocument();}
      else if(action==='save'||action==='saveAs')await saveCurrent(action==='saveAs');
      else{
        const decision=await mayLeave();if(decision==='cancel')return;
        if(action==='home'){if(decision==='discard')discardRecoveryBeforeDeparture();navigate({kind:'home'});}
        else{const authorization=leaveAuthorization();const file=await openDocumentFile();if(!file)return;await recordRuntimeEvent('document-parse-start');parseDocumentFile(file.text);await recordRuntimeEvent('document-parse-complete');await startOpenedDocument(file,decision==='discard',authorization);}
      }
    });
  }
  /** Reopen the actual source; a cached snapshot is never presented as a file. */
  async function openRecentDocumentCommand(id:string):Promise<void> {
    await exclusive('open',async()=>{
      const decision=await mayLeave();if(decision==='cancel')return;
      const authorization=leaveAuthorization();const file=await openRecentDocument(id);if(!file)return;parseDocumentFile(file.text);await startOpenedDocument(file,decision==='discard',authorization);
    });
  }
  /** Resume the existing recovery session, keeping its original saved baseline. */
  async function openRecoveredDocumentCommand(id:string):Promise<void> {
    await exclusive('open',async()=>{
      if(!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id))throw new DocumentOperationError('invalid-recovery');
      const documentId=id.toLowerCase();if(documentId===documentSessionId())return;
      const validateRecovery=()=>{
        const source=draftStorage().getItem(documentDraftKey(documentId));
        if(source===null)throw new DocumentOperationError('missing-recovery');
        parseDocumentFile(source);
      };
      validateRecovery();
      const decision=await mayLeave();if(decision==='cancel')return;
      // A different window may have removed or replaced the recovery while the
      // user was saving. Validate again before discarding the current document.
      validateRecovery();
      if(decision==='discard')discardRecoveryBeforeDeparture();
      navigate({kind:'document',documentId});
    });
  }
  /** Called once after native startup: use the same validation, recovery and Save target as Open. */
  async function openSystemDocumentCommand():Promise<boolean> {
    let started=false;
    await exclusive('open',async()=>{
      const file=await takeSystemDocumentFile();if(!file)return;
      const decision=await mayLeave();if(decision==='cancel')return;
      const authorization=leaveAuthorization();
      await startOpenedDocument(file,decision==='discard',authorization);started=true;
    });
    return started;
  }

  /** True asks the browser adapter to prevent unloading; native closes use requestClose. */
  function prepareUnload(native:boolean):boolean {
    if(native&&leaving)return false;
    if(suppressNextUnload){suppressNextUnload=false;return false;}
    host?.persist();void flushDocumentDraftStore().catch(()=>{});
    return !native&&!!host?.hasUnsavedChanges();
  }
  async function requestClose(destroy:()=>Promise<void>):Promise<void> {
    if(!host)return;
    await exclusive('close',async()=>{
      const decision=await mayLeave();if(decision==='cancel')return;
      if(decision==='discard')discardRecoveryBeforeDeparture();leaving=true;
      try{await destroy();}catch(error){leaving=false;host?.persist();throw error;}
    });
  }
  return {getDocumentState,subscribeDocumentState,refreshDocumentState,attachDocumentHost,
    hasActiveDocument:()=>host!==null,
    startNewDocument,runDocumentCommand,openRecentDocumentCommand,openRecoveredDocumentCommand,
    openSystemDocumentCommand,prepareUnload,requestClose};
}
export type DocumentController=ReturnType<typeof createDocumentController>;

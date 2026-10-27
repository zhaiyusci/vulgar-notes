import {invoke,isTauri} from '@tauri-apps/api/core';

/** Local stage IDs only. Never send document contents, filenames or paths. */
export async function recordRuntimeEvent(event:string):Promise<void>{
  if(!isTauri())return;
  try{await invoke('record_runtime_event',{event});}catch{/* Diagnostics must not break editing, including with an older desktop host. */}
}

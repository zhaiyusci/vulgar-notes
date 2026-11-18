import {safeClipboardJson} from './clipboard-fragment-wire';
import {EditorModel} from './editor-model';

export const formulaFileExtension='.vulgar-math';
export const maxFormulaFileBytes=10*1024*1024;
export const formulaFileFormat='vulgar-notes-formula';

export interface FormulaFileOptions {display:boolean;numbered:boolean}
export interface DecodedFormulaFile extends FormulaFileOptions {model:EditorModel}

function object(value:unknown):value is Record<string,unknown> {
  return value!==null&&typeof value==='object'&&!Array.isArray(value);
}

function checkSize(text:string):void {
  if(typeof text!=='string')throw new Error('A formula file must contain JSON text.');
  // The early character check avoids allocating another oversized byte buffer.
  if(text.length>maxFormulaFileBytes||new TextEncoder().encode(text).byteLength>maxFormulaFileBytes)
    throw new Error('The formula file exceeds the 10 MiB size limit.');
}

function restoreSnapshot(snapshot:unknown):EditorModel {
  if(!object(snapshot)||snapshot.version!==2||!object(snapshot.root)||!object(snapshot.cursor))
    throw new Error('The formula file does not contain a version 2 formula snapshot.');
  const model=new EditorModel();
  try {
    model.restore(JSON.stringify(snapshot));
    // restore() can migrate old operator layouts or flatten invalid standalone
    // nesting. A formula file must not silently change its tree or selection.
    // Historical display labels are derived data and are intentionally ignored.
    const expected=JSON.stringify({version:2,root:snapshot.root,cursor:snapshot.cursor,
      ...(snapshot.pendingFont!==undefined?{pendingFont:snapshot.pendingFont}:{})},
      (key,value)=>key==='label'?undefined:value);
    if(model.snapshot()!==expected)throw new Error('The formula snapshot requires migration.');
  }catch {
    throw new Error('The formula file contains an invalid or unsupported formula snapshot.');
  }
  return model;
}

/** A formula file is independent of the article schema and its storage/UI. */
export function decodeFormulaFile(text:string):DecodedFormulaFile {
  checkSize(text);
  let value:unknown;
  try{value=JSON.parse(text);}catch{throw new Error('The formula file is not valid JSON.');}
  if(!object(value)||!safeClipboardJson(value))
    throw new Error('The formula file contains unsafe or excessively nested JSON.');
  if(value.format===formulaFileFormat){
    if(value.version!==1||typeof value.display!=='boolean'||typeof value.numbered!=='boolean')
      throw new Error('The formula file has an invalid or unsupported format.');
    return {model:restoreSnapshot(value.snapshot),display:value.display,numbered:value.numbered};
  }
  // Older formula drafts stored only EditorModel.snapshot(), without a file
  // envelope. They carry no display/numbering settings, so open them inline.
  if(value.format===undefined&&value.version===2&&value.root!==undefined&&value.cursor!==undefined)
    return {model:restoreSnapshot(value),display:false,numbered:false};
  throw new Error('This is not a Vulgar Notes formula file.');
}

export function encodeFormulaFile(model:EditorModel,options:FormulaFileOptions):string {
  if(!options||typeof options.display!=='boolean'||typeof options.numbered!=='boolean')
    throw new Error('Formula display and numbering settings must be booleans.');
  const source=model.snapshot();checkSize(source);
  const value={format:formulaFileFormat,version:1,display:options.display,numbered:options.numbered,snapshot:JSON.parse(source)};
  if(!safeClipboardJson(value))throw new Error('The formula contains unsafe or excessively nested JSON.');
  restoreSnapshot(value.snapshot);
  const text=JSON.stringify(value,null,2)+'\n';checkSize(text);
  return text;
}

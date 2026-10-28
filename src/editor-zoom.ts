// SPDX-License-Identifier: GPL-3.0-or-later
export const EDITOR_ZOOM_KEY='editor.zoom';
export const EDITOR_ZOOM_LEVELS=Object.freeze([50,75,90,100,110,125,150,175,200] as const);
export type EditorZoom=typeof EDITOR_ZOOM_LEVELS[number];

export function isEditorZoom(value:unknown):value is EditorZoom {
  return typeof value==='number'&&(EDITOR_ZOOM_LEVELS as readonly number[]).includes(value);
}

/** View preferences belong to this device; no document or export data is involved. */
export function readEditorZoom(storage?:Pick<Storage,'getItem'>):EditorZoom {
  try {
    const saved=(storage??window.localStorage).getItem(EDITOR_ZOOM_KEY);
    if(saved===null||saved.trim()==='')return 100;
    const value=Number(saved);
    return isEditorZoom(value)?value:100;
  } catch {return 100;}
}

export function saveEditorZoom(value:unknown,storage?:Pick<Storage,'setItem'>):boolean {
  if(!isEditorZoom(value))return false;
  try {(storage??window.localStorage).setItem(EDITOR_ZOOM_KEY,String(value));return true;}
  catch {return false;}
}

export function nextEditorZoom(current:EditorZoom,direction:-1|1):EditorZoom {
  const index=EDITOR_ZOOM_LEVELS.indexOf(current);
  return EDITOR_ZOOM_LEVELS[Math.max(0,Math.min(EDITOR_ZOOM_LEVELS.length-1,index+direction))];
}

let zoom=readEditorZoom();
const listeners=new Set<()=>void>();
export function getEditorZoom():EditorZoom {return zoom;}
export function subscribeEditorZoom(listener:()=>void):()=>void {
  listeners.add(listener);return ()=>{listeners.delete(listener);};
}
/** An unavailable preference store does not prevent changing the current view. */
export function setEditorZoom(value:unknown,storage?:Pick<Storage,'setItem'>):boolean {
  if(!isEditorZoom(value))return false;
  const saved=saveEditorZoom(value,storage);
  if(zoom!==value){zoom=value;for(const listener of listeners)listener();}
  return saved;
}

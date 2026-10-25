// DOM boundaries are checked once rather than casting every query result.
export function elementById<T extends HTMLElement>(id:string, kind:{new():T}):T {
  const element=document.getElementById(id);
  if(!(element instanceof kind))throw new Error(`Missing or invalid element: ${id}`);
  return element;
}
export function eventElement(event:Event):Element {
  const target=event.target;
  if(target instanceof Element)return target;
  if(target instanceof Node && target.parentElement)return target.parentElement;
  return document.documentElement;
}

// SPDX-License-Identifier: GPL-3.0-or-later
/** The host's private key is deliberately never part of an invitation. */
export interface CollaborationInvite {version:2;room:string;password:string;hostPublicKey:string}
const publicEditorUrl='https://www.zhaiyusci.net/vulgar-notes/';
const invalid='This collaboration link is invalid.';
export function randomCollaborationId(bytes=16):string {
  if(!globalThis.crypto?.getRandomValues)throw Error('Secure collaboration links are unavailable in this browser.');
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)),value=>value.toString(16).padStart(2,'0')).join('');
}
export function collaborationBase64(bytes:Uint8Array):string {
  let value='';for(let offset=0;offset<bytes.length;offset+=0x8000)value+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
  return btoa(value).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function collaborationBytes(value:string):Uint8Array {
  if(!/^[A-Za-z0-9_-]*$/.test(value))throw Error(invalid);
  const decoded=atob(value.replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(decoded,character=>character.charCodeAt(0));
}
export function assertCollaborationInvite(value:unknown):asserts value is CollaborationInvite {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error(invalid);
  const invite=value as Record<string,unknown>;
  if(Object.keys(invite).length!==4||invite.version!==2||typeof invite.room!=='string'||!/^[0-9a-f]{32}$/.test(invite.room)||
    typeof invite.password!=='string'||!/^[0-9a-f]{64}$/.test(invite.password)||typeof invite.hostPublicKey!=='string'||!/^[A-Za-z0-9_-]{87}$/.test(invite.hostPublicKey))throw Error(invalid);
}
export async function createHostedInvite():Promise<{invite:CollaborationInvite;hostKey:CryptoKey}> {
  if(!globalThis.crypto?.subtle)throw Error('Secure collaboration links are unavailable in this browser.');
  const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
  const hostPublicKey=collaborationBase64(new Uint8Array(await crypto.subtle.exportKey('raw',keys.publicKey)));
  return {invite:{version:2,room:randomCollaborationId(),password:randomCollaborationId(32),hostPublicKey},hostKey:keys.privateKey};
}
/** Secrets stay in the URL fragment, never the query, HTTP request or referrer. */
export function collaborationInviteUrl(invite:CollaborationInvite,base:string):string {
  assertCollaborationInvite(invite);
  let url:URL;try{url=new URL(base);}catch{url=new URL(publicEditorUrl);}
  if(!['http:','https:'].includes(url.protocol)||['tauri.localhost','ipc.localhost'].includes(url.hostname))url=new URL(publicEditorUrl);
  url.username='';url.password='';url.search='';url.hash=new URLSearchParams({collab:JSON.stringify(invite)}).toString();return url.href;
}
export function parseCollaborationInvite(inputURL:string):CollaborationInvite|null {
  try{
    const url=inputURL.startsWith('#')?new URL(inputURL,publicEditorUrl):new URL(inputURL),values=new URLSearchParams(url.hash.slice(1)).getAll('collab');
    if(!values.length)return null;
    if(values.length!==1||!values[0]||values[0].length>4096)throw Error(invalid);
    const invite:unknown=JSON.parse(values[0]);assertCollaborationInvite(invite);return {...invite};
  }catch{throw Error(invalid);}
}

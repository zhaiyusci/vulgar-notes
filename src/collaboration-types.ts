import type {CollaborationInvite} from './collaboration-invite';
import type {Range} from 'slate';

export interface CollaborationPeer {
  clientId:number;
  name:string;
  color:string;
  host?:boolean;
  transportPeerId?:string;
  permission?:'view'|'edit';
}

export interface CollaborationRemoteCursor {
  clientId:number;name:string;color:string;range:Range|null;
  math?:{formulaId:string;region:string;offset:number;anchor:number};
}

export interface CollaborationState {
  active:boolean;
  ready:boolean;
  role?:'host'|'guest';
  permission?:'view'|'edit';
  hostConnected?:boolean;
  ended?:boolean;
  writable:boolean;
  pending:number;
  recoveryAvailable:boolean;
  recoveryCopies?:readonly {createdAt:number}[];
  status:'inactive'|'connecting'|'waiting'|'online'|'offline';
  peers:readonly CollaborationPeer[];
  invite?:CollaborationInvite;
  name:string;
  error?:string;
}
export const inactiveCollaboration:CollaborationState=Object.freeze({active:false,ready:false,writable:true,pending:0,recoveryAvailable:false,status:'inactive',peers:[],name:'Collaborator'});

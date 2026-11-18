import type {ProofreadingIssue} from './proofreading-provider';

/** Public proofreading state. It contains no editor nodes, ranges or UI elements. */
export type ProofreadingRow=ProofreadingIssue&{id:string};
export type ProofreadingState={
  enabled:boolean;
  pending:number;
  checking:boolean;
  error:string;
  checked:number;
  issues:readonly ProofreadingRow[];
  menu?:{id:string;x:number;y:number};
};

/** The UI can request an action without knowing which prose editor implements it. */
export interface ProofreadingClient {
  getSnapshot:()=>ProofreadingState;
  subscribe:(listener:()=>void)=>()=>void;
  checkCurrent():boolean;
  checkDocument():void;
  stop():void;
  locate(id:string):boolean;
  apply(id:string,replacement:string):boolean;
  ignore(id:string):void;
  closeMenu():void;
}

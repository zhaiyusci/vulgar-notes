import type {EditorModel} from './editor-model';

/** Framework-free boundary: math never imports React, Slate or Plate. */
export interface FormulaEntry { element:HTMLElement; model:EditorModel }
export interface MathHostHooks {
  activate(element:HTMLElement,model:EditorModel,edge:'start'|'end'):void;
  leave():void;
  change():void;
}
export interface DocumentHost {
  readonly readOnly:boolean;
  entries():FormulaEntry[];
  persist():void;
  exportLatex():string;
  exportMarkdown():string;
  isDisplay(element:HTMLElement):boolean;
  isNumbered(element:HTMLElement):boolean;
  setNumbered(element:HTMLElement,numbered:boolean):void;
  setDisplay(element:HTMLElement,display:boolean):void;
  insertFormula(display?:boolean):FormulaEntry;
  enter(element:HTMLElement,edge:'start'|'end'):void;
  exit(element:HTMLElement,direction:-1|1):void;
  removeEmpty(element:HTMLElement):void;
}
export type DocumentHostFactory=(mount:HTMLElement,initial:EditorModel,hooks:MathHostHooks)=>DocumentHost;

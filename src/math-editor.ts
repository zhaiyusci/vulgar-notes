import type {EditorModel} from './editor-model';
import type {MathClipboardAdapter} from './math-clipboard';

export interface MathFormulaEntry {element:HTMLElement;model:EditorModel}
/** The only document operations the formula component can invoke. */
export interface MathDocumentAdapter {
  readonly readOnly:boolean;
  entries():MathFormulaEntry[];
  syncMath():void;
  isCollaborating?():boolean;
  isCollaborationGuest?():boolean;
  getFormulaSource?(element:HTMLElement):string|undefined;
  replaceFormulaSource?(element:HTMLElement,source:string):void;
  isDisplay(element:HTMLElement):boolean;
  isNumbered(element:HTMLElement):boolean;
  setNumbered(element:HTMLElement,numbered:boolean):void;
  setDisplay(element:HTMLElement,display:boolean):void;
  insertFormula(display?:boolean):MathFormulaEntry;
  enter(element:HTMLElement,edge:'start'|'end'):void;
  exit(element:HTMLElement,direction:-1|1):void;
  removeEmpty(element:HTMLElement):void;
}
export interface MathEditorHooks {
  activate(element:HTMLElement,model:EditorModel,edge:'start'|'end'):void;
  leave():void;
  change():void;
  renderForExport():Promise<void>;
  isComposing():boolean;
  pendingMathSnapshot():{formulaId:string;snapshot:string}|undefined;
}
export interface MathEditorElements {
  formula:HTMLElement;
  preview:HTMLElement;
  content:HTMLElement;
  input:HTMLTextAreaElement;
  error:HTMLElement;
  panel:HTMLElement;
  toolbar:HTMLElement;
  layout:HTMLSelectElement;
  pendingFontHint:HTMLElement;
  structureCount:HTMLElement;
  overlayRoot?:HTMLElement;
  countLabels?:readonly HTMLElement[];
}
/** A source-editing session is tied to one live formula and model. */
export interface MathSourceEditorContext {
  readonly source:string;
  /** Returns false after the formula/session is replaced, removed or made read-only. */
  apply(source:string):boolean;
  cancel():void;
  isCurrent():boolean;
}
export interface MathSourceEditorHost {
  /** Localized label for this host's source action (for example, View LaTeX). */
  label?:string;
  open(context:MathSourceEditorContext):void;
  /** Release the previous session; the host decides whether to hide its UI. */
  close?():void;
}
export interface MathEditorOptions {
  elements:MathEditorElements;
  initialModel?:EditorModel;
  draft?:{read():string|null|undefined;write(snapshot:string):void};
  clipboard?:MathClipboardAdapter;
  /** When provided, no default source dialog or LaTeX button is created. */
  sourceEditor?:MathSourceEditorHost;
}
export interface MathEditor {
  readonly initialModel:EditorModel;
  readonly hooks:MathEditorHooks;
  connect(adapter:MathDocumentAdapter):void;
  openSource(element?:HTMLElement):void;
  render():Promise<void>;
  notifyLoadFailure():void;
  dispose():void;
}

export {createMathEditor} from './editor-ui';

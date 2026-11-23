import type {MathDocumentAdapter,MathEditorHooks,MathFormulaEntry} from './math-editor';
import type {PrintOptions} from './print-document';

export type FormulaEntry=MathFormulaEntry;
export type MathHostHooks=MathEditorHooks;

/** Document integration adds file operations; the math component sees only MathDocumentAdapter. */
export interface DocumentHost extends MathDocumentAdapter {
  isCollaborationGuest?():boolean;
  persist():void;
  exportLatex():string;
  exportMarkdown():string;
  exportHtml?():Promise<string>;
  exportPrintHtml?(options:PrintOptions):Promise<string>;
}

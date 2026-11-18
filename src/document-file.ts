/** A document's file target. Native paths and browser handles stay out of its content. */
export interface DocumentFile {name:string;path?:string}
export interface OpenedDocument extends DocumentFile {text:string}

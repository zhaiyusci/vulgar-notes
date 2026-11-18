import {parseBibLibraries,validateBibLibraries,type BibLibrary} from './bibtex';
import {createLibraryEditSession} from './bibliography-library-edit';

/** The containing document supplies these capabilities, not its editor instance. */
export interface BibliographyEditorAccess {
  isReadOnly():boolean;
  getLibraries():readonly BibLibrary[];
  getCitedKeys():readonly string[];
  commitLibraries(next:readonly BibLibrary[]):void;
}
type LibraryEditSession=ReturnType<typeof createLibraryEditSession>;
type LibraryItems=Parameters<LibraryEditSession['serialize']>[0];
type LibrarySerializer=Parameters<typeof createLibraryEditSession>[1];
export type BibliographySaveResult={status:'saved'}|{status:'confirmation-required';keys:readonly string[]};

/** Only citation keys are supplied; equation and heading labels are unrelated. */
export function missingCitations(items:readonly {id:string}[],libraries:readonly BibLibrary[],editedLibraryId:string,citedKeys:readonly string[]):string[]{
  const available=new Set(items.map(item=>item.id));
  for(const library of libraries)if(library.id!==editedLibraryId){
    for(const entry of parseBibLibraries([library]))available.add(entry.key);
  }
  return [...new Set(citedKeys)].filter(key=>!available.has(key));
}

/** A source-preserving editing session, independent of UI, Plate and the widget store. */
export function createBibliographyEditorController(library:BibLibrary,access:BibliographyEditorAccess,toBibtex:LibrarySerializer){
  const base={...library},session=createLibraryEditSession(base,toBibtex);
  let confirmation:string|undefined;
  function currentLibraries():readonly BibLibrary[]{
    if(access.isReadOnly())throw Error('This document is read-only.');
    const current=access.getLibraries(),existing=current.find(item=>item.id===base.id);
    if(!existing)throw Error('This library is no longer available.');
    if(existing.source!==base.source)throw Error('This library changed while the editor was open. Reopen it before saving.');
    return current;
  }
  return {
    initialItems:session.initialItems,
    /** A fresh draft edit revokes a previous confirmation, even if later undone. */
    changed():void{confirmation=undefined;},
    save(items:LibraryItems):BibliographySaveResult {
      const current=currentLibraries(),source=session.serialize(items);
      const next=validateBibLibraries(current.map(item=>item.id===base.id?{...item,source}:item));
      const citedKeys=access.getCitedKeys(),previouslyAvailable=new Set(parseBibLibraries(current).map(entry=>entry.key));
      const missing=missingCitations(items,current,base.id,citedKeys).filter(key=>previouslyAvailable.has(key));
      const signature=JSON.stringify([source,current,citedKeys]);
      if(missing.length&&confirmation!==signature){confirmation=signature;return {status:'confirmation-required',keys:missing};}
      // Source and authority checks are repeated at each Save, including confirmation.
      access.commitLibraries(next);confirmation=undefined;return {status:'saved'};
    },
  };
}
export type BibliographyEditorController=ReturnType<typeof createBibliographyEditorController>;

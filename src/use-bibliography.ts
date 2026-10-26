import {useContext,useSyncExternalStore} from 'react';
import {HostContext} from './plate-math-element';
import type {BibLibrary} from './bibtex';

const emptyLibraries:readonly BibLibrary[]=[];
const noSubscription=()=>()=>{};
const getEmpty=()=>emptyLibraries;

export function useBibliographyLibraries():readonly BibLibrary[]{
  const host=useContext(HostContext);
  return useSyncExternalStore(host?.subscribeBibliography??noSubscription,host?.getBibliographyLibraries??getEmpty,getEmpty);
}

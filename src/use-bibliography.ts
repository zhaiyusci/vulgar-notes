import {useContext,useSyncExternalStore} from 'react';
import {HostContext} from './plate-math-element';
import type {BibLibrary} from './bibtex';
import type {BibliographyStyle} from './bibliography-style';

const emptyLibraries:readonly BibLibrary[]=[];
const noSubscription=()=>()=>{};
const getEmpty=()=>emptyLibraries;
const getDefaultStyle=():BibliographyStyle=>'simple';

export function useBibliographyLibraries():readonly BibLibrary[]{
  const host=useContext(HostContext);
  return useSyncExternalStore(host?.subscribeBibliography??noSubscription,host?.getBibliographyLibraries??getEmpty,getEmpty);
}

export function useBibliographyStyle():BibliographyStyle {
  const host=useContext(HostContext);
  return useSyncExternalStore(host?.subscribeBibliography??noSubscription,host?.getBibliographyStyle??getDefaultStyle,getDefaultStyle);
}

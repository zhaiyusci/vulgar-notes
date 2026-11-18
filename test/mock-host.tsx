import {createContext} from 'react';
import type {BibLibrary} from '@/bibtex';

export interface MockHost {
  readOnly?:boolean;
  closed:boolean;
  store?:unknown;
  libraries:readonly BibLibrary[];
  setBibliographyLibraries(next:readonly BibLibrary[],updatedLibraryIds?:readonly string[]):void;
  getBibliographyLibraries():readonly BibLibrary[];
}

export const HostContext=createContext<MockHost|null>(null);

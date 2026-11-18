import {createContext} from 'react';
import type {PlateMathHost} from './plate-host';

/** Plate integration only. Reusable feature components receive their own interfaces as props. */
export const HostContext=createContext<PlateMathHost|null>(null);

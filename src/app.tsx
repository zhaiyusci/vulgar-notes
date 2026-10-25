import {initLocale} from './i18n';
import {mountMathEditor} from './editor-ui';
import {PlateMathHost} from './plate-host';
initLocale();
mountMathEditor((mount,initial,hooks)=>new PlateMathHost(mount,initial,hooks));

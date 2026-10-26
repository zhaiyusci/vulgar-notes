import {initLocale} from './i18n';
import {mountMathEditor} from './editor-ui';
import {PlateMathHost} from './plate-host';
import {initPreferences} from './preferences';
initLocale();
initPreferences();
mountMathEditor((mount,initial,hooks)=>new PlateMathHost(mount,initial,hooks));

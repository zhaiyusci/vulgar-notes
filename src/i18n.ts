import zh from './locales/zh-CN.json';

export type Locale='en'|'zh-CN';
const messages:Record<string,string>=zh;
const sourceKeys=new Map(Object.entries(messages).map(([key,value])=>[value,key]));
export const locale:Locale=(()=>{
  try{return localStorage.getItem('editor.locale')==='en'?'en':'zh-CN';}catch{return 'zh-CN';}
})();
/** English message IDs are stable; legacy Chinese UI strings resolve during migration. */
export function t(source:string):string {
  const shortcut=source.match(/^(.*?)( \(.*\))$/);
  if(shortcut)return t(shortcut[1])+shortcut[2];
  const key=sourceKeys.get(source)??source;
  return locale==='en'?key:messages[key]??key;
}
export function mathLabel(entry:{label:string;command?:string;type:string}):string{
  if(locale!=='en')return entry.label;
  const translated=t(entry.label);
  return translated!==entry.label?translated:entry.command||entry.type;
}
export function initLocale(){
  document.documentElement.lang=locale;
  for(const [id,key] of [['mathPanel','Math input'],['formulaLayout','Current formula'],['insertToolbar','Insert'],['textFlow','Body']])document.getElementById(id)?.setAttribute('aria-label',t(key));
  document.title=locale==='en'?'Math document editor':'数学文档编辑器';
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el=>{el.textContent=t(el.dataset.i18n!);});
  const select=document.getElementById('uiLocale') as HTMLSelectElement;
  select.value=locale;select.setAttribute('aria-label',t('Language'));
  select.addEventListener('change',()=>{
    localStorage.setItem('editor.locale',select.value);
    // The editor saves synchronously; reload recreates both independent UI hosts.
    window.location.reload();
  });
}

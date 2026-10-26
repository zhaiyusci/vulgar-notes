import {useEditorSelector} from 'platejs/react';
import {referenceTargets} from '@/references';
import {useBibliographyLibraries} from '@/use-bibliography';
import {t} from '@/i18n';

/** Generated references stay outside editable prose and keep library data intact. */
export function BibtexBibliography(){
  const libraries=useBibliographyLibraries();
  const entries=useEditorSelector(editor=>referenceTargets(editor.children,libraries)
    .filter(target=>target.kind==='bibliography'&&target.libraryId&&target.number)
    .sort((a,b)=>Number(a.number)-Number(b.number)),[libraries]);
  if(!entries.length)return null;
  return <section className="bibtex-bibliography mx-8 my-8 border-t pt-5" contentEditable={false} aria-label={t('Bibliography')}>
    <h2 className="mb-3 font-semibold">{t('Bibliography')}</h2>
    <ol className="space-y-3">
      {entries.map(entry=><li key={entry.key} id={'bibtex-'+encodeURIComponent(entry.key)} className="flex gap-2">
        <span className="shrink-0 text-muted-foreground">[{entry.number}]</span><span>{entry.description}</span>
      </li>)}
    </ol>
  </section>;
}

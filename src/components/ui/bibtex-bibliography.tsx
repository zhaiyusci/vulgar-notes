import {useEditorSelector} from 'platejs/react';
import type {TElement} from 'platejs';
import {bibliographyItems} from '@/references';
import {useBibliographyLibraries,useBibliographyStyle} from '@/use-bibliography';
import {t} from '@/i18n';
import {BibliographyText} from './bibliography-text';

/** Generated references are read-only views; their source stays outside prose. */
export function BibtexBibliography({beforeNode,afterNode}:{beforeNode?:TElement;afterNode?:TElement}){
  const libraries=useBibliographyLibraries(),style=useBibliographyStyle();
  const {entries,heading,standalone}=useEditorSelector(editor=>{
    const items=bibliographyItems(editor.children,libraries,style),editable=items.filter(item=>!item.libraryId);
    if(beforeNode){
      const index=items.findIndex(item=>item.node===beforeNode);let previous=index-1;
      while(previous>=0&&items[previous].libraryId)previous--;
      return {entries:index<0?[]:items.slice(previous+1,index).filter(item=>item.libraryId),heading:editable[0]?.node===beforeNode,standalone:false};
    }
    if(afterNode){
      const index=items.findIndex(item=>item.node===afterNode);
      return {entries:editable.at(-1)?.node===afterNode?items.slice(index+1).filter(item=>item.libraryId):[],heading:false,standalone:false};
    }
    return {entries:editable.length?[]:items.filter(item=>item.libraryId),heading:!editable.length,standalone:true};
  },[libraries,style,beforeNode,afterNode]);
  if(!entries.length&&!heading||standalone&&!entries.length)return null;
  const rows=<ol className="space-y-3">
      {entries.map(entry=><li key={entry.key} id={'bibtex-'+encodeURIComponent(entry.key)} data-bibliography-key={entry.key} className="flex gap-2">
        <span className="shrink-0 text-muted-foreground">[{entry.number||'??'}]</span><span><BibliographyText description={entry.description} runs={entry.runs} /></span>
      </li>)}
    </ol>;
  const title=heading?<h2 className="mb-3 font-semibold" data-bibliography-heading="true">{t('Notes and references')}</h2>:null;
  if(!standalone)return <div className={'bibtex-bibliography '+(beforeNode?'mb-3':'mt-3')} contentEditable={false}>{title}{entries.length?rows:null}</div>;
  return <section className="bibtex-bibliography mx-8 my-8 border-t pt-5" contentEditable={false} aria-label={t('Notes and references')}>
    {title}
    {rows}
  </section>;
}

'use client';

import type {PlateElementProps} from 'platejs/react';
import {PlateElement,useEditorRef,useEditorSelector} from 'platejs/react';
import {documentOutline,type DocumentOutlineEntry} from '@/document-outline';
import {t} from '@/i18n';

/** A generated view over the current tree. Navigation uses paths rather than optional node IDs. */
export function TocElement(props:PlateElementProps){
  const editor=useEditorRef();
  const {outline,activePath}=useEditorSelector(current=>({
    outline:documentOutline(current.children),
    activePath:current.selection?.anchor.path,
  }),[]);
  const navigate=(item:DocumentOutlineEntry)=>{
    const start=editor.api.start(item.path);
    if(!start)return;
    editor.tf.select(start);
    editor.tf.focus();
    // Native scrolling respects both the editor scroll container and CSS zoom.
    const element=editor.api.toDOMNode(item.node);
    element?.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});
  };
  return <PlateElement {...props} className="document-toc">
    <nav contentEditable={false} aria-label={t('Table of contents')}>
      <div className="document-toc-title">{t('Table of contents')}</div>
      {outline.length?<ol className="document-toc-list">
        {outline.map(item=>{
          const active=activePath&&item.path.every((part,index)=>activePath[index]===part);
          return <li key={item.anchor}>
            <button type="button" className="document-toc-link" style={{paddingInlineStart:(item.depth-1)*1.1+'rem'}}
              data-heading-path={item.path.join('.')}
              aria-current={active?'location':undefined}
              onPointerDown={event=>{event.preventDefault();event.stopPropagation();}}
              onClick={event=>{event.preventDefault();event.stopPropagation();navigate(item);}}>
              <span className="document-toc-number">{item.number}</span><span>{item.title}</span>
            </button>
          </li>;
        })}
      </ol>:<div className="document-toc-empty">{t('Add headings to display the table of contents.')}</div>}
    </nav>
    {props.children}
  </PlateElement>;
}

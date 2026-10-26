import {flushSync} from 'react-dom';
import {NodeApi} from 'platejs';
import {LabelMarker} from '@/components/ui/label-marker';
import {createPlatePlugin,PlateElement,useEditorSelector,useSelected,useFocused,type PlateElementProps} from 'platejs/react';
import {referenceTargets,resolveReference,type ReferenceNode} from '@/references';
import {t} from '@/i18n';
import {useBibliographyLibraries} from '@/use-bibliography';

function ReferenceElement(props:PlateElementProps){
  const node=props.element as ReferenceNode;
  const libraries=useBibliographyLibraries();
  const selected=useSelected(),focused=useFocused();
  const result=useEditorSelector(editor=>resolveReference(editor.children,node,libraries),[node,libraries]);
  const jump=()=>{const target=result.targets[0];if(target)(target.libraryId?document.getElementById('bibtex-'+encodeURIComponent(target.key)):props.editor.api.toDOMNode(target.node))?.scrollIntoView({block:'center',behavior:'smooth'});};
  return <PlateElement {...props} as="span" className="tex-reference" attributes={{...props.attributes,'data-reference-selected':selected&&focused?'true':'false'}}>
    <span contentEditable={false} role="link"
      className={'tex-reference-content '+(result.invalid?'text-red-600 underline decoration-wavy':'text-blue-700')}
      title={'\\'+node.command+'{'+node.keys.join(',')+'}'+(result.invalid?' — '+t('Unresolved, unnumbered or duplicate reference'):'')+' — '+t('Click to select; Ctrl/Cmd-click to follow; double-click to edit.')}
      onMouseDown={event=>{if(event.button===0){event.preventDefault();event.stopPropagation();}}}
      onClick={event=>{
        if(event.button!==0)return;
        event.preventDefault();event.stopPropagation();
        if(event.ctrlKey||event.metaKey){jump();return;}
        const path=props.editor.api.findPath(node);if(!path)return;
        const rect=event.currentTarget.getBoundingClientRect();
        // The small outer gutters put the native caret in real Slate text,
        // never inside the hidden spacer of an inline void.
        const side=event.clientX<rect.left+3?'before':event.clientX>rect.right-3?'after':null;
        const sibling=side?[...path.slice(0,-1),path[path.length-1]+(side==='after'?1:-1)]:undefined;
        const adjacent=sibling?NodeApi.get(props.editor,sibling):undefined;
        const point=adjacent&&typeof adjacent.text==='string'?{path:sibling!,offset:side==='after'?0:adjacent.text.length}:undefined;
        flushSync(()=>props.editor.tf.select(point||props.editor.api.range(path)!));
        props.editor.tf.focus();
      }}
      onDoubleClick={event=>{event.preventDefault();document.dispatchEvent(new CustomEvent('edit-tex-reference',{detail:node.id}));}}
    >{result.text}</span>{props.children}
  </PlateElement>;
}
function BibliographyElement(props:PlateElementProps){
  const index=useEditorSelector(editor=>referenceTargets(editor.children).find(target=>target.node===props.element)?.number,[props.element]);
  return <PlateElement {...props} as="div" className="my-3" attributes={{...props.attributes,title:'\\bibitem{'+props.element.citeKey+'}'}}>
    {index==='1'&&<div contentEditable={false} className="mb-3 font-semibold">{t('Bibliography')}</div>}
    <span contentEditable={false} className="mr-2 text-muted-foreground">[{index}]</span>{props.children}
  </PlateElement>;
}
function LabelElement(props:PlateElementProps){
  return <PlateElement {...props} as="span" className="tex-label-anchor"><LabelMarker id={String(props.element.id)} label={String(props.element.texLabel)} />{props.children}</PlateElement>;
}
export const ReferenceKit=[
  createPlatePlugin({key:'tex_label',node:{isElement:true,isInline:true,isVoid:true,component:LabelElement}}),
  createPlatePlugin({key:'tex_reference',node:{isElement:true,isInline:true,isVoid:true,component:ReferenceElement}}),
  createPlatePlugin({key:'bibliography_entry',node:{isElement:true,component:BibliographyElement}}),
];

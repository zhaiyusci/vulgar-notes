import {createPlatePlugin,PlateElement,useEditorSelector,type PlateElementProps} from 'platejs/react';
import {referenceTargets,resolveReference,type ReferenceNode} from '@/references';
import {t} from '@/i18n';

function ReferenceElement(props:PlateElementProps){
  const node=props.element as ReferenceNode;
  const result=useEditorSelector(editor=>resolveReference(editor.children,node),[node]);
  return <PlateElement {...props} as="span">
    <span contentEditable={false} role="link" tabIndex={0}
      className={result.invalid?'text-red-600 underline decoration-wavy':'cursor-pointer text-blue-700'}
      title={'\\'+node.command+'{'+node.keys.join(',')+'}'+(result.invalid?' — '+t('Unresolved or duplicate reference'):'')}
      onClick={()=>{const target=result.targets[0];if(target)props.editor.api.toDOMNode(target.node)?.scrollIntoView({block:'center',behavior:'smooth'});}}
      onDoubleClick={()=>document.dispatchEvent(new CustomEvent('edit-tex-reference',{detail:node.id}))}
      onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();const target=result.targets[0];if(target)props.editor.api.toDOMNode(target.node)?.scrollIntoView({block:'center'});}}}
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
export const ReferenceKit=[
  createPlatePlugin({key:'tex_reference',node:{isElement:true,isInline:true,isVoid:true,component:ReferenceElement}}),
  createPlatePlugin({key:'bibliography_entry',node:{isElement:true,component:BibliographyElement}}),
];

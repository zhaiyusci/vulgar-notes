import {LabelMarker} from './components/ui/label-marker';
import {t} from './i18n';
import React,{createContext,useContext,useLayoutEffect,useRef} from 'react';
import {PlateElement,useSelected,useFocused,type PlateElementProps} from 'platejs/react';
import type {FormulaNode} from './plate-document';
import type {PlateMathHost} from './plate-host';
export const HostContext=createContext<PlateMathHost|null>(null);

/** React owns the void wrapper and Slate child; MathJax exclusively owns the mount. */
export function MathEquationElement(props:PlateElementProps){
  const selected=useSelected(),focused=useFocused();
  const host=useContext(HostContext),ref=useRef<HTMLSpanElement>(null);
  const node=props.element as FormulaNode,display=node.type==='equation'||node.display===true;
  useLayoutEffect(()=>{
    if(!host||!ref.current)return;
    host.attach(node,ref.current);
    return ()=>host.detach(ref.current!);
  },[host,node.id,node.snapshot,node.texExpression,node.numbered,node.texLabel,display]);
  return <PlateElement {...props} as={node.type==='equation'?'div':'span'} className={display?'math-block-node':'math-inline-node'} attributes={{...props.attributes,'data-formula-selected':selected&&focused?'true':'false'}}>
    <span contentEditable={false} className={'math-mount-wrapper'+(display?' display-mount-wrapper':'')}>
      <span ref={ref} className={'inline-formula'+(display?' display-formula':'')} data-math-id={node.id}
        data-tex-label={node.texLabel||''} data-display={String(display)} data-numbered={String(node.numbered!==false)} tabIndex={0}
        title={node.texLabel?'\\label{'+node.texLabel+'}':undefined}
        aria-label={t(display?'Editable display equation':'Editable inline equation')} />
      {node.texLabel&&<LabelMarker id={node.id} label={node.texLabel} />}
    </span>
    {props.children}
  </PlateElement>;
}

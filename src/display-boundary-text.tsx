import React,{useLayoutEffect,useRef,useState} from 'react';
import type {RenderTextProps} from 'slate-react';
import {useComposedRef} from 'platejs/react';

/** Keep Slate's insertion point, but place it beside the displayed inset,
 * as in LyX, instead of giving an empty leaf a separate prose line. */
export function DisplayBoundaryText({attributes,children,text}:RenderTextProps){
  const ref=useRef<HTMLSpanElement>(null);
  const composedRef=useComposedRef(attributes.ref,ref);
  const [position,setPosition]=useState<React.CSSProperties>();
  const empty=text.text==='';
  useLayoutEffect(()=>{
    const element=ref.current,parent=element?.parentElement;
    if(!element||!parent||!empty){setPosition(undefined);return;}
    let frame=0;
    const place=()=>{
      frame=0;
      const previous=element.previousElementSibling,next=element.nextElementSibling;
      const after=previous?.matches('.math-block-node');
      const formula=after?previous:next?.matches('.math-block-node')?next:null;
      if(!formula){setPosition(undefined);return;}
      const edge=formula.querySelector(after?'.boundary-end':'.boundary-start');
      const math=formula.querySelector('mjx-math');
      const target=edge||math||formula;
      const box=target.getBoundingClientRect();
      const container=element.offsetParent as HTMLElement|null;
      if(!container)return;
      const origin=container.getBoundingClientRect();
      const height=parseFloat(getComputedStyle(element).fontSize)*1.2;
      const left=(after?box.right:box.left-3)-origin.left-container.clientLeft+container.scrollLeft;
      const top=(box.top+box.bottom-height)/2-origin.top-container.clientTop+container.scrollTop;
      setPosition(old=>old?.left===left&&old?.top===top?old:{left,top});
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(place);};
    // MathJax replaces the inset asynchronously; siblings may also change when
    // text is inserted, a formula is removed, or its display mode is toggled.
    const mutations=new MutationObserver(schedule);
    mutations.observe(parent,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class']});
    const sizes=new ResizeObserver(schedule);sizes.observe(parent);
    window.addEventListener('resize',schedule);
    place();
    return ()=>{mutations.disconnect();sizes.disconnect();window.removeEventListener('resize',schedule);if(frame)cancelAnimationFrame(frame);};
  },[empty]);
  return <span {...attributes} ref={composedRef} data-empty-text={empty?'true':undefined} style={empty?position:undefined}>{children}</span>;
}

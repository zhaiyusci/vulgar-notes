'use client';
import * as React from 'react';
import type {TExcalidrawElement} from '@platejs/excalidraw';
import {PlateElement,useReadOnly,useEditorRef,type PlateElementProps} from 'platejs/react';
import '@excalidraw/excalidraw/index.css';
const Drawing=React.lazy(()=>import('@excalidraw/excalidraw').then(m=>({default:m.Excalidraw})));

/** Official Excalidraw UI, with scene changes deferred beyond Slate's render. */
export function ExcalidrawElement(props:PlateElementProps<TExcalidrawElement>){
 const editor=useEditorRef(),readOnly=useReadOnly(),timer=React.useRef<ReturnType<typeof setTimeout>>(undefined);
 const initial=React.useRef(async()=>{const {restoreElements}=await import('@excalidraw/excalidraw');return {elements:restoreElements((props.element.data?.elements||[]) as Parameters<typeof restoreElements>[0],null),appState:{viewBackgroundColor:props.element.data?.state?.viewBackgroundColor,collaborators:new Map()},scrollToContent:true};});
 const last=React.useRef('');
 React.useEffect(()=>()=>clearTimeout(timer.current),[]);
 const onChange:NonNullable<React.ComponentProps<typeof Drawing>['onChange']>=(elements,state)=>{
  if(readOnly)return;
  const data={elements,state:{viewBackgroundColor:state.viewBackgroundColor,gridSize:state.gridSize,gridStep:state.gridStep}};
  const source=JSON.stringify(data);if(last.current===source)return;last.current=source;
  clearTimeout(timer.current);timer.current=setTimeout(()=>{
   const match=editor.api.nodes({at:[],match:n=>n.id===props.element.id}).next().value;
   if(match)editor.tf.setNodes({data:JSON.parse(source)},{at:match[1]});
  },150);
 };
 return <PlateElement {...props}><div contentEditable={false} className="mx-auto h-[600px] w-full max-w-[800px] overflow-hidden rounded-sm border">
  <React.Suspense fallback={<div className="p-4 text-muted-foreground">正在加载绘图工具…</div>}>
   <Drawing initialData={initial.current} onChange={onChange} viewModeEnabled={readOnly} />
  </React.Suspense>
 </div>{props.children}</PlateElement>;
}

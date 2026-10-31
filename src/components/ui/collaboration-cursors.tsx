import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import type {Range as SlateRange} from 'slate';
import type {PlateMathHost} from '@/plate-host';

interface Box {left:number;top:number;width:number;height:number}
interface Bounds {left:number;top:number;right:number;bottom:number}
interface MeasuredCursor {selection:Box[];region?:Box;caret?:Box;labelAnchor?:Box}
interface RemoteCursor {
  clientId:number;name:string;color:string;range:SlateRange|null;
  math?:{formulaId:string;region:string;offset:number;anchor:number};
}
interface CursorPosition {
  clientId:number;name:string;color:string;selection:Box[];region?:Box;caret?:Box;
  label?:{left:number;top:number;maxWidth:number;before:boolean};
}
const rounded=(value:number)=>Math.round(value*4)/4;
function box(rect:DOMRect|DOMRectReadOnly):Box|undefined {
  if(![rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)||rect.height<=0)return;
  return {left:rounded(rect.left),top:rounded(rect.top),width:Math.max(0,rounded(rect.width)),height:rounded(rect.height)};
}
function clipped(rect:Box,bounds:Bounds):Box|undefined {
  const left=Math.max(rect.left,bounds.left),top=Math.max(rect.top,bounds.top);
  const right=Math.min(rect.left+rect.width,bounds.right),bottom=Math.min(rect.top+rect.height,bounds.bottom);
  if(right<=left||bottom<=top)return;
  return {left,top,width:right-left,height:bottom-top};
}
function visibleEditorBounds(editor:HTMLElement,view:Window):Bounds|undefined {
  const rect=editor.getBoundingClientRect();
  const result={left:Math.max(0,rect.left),top:Math.max(0,rect.top),right:Math.min(view.innerWidth,rect.right),bottom:Math.min(view.innerHeight,rect.bottom)};
  for(let parent=editor.parentElement;parent;parent=parent.parentElement){
    const style=view.getComputedStyle(parent),bounds=parent.getBoundingClientRect();
    const scaleX=parent.offsetWidth?bounds.width/parent.offsetWidth:1,scaleY=parent.offsetHeight?bounds.height/parent.offsetHeight:1;
    if(/^(auto|scroll|hidden|clip)$/.test(style.overflowX)){
      const left=bounds.left+parent.clientLeft*scaleX;
      result.left=Math.max(result.left,left);result.right=Math.min(result.right,left+parent.clientWidth*scaleX);
    }
    if(/^(auto|scroll|hidden|clip)$/.test(style.overflowY)){
      const top=bounds.top+parent.clientTop*scaleY;
      result.top=Math.max(result.top,top);result.bottom=Math.min(result.bottom,top+parent.clientHeight*scaleY);
    }
  }
  return result.right>result.left&&result.bottom>result.top?result:undefined;
}
function nativeCaret(range:globalThis.Range,view:Window):Box|undefined {
  for(const rect of Array.from(range.getClientRects())){const measured=box(rect);if(measured)return {...measured,width:2};}
  const direct=box(range.getBoundingClientRect());if(direct)return {...direct,width:2};
  // Firefox can return an empty rectangle at an empty leaf or text boundary.
  // Measure an adjacent glyph without inserting measurement nodes into Slate.
  const node=range.startContainer,offset=range.startOffset;
  if(node.nodeType===3&&node.textContent?.length){
    const after=offset<node.textContent.length,probe=range.cloneRange();
    probe.setStart(node,after?offset:Math.max(0,offset-1));probe.setEnd(node,after?offset+1:offset);
    const rects=Array.from(probe.getClientRects()),neighbor=box(rects[after?0:rects.length-1]??probe.getBoundingClientRect());
    if(neighbor)return {...neighbor,left:after?neighbor.left:neighbor.left+neighbor.width,width:2};
  }
  const element=node.nodeType===1?node as Element:node.parentElement;
  const leaf=element?.closest('[data-slate-leaf]')??element;
  if(!leaf)return;
  const rect=box(leaf.getBoundingClientRect());if(!rect)return;
  const style=view.getComputedStyle(leaf),height=Number.parseFloat(style.lineHeight)||Number.parseFloat(style.fontSize)*1.2||rect.height;
  return {...rect,width:2,height:Math.min(rect.height,height)};
}
function prosePosition(host:PlateMathHost,range:SlateRange,editor:HTMLElement,view:Window):MeasuredCursor|undefined {
  const domRange=host.editor.api.toDOMRange(range);
  if(!domRange||!editor.contains(domRange.startContainer)||!editor.contains(domRange.endContainer))return;
  const selection=range.anchor.offset===range.focus.offset&&range.anchor.path.join('.')===range.focus.path.join('.')?[]:
    Array.from(domRange.getClientRects()).map(box).filter((rect):rect is Box=>!!rect&&rect.width>0);
  const focus=host.editor.api.toDOMRange({anchor:range.focus,focus:range.focus});
  return {selection,caret:focus?nativeCaret(focus,view):undefined};
}
function mathPosition(host:PlateMathHost,math:NonNullable<RemoteCursor['math']>):MeasuredCursor|undefined {
  if(!/^r\d+$/.test(math.region)||![math.offset,math.anchor].every(value=>Number.isSafeInteger(value)&&value>=0))return;
  const mount=host.mounts.get(math.formulaId);if(!mount?.isConnected)return;
  const region=Array.from(mount.getElementsByClassName('region-'+math.region)).find(element=>element.getBoundingClientRect().height>0);
  if(!region)return;
  const measured=box(region.getBoundingClientRect());if(!measured)return;
  const item=(offset:number)=>region.getElementsByClassName('item-'+math.region+'-'+offset)[0];
  const current=item(math.offset),previous=math.offset>0?item(math.offset-1):undefined;
  const target=box((current??previous??region).getBoundingClientRect());
  const caret=target&&(current||previous||math.offset===0)?{...target,left:current?target.left:previous?target.left+target.width:target.left,width:2}:undefined;
  const start=Math.min(math.offset,math.anchor),end=Math.max(math.offset,math.anchor),selection:Box[]=[];
  // Very large selections use the region outline rather than thousands of reads.
  if(end-start<=160)for(let index=start;index<end;index++){
    const element=item(index),rect=element&&box(element.getBoundingClientRect());if(rect)selection.push(rect);
  }
  return {selection,region:measured,caret,labelAnchor:target};
}
function measure(host:PlateMathHost,editor:HTMLElement,view:Window):CursorPosition[] {
  const bounds=visibleEditorBounds(editor,view);if(!bounds)return [];
  const result:CursorPosition[]=[];
  for(const peer of host.getCollaborationCursors() as readonly RemoteCursor[]){
    try{
      const geometry=peer.math?mathPosition(host,peer.math):peer.range?prosePosition(host,peer.range,editor,view):undefined;
      if(!geometry)continue;
      const selection=geometry.selection.map(rect=>clipped(rect,bounds)).filter((rect):rect is Box=>!!rect).slice(0,160);
      const region=geometry.region?clipped(geometry.region,bounds):undefined;
      const caret=geometry.caret&&geometry.caret.left>=bounds.left&&geometry.caret.left<bounds.right?clipped({...geometry.caret,left:Math.min(geometry.caret.left,bounds.right-2)},bounds):undefined;
      const labelAnchor=caret??(geometry.labelAnchor?clipped(geometry.labelAnchor,bounds):undefined);
      if(!selection.length&&!region&&!caret)continue;
      let label:CursorPosition['label'];
      if(labelAnchor&&bounds.bottom-bounds.top>=16){
        const before=labelAnchor.left>(bounds.left+bounds.right)/2;
        const left=before?labelAnchor.left:Math.min(labelAnchor.left+2,bounds.right);
        const maxWidth=Math.min(140,before?left-bounds.left:bounds.right-left);
        const top=labelAnchor.top-17>=bounds.top?labelAnchor.top-17:Math.min(bounds.bottom-16,labelAnchor.top+labelAnchor.height+1);
        if(maxWidth>=16)label={left,top,maxWidth,before};
      }
      const color=/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(peer.color)?peer.color:'#2563eb';
      result.push({clientId:peer.clientId,name:peer.name.slice(0,80),color,selection,region,caret,label});
    }catch{/* A peer's stale range may disappear while its selection is updating. */}
  }
  return result;
}

/** Purely visual: no selection writes, MathJax mutation, or pointer hit areas. */
export function CollaborationCursors({host}:{host:PlateMathHost}){
  const [positions,setPositions]=useState<CursorPosition[]>([]);
  useEffect(()=>{
    const document=host.mount.ownerDocument,view=document.defaultView;if(!view)return;
    let frame=0,disposed=false,observing=false;
    const update=()=>{
      frame=0;if(disposed)return;
      const editor=host.mount.querySelector<HTMLElement>('[data-slate-editor]');
      const next=host.getCollaborationState().active&&editor?.isConnected?measure(host,editor,view):[];
      setPositions(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
    };
    const schedule=()=>{if(!disposed&&!frame)frame=view.requestAnimationFrame(update);};
    // MathJax finishes asynchronously after an Awareness update. Observe only
    // editor DOM, and collapse its mutation batches into the same animation frame.
    const mutations=new MutationObserver(schedule);
    const resize=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(schedule);
    const stopWatching=()=>{
      mutations.disconnect();resize?.disconnect();observing=false;
      document.removeEventListener('scroll',schedule,true);view.removeEventListener('resize',schedule);
      view.visualViewport?.removeEventListener('scroll',schedule);view.visualViewport?.removeEventListener('resize',schedule);
    };
    const changed=()=>{
      if(!host.getCollaborationState().active){
        if(observing)stopWatching();if(frame){view.cancelAnimationFrame(frame);frame=0;}
        setPositions(previous=>previous.length?[]:previous);return;
      }
      if(!observing){
        observing=true;
        document.addEventListener('scroll',schedule,true);view.addEventListener('resize',schedule);
        view.visualViewport?.addEventListener('scroll',schedule);view.visualViewport?.addEventListener('resize',schedule);
        mutations.observe(host.mount,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style','class']});
        resize?.observe(host.mount);
      }
      schedule();
    };
    const unsubscribe=host.subscribeCollaboration(changed);changed();
    return ()=>{disposed=true;if(frame)view.cancelAnimationFrame(frame);unsubscribe();stopWatching();};
  },[host]);
  if(!positions.length)return null;
  return createPortal(<div className="collaboration-cursors" aria-hidden="true" data-collaboration-cursors="">
    {positions.map(peer=><div key={peer.clientId} data-collaboration-cursor={peer.clientId}>
      <div className="collaboration-selection-group">{peer.selection.map((rect,index)=><span key={index} className="collaboration-selection" style={{...rect,backgroundColor:peer.color}} />)}</div>
      {peer.region&&<span className="collaboration-math-region" style={{...peer.region,borderColor:peer.color}} />}
      {peer.caret&&<span className="collaboration-caret" style={{...peer.caret,backgroundColor:peer.color}} />}
      {peer.label&&<span className="collaboration-cursor-name" style={{left:peer.label.left,top:peer.label.top,maxWidth:peer.label.maxWidth,backgroundColor:peer.color,transform:peer.label.before?'translateX(-100%)':undefined}}>{peer.name}</span>}
    </div>)}
  </div>,host.mount.ownerDocument.body);
}

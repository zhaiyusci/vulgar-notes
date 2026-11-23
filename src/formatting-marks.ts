/** Paint on a separate canvas so marks never participate in wrapping, Slate
 * offsets, clipboard data or the document snapshot used for export. */
export function showFormattingMarks(editor:HTMLElement):()=>void {
  const doc=editor.ownerDocument,view=doc.defaultView!;
  const canvas=doc.createElement('canvas');canvas.setAttribute('aria-hidden','true');canvas.dataset.formattingMarks='';
  canvas.style.cssText='position:fixed;pointer-events:none;z-index:2';
  doc.body.append(canvas);
  const selector='.slate-p,.slate-h1,.slate-h2,.slate-h3,.slate-h4,.slate-h5,.slate-h6,.slate-blockquote,.slate-code_line';
  const visible=new Set<Element>();
  let frame=0;
  function paint(){
    frame=0;
    const bounds=editor.getBoundingClientRect();
    const left=Math.max(0,bounds.left),top=Math.max(0,bounds.top);
    const width=Math.max(0,Math.min(view.innerWidth,bounds.right)-left),height=Math.max(0,Math.min(view.innerHeight,bounds.bottom)-top);
    const ratio=view.devicePixelRatio||1;
    canvas.style.left=left+'px';canvas.style.top=top+'px';canvas.style.width=width+'px';canvas.style.height=height+'px';
    canvas.width=Math.ceil(width*ratio);canvas.height=Math.ceil(height*ratio);
    const ctx=canvas.getContext('2d');if(!ctx||!width||!height)return;
    ctx.setTransform(ratio,0,0,ratio,-left*ratio,-top*ratio);
    ctx.fillStyle=view.getComputedStyle(editor).getPropertyValue('--muted-foreground').trim()||'#738096';
    ctx.globalAlpha=.75;ctx.textBaseline='middle';
    const range=doc.createRange();
    for(const block of visible){
      let end:DOMRect|undefined;
      const leaves=block.querySelectorAll('[data-slate-string],[data-slate-zero-width],.inline-formula');
      for(const leaf of leaves){
        if(leaf.closest('[data-slate-spacer]')||leaf.closest(selector)!==block)continue;
        if(leaf.matches('.inline-formula')){end=leaf.getBoundingClientRect();continue;}
        const text=leaf.firstChild;
        if(!text||text.nodeType!==3)continue;
        const raw=text.textContent!;
        // Slate adds one extra LF to make the caret visible after a final soft break.
        // Firefox keeps that extra LF in a separate text node.
        const synthetic=leaf===leaves[leaves.length-1]&&raw.endsWith('\n\n')&&!text.nextSibling;
        const value=synthetic?raw.slice(0,-1):raw;
        for(const match of value.matchAll(/[ \t\n]/g)){
          range.setStart(text,match.index);range.setEnd(text,match.index+1);
          const rect=range.getClientRects()[0];if(!rect||rect.bottom<top||rect.top>top+height)continue;
          const y=rect.top+rect.height/2;
          if(match[0]===' '){ctx.beginPath();ctx.arc(rect.left+rect.width/2,y,Math.max(.7,rect.height/21),0,Math.PI*2);ctx.fill();}
          else{ctx.font=rect.height*.65+'px system-ui';ctx.fillText(match[0]==='\t'?'→':'↵',rect.left,y);}
        }
        range.setStart(text,value.length);range.collapse(true);
        if(synthetic)range.setEnd(text,raw.length);
        end=range.getClientRects()[0]??end;
      }
      if(end){ctx.font=Math.max(8,end.height*.66)+'px system-ui';ctx.fillText('¶',end.right+1,end.top+end.height/2);}
    }
  }
  const schedule=()=>{if(!frame)frame=view.requestAnimationFrame(paint);};
  const observer=new IntersectionObserver(entries=>{
    for(const e of entries){if(e.isIntersecting)visible.add(e.target);else visible.delete(e.target);}
    schedule();
  });
  function watch(node:Node,added:boolean){
    if(node.nodeType!==1)return;
    const element=node as Element;
    for(const block of [...(element.matches(selector)?[element]:[]),...element.querySelectorAll(selector)]){
      if(added)observer.observe(block);else{observer.unobserve(block);visible.delete(block);}
    }
  }
  watch(editor,true);
  const mutations=new MutationObserver(records=>{
    for(const rec of records){rec.removedNodes.forEach(n=>watch(n,false));rec.addedNodes.forEach(n=>watch(n,true));}
    schedule();
  });
  mutations.observe(editor,{subtree:true,childList:true,characterData:true,attributes:true});
  const resize=new ResizeObserver(schedule);resize.observe(editor);
  view.addEventListener('resize',schedule);doc.addEventListener('scroll',schedule,true);doc.fonts?.addEventListener('loadingdone',schedule);
  return ()=>{observer.disconnect();mutations.disconnect();resize.disconnect();view.cancelAnimationFrame(frame);
    doc.removeEventListener('scroll',schedule,true);view.removeEventListener('resize',schedule);doc.fonts?.removeEventListener('loadingdone',schedule);canvas.remove();};
}

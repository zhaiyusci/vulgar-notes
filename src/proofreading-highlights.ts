import type {PlateEditor} from 'platejs/react';
import type {Point,Range as SlateRange} from 'slate';

type Kind='spelling'|'grammar';
type Issue={id:string;kind:Kind;range:StaticRange;slate:SlateRange;anchor:unknown;focus:unknown;text:string};
let sequence=0;
const samePoint=(a:Point,b:Point)=>a.offset===b.offset&&a.path.length===b.path.length&&a.path.every((value,index)=>value===b.path[index]);
const sameRange=(a:SlateRange,b:SlateRange)=>samePoint(a.anchor,b.anchor)&&samePoint(a.focus,b.focus)||samePoint(a.anchor,b.focus)&&samePoint(a.focus,b.anchor);
const comparePoints=(a:Point,b:Point)=>{
  for(let index=0;index<Math.min(a.path.length,b.path.length);index++)if(a.path[index]!==b.path[index])return a.path[index]-b.path[index];
  return a.path.length-b.path.length||a.offset-b.offset;
};
function nodeAt(editor:PlateEditor,path:readonly number[]):unknown {
  let node:unknown=editor;
  for(const index of path){
    const children=(node as {children?:unknown[]}|undefined)?.children;
    if(!Array.isArray(children)||!Number.isSafeInteger(index)||index<0)return;
    node=children[index];
  }
  return node;
}

/** Transient proofreading ink. Static ranges never participate in DOM updates. */
export class ProofreadingHighlights {
  readonly available:boolean=false;
  private readonly names={spelling:`vn-proofreading-${++sequence}-spelling`,grammar:`vn-proofreading-${sequence}-grammar`};
  private readonly issues=new Map<string,Issue>();
  private registry:HighlightRegistry|undefined;
  private highlights:{spelling:Highlight;grammar:Highlight}|undefined;
  private style:HTMLStyleElement|undefined;
  private destroyed=false;
  private keyboardMenu=false;

  constructor(private readonly editor:PlateEditor,private readonly mount:HTMLElement,private readonly onContextMenu:(id:string,x:number,y:number)=>void){
    const view=mount.ownerDocument.defaultView;
    if(!view?.CSS?.highlights||typeof view.Highlight!=='function'||typeof view.StaticRange!=='function')return;
    try{
      this.registry=view.CSS.highlights;
      this.highlights={spelling:new view.Highlight(),grammar:new view.Highlight()};
      for(const kind of ['spelling','grammar'] as const){
        this.highlights[kind].type=kind==='spelling'?'spelling-error':'grammar-error';
        this.registry.set(this.names[kind],this.highlights[kind]);
      }
      this.style=mount.ownerDocument.createElement('style');
      this.style.textContent=Object.entries({spelling:'#d93025',grammar:'#1a73e8'}).map(([kind,color])=>
        `::highlight(${this.names[kind as Kind]}){text-decoration:underline wavy ${color};text-decoration-thickness:1.5px;}`
      ).join('\n');
      (mount.ownerDocument.head??mount.ownerDocument.documentElement).append(this.style);
      mount.addEventListener('contextmenu',this.contextMenu,true);
      mount.addEventListener('keydown',this.keyDown,true);
      mount.addEventListener('pointerdown',this.pointerDown,true);
      this.available=true;
    }catch{this.destroy();}
  }

  set(id:string,range:SlateRange,kind:Kind):void {
    this.remove(id);
    if(!this.available||this.destroyed)return;
    try{
      const slate={anchor:{path:[...range.anchor.path],offset:range.anchor.offset},focus:{path:[...range.focus.path],offset:range.focus.offset}};
      const anchor=nodeAt(this.editor,slate.anchor.path),focus=nodeAt(this.editor,slate.focus.path);
      if(!anchor||!focus)return;
      const text=this.editor.api.string(slate),dom=this.editor.api.toDOMRange(slate);
      if(!text||!dom||!this.mount.isConnected||!this.mount.contains(dom.startContainer)||!this.mount.contains(dom.endContainer))return;
      const mapped=this.editor.api.toSlateRange(dom,{exactMatch:true,suppressThrow:true});
      if(!mapped||!sameRange(mapped,slate)||dom.toString()!==text)return;
      const Static=this.mount.ownerDocument.defaultView!.StaticRange;
      const frozen=new Static({startContainer:dom.startContainer,startOffset:dom.startOffset,endContainer:dom.endContainer,endOffset:dom.endOffset});
      this.highlights![kind].add(frozen);
      this.issues.set(id,{id,kind,range:frozen,slate,anchor,focus,text});
    }catch{/* A pending React commit can temporarily make a Slate range unmappable. */}
  }

  remove(id:string):void {
    const issue=this.issues.get(id);if(!issue)return;
    this.highlights?.[issue.kind].delete(issue.range);this.issues.delete(id);
  }

  clear():void {
    this.issues.clear();this.highlights?.spelling.clear();this.highlights?.grammar.clear();
  }

  destroy():void {
    if(this.destroyed)return;this.destroyed=true;
    this.clear();
    for(const kind of ['spelling','grammar'] as const)if(this.registry?.get(this.names[kind])===this.highlights?.[kind])this.registry?.delete(this.names[kind]);
    this.style?.remove();
    this.mount.removeEventListener('contextmenu',this.contextMenu,true);
    this.mount.removeEventListener('keydown',this.keyDown,true);
    this.mount.removeEventListener('pointerdown',this.pointerDown,true);
  }

  private readonly keyDown=(event:KeyboardEvent)=>{this.keyboardMenu=event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey;};
  private readonly pointerDown=()=>{this.keyboardMenu=false;};

  private liveRange(issue:Issue):Range|undefined {
    if(nodeAt(this.editor,issue.slate.anchor.path)!==issue.anchor||nodeAt(this.editor,issue.slate.focus.path)!==issue.focus||
      !this.mount.isConnected||!this.mount.contains(issue.range.startContainer)||!this.mount.contains(issue.range.endContainer))return;
    try{
      const range=this.mount.ownerDocument.createRange();
      range.setStart(issue.range.startContainer,issue.range.startOffset);range.setEnd(issue.range.endContainer,issue.range.endOffset);
      const mapped=this.editor.api.toSlateRange(range,{exactMatch:true,suppressThrow:true});
      if(!mapped||!sameRange(mapped,issue.slate)||range.toString()!==issue.text)return;
      return range;
    }catch{return;}
  }

  private readonly contextMenu=(event:MouseEvent)=>{
    const keyboard=this.keyboardMenu||event.clientX===0&&event.clientY===0&&event.button!==2;this.keyboardMenu=false;
    if(!this.available||this.destroyed||event.defaultPrevented)return;
    const target=event.target as Element|null;
    if(target?.closest?.('input,textarea,select,button,.math-mount-wrapper,mjx-container'))return;
    for(const issue of this.issues.values()){
      if(keyboard){
        const point=this.editor.selection?.focus;if(!point)continue;
        const {anchor,focus}=issue.slate;
        const [start,end]=comparePoints(anchor,focus)<=0?[anchor,focus]:[focus,anchor];
        if(comparePoints(point,start)<0||comparePoints(point,end)>0)continue;
      }
      const range=this.liveRange(issue);if(!range){this.remove(issue.id);continue;}
      const rect=Array.from(range.getClientRects()).find(rect=>rect.width>0&&rect.height>0&&(keyboard||
        event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom));
      if(!rect)continue;
      event.preventDefault();event.stopPropagation();
      this.onContextMenu(issue.id,keyboard?rect.left:event.clientX,keyboard?rect.bottom:event.clientY);return;
    }
  };
}

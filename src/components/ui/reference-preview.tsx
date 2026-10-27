import type {ReactElement, ReactNode} from 'react';
import {HoverCard, HoverCardContent, HoverCardTrigger} from './hover-card';
import {BibliographyText} from './bibliography-text';
import type {BibliographyRun} from '@/bibliography-style';

type PreviewEntry={key:string;number?:string;description:string;runs?:readonly BibliographyRun[]};

/** Notes and citations share the same layout and hover behavior. */
export function ReferencePreview({children,entries=[],fallback,open,onOpenChange}:{
  children:ReactElement;
  entries?:readonly PreviewEntry[];
  fallback?:ReactNode;
  open?:boolean;
  onOpenChange?:(open:boolean)=>void;
}){
  if(!entries.length&&fallback==null)return children;
  return <HoverCard open={open} onOpenChange={onOpenChange} openDelay={500} closeDelay={150}>
    <HoverCardTrigger asChild>{children}</HoverCardTrigger>
    <HoverCardContent align="start" sideOffset={8}
      data-reference-preview="true"
      className="reference-preview w-80 max-w-[calc(100vw-24px)] space-y-2 p-3 text-left font-sans text-sm leading-relaxed font-normal tracking-normal not-italic break-words">
      {entries.map(entry=><div key={entry.key} className="flex items-baseline gap-2">
        <span className="shrink-0 text-muted-foreground">[{entry.number||'??'}]</span>
        <span className="min-w-0"><BibliographyText description={entry.description} runs={entry.runs} /></span>
      </div>)}
      {fallback}
    </HoverCardContent>
  </HoverCard>;
}

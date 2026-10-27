import {Fragment} from 'react';
import type {BibliographyRun} from '@/bibliography-style';

/** Render only structured typography, never HTML supplied by a .bib file. */
export function BibliographyText({description,runs}:{description:string;runs?:readonly BibliographyRun[]}){
  if(!runs)return <>{description}</>;
  return <>{runs.map((run,index)=>{
    let content=<Fragment>{run.text}</Fragment>;
    if(run.italic)content=<i>{content}</i>;
    if(run.bold)content=<b>{content}</b>;
    if(run.smallCaps)content=<span style={{fontVariant:'small-caps'}}>{content}</span>;
    if(run.superscript)content=<sup>{content}</sup>;
    if(run.subscript)content=<sub>{content}</sub>;
    return <Fragment key={index}>{content}</Fragment>;
  })}</>;
}

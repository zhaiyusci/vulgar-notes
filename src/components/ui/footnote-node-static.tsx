import * as React from 'react';

import type { TFootnoteElement } from '@platejs/footnote';
import type { SlateElementProps } from 'platejs/static';

import { SlateElement } from 'platejs/static';

export function FootnoteReferenceElementStatic(
  props: SlateElementProps<TFootnoteElement>
) {
  const { element } = props;

  return (
    <SlateElement
      {...props}
      as="span"
      className="endnote-reference tex-reference"
    >
      {props.children}<span className="tex-reference-content text-blue-700">[{element.identifier ?? ''}]</span>
    </SlateElement>
  );
}

export function FootnoteDefinitionElementStatic(
  props: SlateElementProps<TFootnoteElement>
) {
  const { element } = props;

  return (
    <SlateElement {...props} as="div" className="mt-2 flex items-start gap-2">
      <div className="mt-0.5 min-w-4 text-muted-foreground text-sm tabular-nums">
        {element.identifier ?? ''}
      </div>
      <div className="min-w-0 flex-1">{props.children}</div>
    </SlateElement>
  );
}

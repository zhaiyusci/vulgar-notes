'use client';

import * as React from 'react';
import { FontSizePlugin } from '@platejs/basic-styles/react';
import { Minus, Plus } from 'lucide-react';
import { KEYS, type TElement } from 'platejs';
import { useEditorPlugin, useEditorSelector } from 'platejs/react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HostContext } from '@/plate-editor-context';
import { defaultTypography } from '@/document-typography';
import { t } from '@/i18n';
import { ToolbarButton } from './toolbar';

const HEADING_SCALE: Record<string, number> = {
  h1: 2.25, h2: 1.5, h3: 1.25, h4: 1.125, h5: 1.125,
};
const SIZES_PT = [8, 9, 10, 11, 12, 14, 16, 18, 24, 30, 36, 48, 60, 72, 96];

function absolutePoints(size: unknown) {
  const match = /^(\d*\.?\d+)\s*(pt|px)?$/i.exec(String(size).trim());
  if (!match) return undefined;
  // Legacy numeric marks use CSS pixels, just like an explicit px mark.
  return Number(match[1]) * (match[2]?.toLowerCase() === 'pt' ? 1 : 0.75);
}

function formatPoints(size: number) {
  return String(Number(size.toFixed(3)));
}

export function FontSizeToolbarButton() {
  const { editor, tf } = useEditorPlugin(FontSizePlugin);
  const host = React.useContext(HostContext);
  const { bodyPt } = React.useSyncExternalStore(
    host?.subscribeTypography ?? (() => () => {}),
    host?.getTypography ?? (() => defaultTypography)
  );
  const cursorSize = useEditorSelector(editor => {
    const [block] = editor.api.block<TElement>() ?? [];
    const size = editor.api.marks()?.[KEYS.fontSize] ?? block?.fontSize;
    if (size != null) {
      const points = absolutePoints(size);
      if (points !== undefined) return formatPoints(points);
      // Pasted rich text may use relative CSS sizes. Read the rendered leaf for these.
      const focus = editor.selection?.focus;
      const node = focus && editor.api.node(focus)?.[0];
      const leaf = node && editor.api.toDOMNode(node);
      const styled = leaf?.querySelector('[data-slate-string]') ?? leaf;
      if (styled) return formatPoints(parseFloat(getComputedStyle(styled).fontSize) * 0.75);
    }
    return formatPoints(bodyPt * (HEADING_SCALE[block?.type ?? ''] ?? 1));
  }, [bodyPt]);

  const [draft, setDraft] = React.useState<string | null>(null);
  const ignoreBlur = React.useRef(false);
  function applySize(size: number) {
    if (Number.isFinite(size) && size > 0 && formatPoints(size) !== cursorSize) {
      tf.fontSize.addMark(`${formatPoints(size)}pt`);
    }
  }
  function finish(size: number) {
    ignoreBlur.current = true;
    applySize(size);
    setDraft(null);
    editor.tf.focus();
  }
  function enteredPoints(value: string) {
    const match = /^(\d*\.?\d+)\s*(?:pt)?$/i.exec(value.trim());
    return match ? Number(match[1]) : NaN;
  }

  return (
    <div className="flex h-7 items-center gap-1 rounded-md bg-muted/60 p-0">
      <ToolbarButton tooltip="Decrease font size" onMouseDown={e => e.preventDefault()}
        onClick={() => finish(Number(cursorSize) - 1)}><Minus /></ToolbarButton>
      <Popover open={draft !== null} modal={false}>
        <PopoverTrigger asChild>
          <input className="h-full w-10 shrink-0 bg-transparent px-1 text-center text-sm hover:bg-muted"
            type="text" aria-label={t('Text size (pt)')} inputMode="decimal" data-plate-focus="true"
            value={draft ?? cursorSize}
            onFocus={() => { ignoreBlur.current = false; setDraft(cursorSize); }}
            onChange={e => setDraft(e.target.value)}
            onBlur={e => {
              if (!ignoreBlur.current) applySize(enteredPoints(e.currentTarget.value));
              setDraft(null);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                finish(e.key === 'Enter' ? enteredPoints(e.currentTarget.value) : NaN);
              }
            }}
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto px-1 py-1"
          onOpenAutoFocus={e => e.preventDefault()} onCloseAutoFocus={e => e.preventDefault()}>
          {SIZES_PT.map(size => (
            <button key={size} type="button"
              className="flex h-8 w-full items-center justify-center px-2 text-sm hover:bg-accent data-[highlighted=true]:bg-accent"
              onMouseDown={e => e.preventDefault()} onClick={() => finish(size)}
              data-highlighted={String(size) === cursorSize}>{size} pt</button>
          ))}
        </PopoverContent>
      </Popover>
      <span aria-hidden="true" className="text-xs">pt</span>
      <ToolbarButton tooltip="Increase font size" onMouseDown={e => e.preventDefault()}
        onClick={() => finish(Number(cursorSize) + 1)}><Plus /></ToolbarButton>
    </div>
  );
}

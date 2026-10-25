import type { PlateEditor } from 'platejs/react';

/** Move existing nodes, preserving formula identities and a single undo step. */
export function moveRootBlocks(editor: PlateEditor, ids: string[], beforeId: string | null) {
  const selected = new Set(ids);
  const original = editor.children.map(node => node.id as string);
  const moving = original.filter(id => selected.has(id));
  const remaining = original.filter(id => !selected.has(id));
  if (!moving.length || (beforeId !== null && !remaining.includes(beforeId))) return;
  const at = beforeId === null ? remaining.length : remaining.indexOf(beforeId);
  const order = [...remaining.slice(0, at), ...moving, ...remaining.slice(at)];
  if (order.every((id, index) => id === original[index])) return;
  editor.tf.withNewBatch(() => editor.tf.withoutNormalizing(() => {
    order.forEach((id, index) => {
      const from = editor.children.findIndex(node => node.id === id);
      if (from !== index) editor.tf.moveNodes({ at: [from], to: [index] });
    });
  }));
}

/** Pointer capture avoids native contenteditable drag/drop differences between browsers. */
export function startParagraphDrag(
  editor: PlateEditor, handle: HTMLElement, pointerId: number,
  startX: number, startY: number, ids: string[],
) {
  const root = handle.closest<HTMLElement>('[data-slate-editor]');
  if (!root) return () => {};
  const doc = handle.ownerDocument;
  const win = doc.defaultView!;
  const scroller = root.closest<HTMLElement>('#preview') ?? root;
  const selected = new Set(ids);
  const line = doc.createElement('div');
  line.dataset.paragraphDropLine = '';
  Object.assign(line.style, { position: 'fixed', height: '2px', background: '#3b82f6',
    pointerEvents: 'none', zIndex: '10000', display: 'none' });
  doc.body.append(line);
  let active = false, valid = false, beforeId: string | null = null;
  let x = startX, y = startY, frame = 0, finished = false;
  const oldCursor = doc.body.style.cursor;
  const oldSelection = root.style.userSelect;
  const update = () => {
    const bounds = scroller.getBoundingClientRect();
    valid = x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    const blocks = [...root.querySelectorAll<HTMLElement>('[data-root-block-id]')]
      .filter(node => !selected.has(node.dataset.rootBlockId!));
    if (!valid || !blocks.length) { valid = false; line.style.display = 'none'; return; }
    const next = blocks.find(node => {
      const rect = node.getBoundingClientRect();
      return y < (rect.top + rect.bottom) / 2;
    });
    beforeId = next?.dataset.rootBlockId ?? null;
    const rect = (next ?? blocks[blocks.length - 1]).getBoundingClientRect();
    Object.assign(line.style, { display: 'block', left: `${rect.left}px`, width: `${rect.width}px`,
      top: `${Math.max(bounds.top, Math.min(bounds.bottom - 2, next ? rect.top : rect.bottom))}px` });
  };
  const scroll = () => {
    if (finished) return;
    const rect = scroller.getBoundingClientRect();
    if (active && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      const speed = y < rect.top + 36 ? -10 : y > rect.bottom - 36 ? 10 : 0;
      if (speed) { scroller.scrollTop += speed; update(); }
    }
    frame = win.requestAnimationFrame(scroll);
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    x = event.clientX; y = event.clientY;
    if (!active && Math.hypot(x - startX, y - startY) < 4) return;
    active = true;
    event.preventDefault();
    doc.body.style.cursor = 'grabbing'; root.style.userSelect = 'none';
    update();
  };
  const cleanup = () => {
    if (finished) return;
    finished = true;
    win.cancelAnimationFrame(frame);
    win.removeEventListener('pointermove', move, true);
    win.removeEventListener('pointerup', up, true);
    win.removeEventListener('pointercancel', cancel, true);
    win.removeEventListener('keydown', key, true);
    win.removeEventListener('blur', cleanup);
    handle.removeEventListener('lostpointercapture', cleanup);
    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
    line.remove(); doc.body.style.cursor = oldCursor; root.style.userSelect = oldSelection;
  };
  const up = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    x = event.clientX; y = event.clientY;
    if (active) { event.preventDefault(); event.stopPropagation(); update(); }
    const commit = active && valid;
    cleanup();
    if (commit) moveRootBlocks(editor, ids, beforeId);
  };
  const cancel = (event: PointerEvent) => { if (event.pointerId === pointerId) cleanup(); };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cleanup(); } };
  win.addEventListener('pointermove', move, { capture: true, passive: false });
  win.addEventListener('pointerup', up, true);
  win.addEventListener('pointercancel', cancel, true);
  win.addEventListener('keydown', key, true);
  win.addEventListener('blur', cleanup);
  handle.addEventListener('lostpointercapture', cleanup);
  handle.setPointerCapture(pointerId);
  frame = win.requestAnimationFrame(scroll);
  return cleanup;
}

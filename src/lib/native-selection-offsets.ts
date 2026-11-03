export type NativeSelectionOffsets = {start: number; end: number};

type CDATAState = {
  hasCDATA: boolean;
  observer: MutationObserver;
  inspect: (records: MutationRecord[]) => void;
};

const cdataStates = new WeakMap<Element, CDATAState>();

/**
 * React's selection capture counts UTF-16 code units of Text descendants.
 * Range does the same in native code, except that it also counts CDATA.
 * Return null for unsupported cases so the original React traversal runs.
 * This reads selection boundaries; it never changes the live selection.
 */
export function nativeSelectionOffsets(
  root: Element,
  anchorNode: Node | null,
  anchorOffset: number,
  focusNode: Node | null,
  focusOffset: number,
): NativeSelectionOffsets | null {
  try {
    if (!root || !anchorNode || !focusNode ||
      (anchorNode.nodeType !== 1 && anchorNode.nodeType !== 3) ||
      (focusNode.nodeType !== 1 && focusNode.nodeType !== 3) ||
      !root.contains(anchorNode) || !root.contains(focusNode)) return null;

    const doc = root.ownerDocument;
    let state = cdataStates.get(root);
    if (!state) {
      const Observer = doc.defaultView?.MutationObserver;
      if (!Observer) return null;
      const created: CDATAState = {
        hasCDATA: !!doc.createTreeWalker(root, 8 /* SHOW_CDATA_SECTION */).nextNode(),
        observer: new Observer(records => created.inspect(records)),
        inspect(records) {
          if (created.hasCDATA) return;
          for (const record of records) for (const added of record.addedNodes) {
            if (added.nodeType === 4 ||
              (added.firstChild && doc.createTreeWalker(added, 8).nextNode())) {
              // Conservative permanently: removing CDATA need not make this
              // unusual root eligible again. The original algorithm is safe.
              created.hasCDATA = true;
              return;
            }
          }
        },
      };
      created.observer.observe(root, {childList: true, subtree: true});
      cdataStates.set(root, created);
      state = created;
    }
    // React may commit in the same task that inserted a subtree, before the
    // observer callback. Drain pending records before trusting the cache.
    state.inspect(state.observer.takeRecords());
    if (state.hasCDATA) return null;

    const range = doc.createRange();
    range.selectNodeContents(root);
    range.setEnd(anchorNode, anchorOffset);
    const start = range.toString().length;
    if (anchorNode === focusNode && anchorOffset === focusOffset) return {start, end: start};
    range.setEnd(focusNode, focusOffset);
    return {start, end: range.toString().length};
  } catch {
    return null;
  }
}

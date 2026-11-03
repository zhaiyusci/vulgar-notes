# Vulgar Notes 0.1.42

This release improves typing responsiveness in large documents and removes navigation flash highlighting.

## Editing performance

- Avoid repeated whole-document formula, metadata and reference scans during ordinary prose input. Reuse unchanged subtree indexes while preserving formula synchronization, undo/redo and recovery saves.
- Remove unnecessary per-paragraph subscriptions for comments, folding, navigation feedback and desktop drag gutters. Comments, folding, drag-and-drop, ordinary selections and reference navigation remain available.
- Render prose in smaller Slate chunks. Optimize React DOM's selection-offset capture with native DOM ranges while preserving its original algorithm as a fallback. The build verifies the audited React version and source hash before applying this adaptation; installed dependencies are not modified.
- Avoid MathJax staging and document-wide source-region queries when formulas have not changed.
- Keep endnotes after the body when typing into the final empty paragraph, without rescanning every subsequent keystroke.

## Validation

On the same 811 KB, 4,692-block document, isolated Chromium tests at the beginning, middle and end measured steady input-to-DOM commit medians of **9.0, 11.4 and 11.0 ms**, respectively. The corresponding 95th percentiles were **12.8, 14.2 and 21.9 ms**; first keystrokes took **22.3–41.1 ms**. These are browser measurements, not a guarantee for every device or a separate WebView2 benchmark.

Backward-selection replacement, CJK/emoji input, IME composition, undo/redo and 10,014 selection-boundary comparisons passed. TypeScript checking and the automated regression suite passed: **972 passed, 0 failed, and 1 existing TODO**. The TODO records the existing citeproc-js conditional contributor-substitution limitation.

## Downloads

- `Vulgar-Notes-windows-x64-portable.exe`: run directly without installing.
- `Vulgar-Notes-windows-x64-setup.exe`: Windows installer.
- `SHA256SUMS.txt`: SHA-256 download checksums.

The Windows application requires Microsoft Edge WebView2 Runtime and is currently unsigned. The [web editor](https://www.zhaiyusci.net/vulgar-notes/) uses the same editing implementation.

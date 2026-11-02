# Vulgar Notes 0.1.41

This release expands graphical formula input, separates whole equations from nested components, and brings host-controlled collaboration to the Windows release as well as the web editor.

## Formula input

- Insert whole-equation layouts from the document toolbar. Keep the formula panel focused on structures that can be nested inside a formula. Numbered cases and multiline equations use their native MathJax environments without an extra enclosing equation number.
- Add double square brackets and further delimiter, symbol, annotated-arrow, accent and physics forms. Compact buttons expose rendered variants and their native commands through right-click menus.
- Group verified aliases and duplicate operator entries. Keep distinct mathematical spacing, glyph and limit-placement semantics when importing or switching forms.
- Move dot punctuation and colon alignment details into symbol variants. Hide generic constructors, macro declarations, spacing primitives and internal package helpers from the panel and partial command suggestions. Complete commands remain available as editable source, and existing document nodes remain readable.
- Preserve contents, node identities and editing positions when switching compatible variants. Unsupported LaTeX remains editable source rather than being replaced with an arbitrary preset.

## Collaboration

- Share a document through Yjs and WebRTC, with the initiator holding the authoritative session. Concurrent online edits remain collaborative; disconnected guest editing is paused instead of later merging an independent offline draft.
- Let the initiator assign viewing or editing access and stop a collaborator from editing.
- Preserve formula structures and shared document data during collaboration, including the transition from editing a formula to starting a session.

See [MathJax coverage and LaTeX portability](https://github.com/zhaiyusci/vulgar-notes/blob/v0.1.41/docs/mathjax-coverage.md) for the tested input forms, intentional GUI exclusions and source-preservation policy. This is not a claim that every TeX declaration has a graphical editing interface.

## Validation

TypeScript checking and the complete automated suite passed: **951 passed, 0 failed, and 1 existing TODO** out of 952 tests. The TODO records the existing citeproc-js conditional contributor-substitution limitation. Coverage includes real MathJax rendering, equation numbering, native formula round trips, graphical menus, collaboration, persistence and exports.

## Downloads

- `Vulgar-Notes-windows-x64-portable.exe`: run directly without installing.
- `Vulgar-Notes-windows-x64-setup.exe`: Windows installer.
- `SHA256SUMS.txt`: SHA-256 download checksums.

The Windows application requires Microsoft Edge WebView2 Runtime and is currently unsigned. The [web editor](https://www.zhaiyusci.net/vulgar-notes/) uses the same editing implementation.

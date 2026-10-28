# Vulgar Notes 0.1.39

This release brings document structure, safer copy and paste, and broader MathJax 4 support to the web and Windows editors.

## Documents

- Add a Metadata block with a unique title, horizontally arranged authors, shared affiliations and free-form notes. Reorder authors and affiliations without breaking their links. LaTeX export uses native `authblk` author and affiliation commands.
- Insert a live table of contents derived from document headings.
- Keep figures and tables together with their captions in the text flow. Number them independently, label them, and refer to them with cross-references that update after reordering. Table captions appear above the table; figure captions appear below the image.
- Zoom document content from 50% to 200% using the controls at the lower-right corner. Zoom does not change saved content or exported formatting.

## Formula editing and clipboard

- Keep nested superscripts and subscripts in the current editing region: typing `e^N_bead` produces `e^{N_{bead}}`.
- Preserve native formula structures, rich text, labels, referenced bibliography entries and endnotes when copying between documents. Pasted fragments receive independent identities while retaining their internal relationships.
- Keep ordinary text paste literal and handle rich HTML paste separately. Markdown parsing is not used for body paste.
- Convert recognized LaTeX into editable structures when opening documents. Retain unsupported fragments as editable source instead of flattening or silently changing their meaning.
- View and edit a formula's existing source through the LaTeX button or its context menu, then apply and retry conversion without retyping it. Fix conversion retries, `\boldsymbol`, and text-mode symbols including explicit en and em dashes.

## MathJax 4 coverage

- Explicitly enable 22 mathematical typesetting extensions, with `physics` taking precedence where commands overlap. Keep BBoldX as the single blackboard alphabet rather than offering duplicate font packages.
- Expand command completion, symbol atoms and structure variants from the installed official MathJax 4.1.3 command registries. Add named functions including `\Tr` and preserve their operator and argument semantics.
- Add editable numbered and subnumbered cases (`numcases` and `subnumcases`), including dynamic rows and text conditions with embedded mathematics. Keep their equation numbering and subsequent cross-references consistent.
- Extend physics derivatives, vectors, quantities, bra-ket notation, expectation values and other verified structure forms. Syntax without a reliable native representation remains editable LaTeX source.
- Detect optional TeX packages during explicit export, adapt verified MathJax-specific forms, and report known portability limitations precisely. Export checks do not run during typing.

See [MathJax coverage and LaTeX portability](https://github.com/zhaiyusci/vulgar-notes/blob/v0.1.39/docs/mathjax-coverage.md) for the selected extension policy, reproducible inventory and conversion boundaries.

## Recovery and performance

- Move document recovery and saved-file baselines to IndexedDB so documents containing images do not exhaust localStorage. Preserve and migrate older recovery records.
- Batch recovery writes and flush pending edits before saving or leaving a document. Keep unsaved content available if recovery storage fails.
- Avoid whole-document LaTeX/Markdown export and repeated image serialization during formula editing. Cursor movement does not rewrite formula content or create content history.

## Validation

TypeScript checking and the automated suite passed: **762 passed, 0 failed, and 1 existing TODO** out of 763 tests. The TODO records the existing citeproc-js conditional contributor-substitution limitation. Tests include the actual editor formula renderer with the local MathJax runtime, clipboard round trips, recovery and document structure, and compilation checks using TeX Live. TeX compilation checks skip on runners without the required TeX executable.

## Downloads

- `Vulgar-Notes-windows-x64-portable.exe`: run directly without installing.
- `Vulgar-Notes-windows-x64-setup.exe`: Windows installer.
- `SHA256SUMS.txt`: download checksums.

The Windows application requires Microsoft Edge WebView2 Runtime and is currently unsigned. The [web editor](https://www.zhaiyusci.net/vulgar-notes/) uses the same editing implementation.

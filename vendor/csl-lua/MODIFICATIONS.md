# Bundled Lua CSL processor

This is a partial, standalone distribution of citeproc-lua 0.9.2 and its runtime dependencies for Vulgar Notes. Exact upstream repositories, revisions, paths, licenses, original hashes, and distributed hashes are recorded in `files.json`. `modules.json` records the standalone Lua module names; these names follow the upstream rockspec.

Only the processor path is included. The TeX CLI, LaTeX manager, BibTeX parser, journal database, and lualibs integration are excluded. No document-supplied Lua code is loaded. The host supplies metadata and CSL XML as data, and supplies a read-only `datafile.open` adapter for the three bundled Unicode tables.

## Local engine changes, 2026-10-27

The original versions of the four changed MIT-licensed engine files are retained under `original/`. Their modified versions contain a notice referring here.

1. `lua/citeproc/node-names.lua`: retain a non-Roman given name in family–given display order, and do not apply Roman initial generation to a non-Roman name. Previously, the structured name `{family="张", given="三"}` became `张.` or lost `三` in abbreviated styles. This change retains `张三`; it does not depend on changing the bibliographic item's language. Also place an implicit inherited `cs:name` before a label-only `cs:names` child. Explicit label-before-name ordering remains supported. Previously, Vancouver editor/translator labels preceded and ran into their names.
2. `lua/citeproc/output.lua`: when sentence punctuation moves inside closing quotation marks, put it in a new baseline text node if the title ends in a superscript or subscript. Previously, an AIP/IEEE title ending in `x<sup>2</sup>` absorbed the following comma into `x<sup>2,</sup>`. The fix leaves the superscript intact and places the comma after it. Also preserve the base word immediately before a script during text-case conversion, including a base inside nested italic/bold wrappers; ordinary prose still receives the style's requested capitalization.
3. `lua/citeproc/node-choose.lua` and the substitute entry in `node-names.lua`: select the first non-empty candidate in an active conditional branch used directly as a name substitute. A chain of nested conditionals keeps this selection rule; an explicit group or macro remains a single complete candidate. Previously, a Chicago editor fallback concatenated every available contributor category, suppressing translators from their proper later location and joining labels with names.
4. `lua/citeproc/node-date.lua`: preserve the delimiter passed from a localized date format when rendering a single date, rather than reading an absent delimiter from the referencing date element. Previously, Vancouver's date of access lost the spaces between year, month, and day.

The source bodies of other modules and the three UCD tables are unchanged. File placement and the selection of the standalone subset differ from the original projects. The LPPL Unicode algorithm components have a prominent packaging notice referring to this log; their algorithm bodies are unchanged.

## Upstream source availability

The original complete projects are available at the repositories and fixed revisions in `files.json`. In particular, the complete unmodified Unicode algorithm fork is available at <https://github.com/zepinglee/lua-uni-algos/tree/1dc1d24f7c204edf5be1b67397e79851fd7fe804>. This partial distribution is maintained as part of Vulgar Notes; it does not imply that the upstream authors support Vulgar Notes or its changes.

Unicode algorithm files retain their LPPL v1.3-or-later notices; redistribution here uses LPPL 1.3c or later. Unicode data retains its own copyright and permission notices. LuaXML is distributed under the Lua license, which Lua's authors permit treating as MIT; its original authors and project README are preserved in `licenses/csl-lua`.

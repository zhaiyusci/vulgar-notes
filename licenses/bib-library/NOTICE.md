# Supplied bibliography editor bundle

The bibliography editor was supplied in `vulgar-notes-integrated-20261109.tar.gz`,
under `vulgar-package/vulgar-notes/src/generated/bib-library.js`.
The archive's README identifies the integration as GPL-3.0-or-later, inherited
from Vulgar Notes. Its third-party dependencies retain their own licenses.

Original bundle SHA-256:
`e6611e6e5e88d39fb6c32a75c3f12e46ff92f2bd596657986aa1df5397b92f9c`

`scripts/patch-bib-library.cjs` checks this digest and reproducibly applies the
integration changes to that exact bundle. These preserve citation keys and
unchanged CSL metadata, restrict BibTeX parsing to that format, dispose editing
timers, restrict links to HTTP(S), and connect the component's own UI strings to
the application language. `src/bibliography-editor-localization.ts` contains the
readable localization adapter. User bibliography text is not translated.

The supplied bundle embeds Citation.js, a citeproc-js processor, CSL styles and
locales, and other transitive dependencies. Its embedded package metadata
identifies `@citation-js/core` version `0.9.0`, MIT, by Lars Willighagen, source
revision `51a37ce28fd3508e5cc2957b7d17794cdbad8ed0`:
<https://github.com/citation-js/citation-js/tree/51a37ce28fd3508e5cc2957b7d17794cdbad8ed0>.
Its processor reports the internal citeproc-js version `1.4.61`; this alone
does not identify the npm package revision. Embedded CSL resources retain
their author, contributor and CC-BY-SA-3.0 rights metadata.

The archive did not include the original bibliography package's source tree,
lockfile, source map, or the `integration/entry.ts` mentioned by its README.
Consequently this record documents the supplied artifact and our changes; it
does not claim a complete, independently verified dependency-source manifest.
The original package's preferred source and complete third-party notices must
accompany a public redistribution of this component. Existing processor and CSL
notices in this repository are retained; they do not establish the precise
provenance of every dependency embedded in the supplied artifact.

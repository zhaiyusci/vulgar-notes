# Citation Style Language assets

Vulgar Notes uses styles and locales from the **Citation Style Language (CSL)
project**, https://citationstyles.org/.

The XML embedded in `assets.ts` is copied without modification from the official
CSL styles and locales repositories. The complete author, contributor,
translator, attribution, and rights metadata in each XML document is preserved.
Both repositories license these files under **Creative Commons
Attribution-ShareAlike 3.0 Unported (CC-BY-SA-3.0)**. The locales are not CC0.
The full license is supplied in `LICENSE-CC-BY-SA-3.0.txt` and is also available
at https://creativecommons.org/licenses/by-sa/3.0/.

`manifest.json` records the exact pinned Git commit, source URL, SHA-256 digest,
byte count, and title for every embedded XML document. The original upstream
README files are included as `UPSTREAM-STYLES-README.md` and
`UPSTREAM-LOCALES-README.md`, including their licensing and attribution
instructions. The application code has its own license; this notice describes
the bundled upstream CSL XML only.

The snapshots come from the upstream-validated `v1.0.2` distribution branches.
To refresh deliberately, review the upstream revisions and licenses, update
the pinned commits in `scripts/update-csl-assets.cjs`, and run that script.
Normal builds use the local strings and never download CSL resources.

The application's `vancouver` identifier uses the current independent
`nlm-citation-sequence.csl` style, which is the official parent of
`dependent/vancouver-nlm.csl`. Upstream reorganized and renamed the former
Vancouver styles in January 2026; no obsolete `vancouver.csl` is substituted.

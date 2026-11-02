# MathJax coverage and LaTeX portability

MathJax's ability to render a command is distinct from the editor's ability to
represent it as an editable structure. The editor keeps these layers separate:

- `mathjax-extension-policy.ts` selects rendering packages and their precedence.
  Excluded packages cannot be re-enabled through automatic loading or `require`.
- `mathjax-command-data.json` records the installed official runtime registries.
  Character and delimiter maps establish real symbol atoms. A dispatch handler's
  configuration arguments do not establish its TeX argument grammar.
- Command completion uses existing native structures and verified symbol atoms
  first. Other enabled commands enter as editable LaTeX source components. The
  cursor remains inside the source component so subsequent arguments do not
  accidentally join a different mathematical flow.
- Conversion replaces only syntax whose meaning can be represented. Unsupported
  fragments keep their original source. Opening a document or moving a caret
  does not rewrite the source merely because an editable representation exists.

Use **LaTeX** to view or edit an existing formula's source. **Apply and convert**
also retries an existing source component when its text has not changed in the
dialog. This matters after editing a source component directly in the formula.
An unchanged unsupported component remains source without adding an undo entry.
Native rich document and formula clipboard fragments preserve their structures;
external TeX is parsed as a complete expression, while ordinary prose paste is
not interpreted as Markdown.

BBoldX remains the single blackboard alphabet. The inventory can record upstream
alternatives without offering duplicate BBM, DSFont or extra blackboard-weight
choices in the product.

## GUI symbol coverage

`gui-math-symbols.test.cjs` checks the configured character inventory against
reachable palette buttons and their right-click variants, including canonical
entries for aliases and explicit exclusions for implementation helpers. An
existing source-command candidate alone does not count as a GUI entry.
Classification uses the upstream token map, attributes and
operator character classes; text-mode tokens are kept distinct from mathematical
tokens with the same appearance. Large operators use the existing optional-limit
model, and repeated ordinary atoms are retained only for reading old documents.

The palette presents mathematical forms rather than a list of all commands.
`math-input-policy.ts` keeps generic constructors such as `genfrac`, invisible
layout primitives, macro declarations, HTML attributes, internal package helpers
and TeX logos out of the palette and prefix suggestions. Delimiter extension
pieces (`arrowvert`, `bracevert`), `qcomma`/`qc`, `Residue`, and the duplicate
integral interfaces `intop`/`ointop` are also source-only. Their existing node
definitions remain available; in particular, importing `intop` must preserve its
different automatic limit placement rather than substitute `int`.
Typing a complete command still opens editable
source; import, rendering and old document nodes remain supported. In particular,
bare `genfrac` must never select a preset's delimiters, thickness or style.
Fractions, binomial coefficients and unruled stacks remain mathematical choices.
Dot punctuation (`cdotp`, `ldotp`) and colon alignment (`ordinarycolon`,
`vcentercolon`) are right-click variants of their corresponding symbol. Choosing
a variant preserves its native command and mathematical spacing class.

`gui-math-structures.test.cjs` covers all public enabled `xArrow` commands and
the added arcs, double annotations, modulus forms, centered negation and small
diagonal fraction. The arrow list includes the four distinct forms documented by
[extpfeil](https://docs.mathjax.org/en/v4.1/input/tex/extensions/extpfeil.html).
`physics-gui-variants.test.cjs` checks derivative orders, differential operators,
mixed partials, higher differentials, same-state products and expectation values.
These checks compare real MathJax output and exercise insertion, conversion and
document/clipboard preservation. Optional-argument variants map operands by role;
switching must not turn an order into a differentiation variable or drop content.

This is an audit of symbols and the listed input forms, not a claim that every
TeX declaration or parameterized layout interface has a GUI. Macro definitions,
global settings and mhchem's internal reaction-arrow helpers are not independent
palette symbols. Whole-equation environments belong to document insertion; only
unnumbered inner structures belong to the formula component palette. Preview
tests render every visible button and variant and reject errors or implicit tags.

The ordinary AMS `cases` structure is distinct from the `cases` extension's
`numcases` and `subnumcases`. Numbered cases have editable mathematical rows and
text-mode condition cells; spaces, CJK and explicit `$...$` math in a condition
are preserved. Their tags use the native `cases` tag class. The global-only
`tagformat` configuration extension is excluded because it replaces this class's
subnumber formatting. A document label targets the final real row. Number
consumption and following references share the same cached numbering query.
For explicit TeX export, a final plain cases row terminator is removed when
MathJax ignores it but TeX would otherwise add an extra empty numbered row.

## Reproducing the inventory

Run:

```sh
node scripts/audit-mathjax-coverage.cjs
node scripts/audit-mathjax-coverage.cjs --check
node mathjax-commands.test.cjs
```

The generator initializes the installed official MathJax build with the selected
package policy and reads its `TokenMap`, `MapHandler` and `ConfigurationHandler`
registries. It snapshots effective package precedence before registering optional
packages for inspection. It does not infer command grammar from minified source
or assume that a renderer command is a native editing structure.

The application ships only command/environment metadata and provenance.
`diagnostics/mathjax-coverage.json` contains the full package/map inventory,
actual `EditorModel.commandCandidates()` coverage, deliberate omissions, and
converter probes. Re-run the audit after changing packages, candidates, model
structures or the converter. A probe confirms its particular sample; it does
not prove coverage of every option, declaration or macro expansion.

## Explicit LaTeX export

Portability scans run only for an explicit export. They are not part of typing,
caret movement, formula rendering or recovery writes.

`mathjax-latex-packages.ts` separates adaptations, package requirements and known
nonportable interfaces. Its optional package preamble belongs after
`mathtools`/`amssymb`, before `extarrows`, `unicode-math` and `physics`.
In particular, `extpfeil` must precede `extarrows` to avoid duplicate arrow
definitions. Keeping `physics` later preserves its selected operator semantics.

Reliable adaptations include MathJax `\units` to the TeX `\unit` command, the
explicit default Roman formatter of MathJax `\nicefrac`, and upright Greek
atoms through the document's selected `unicode-math` alphabet. The latter keeps
variant rho and final sigma distinct rather than relying on `upgreek.sty`
aliases or fallback glyphs. Text, verbatim and local macro-definition scopes are
preserved rather than rewritten speculatively.

Packages such as `cases`, `centernot`, `empheq`, `colortbl`, `gensymb`, `units`
and `textcomp` have real TeX counterparts. This does not make every MathJax
extension interface portable. Known examples requiring an explicit adaptation
or a precise export error include:

- `\bbox`: parse padding, border and background options into actual TeX boxes
  and colors. The unrelated `fontinst` package named `bbox.sty` is not a solution.
- `\enclose`: translate each enclosure notation separately; combinations may
  require a different representation.
- `\unicode`: preserve its character, math class, font and optional metrics;
  the unrelated XMLTeX package named `unicode.sty` is not a solution.
- HTML/CSS annotations: metadata-only identifiers can be removed while retaining
  their content, but visible CSS styles need explicit TeX equivalents.

Unknown user macros are retained. A specific export limitation is not an input
ban, and should not be described as the absence of a mathematical symbol or font.

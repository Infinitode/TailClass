# TailClass security & robustness review

**Scope:** `tailclass` v1.0.0 (commit `eacdffd`), Node.js 18–24.
**Status:** every finding below is fixed in **v1.0.1** (see [`CHANGELOG.md`](../CHANGELOG.md));
TCA-13 is an informational note on optional supply-chain hardening.
**Method:** manual source review of `src/*`, adversarial testing of the CLI/library against
crafted projects, and targeted timing/performance probes. All findings below were
reproduced locally and are covered by regression tests.

TailClass parses *repository content* (markup, `tailclass.config.json`,
`tailclass.map.json`, an existing `tailclass.css`) and then **writes files**. That makes
"a cloned, possibly hostile repository" the relevant threat model: anyone who runs
`npx tailclass apply` (locally, or in CI on a pull request) executes a tool whose
output paths, CSS payloads and glob patterns are all attacker-influenced.

## Summary

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| TCA-01 | **High** | Path traversal: config-driven arbitrary file write **and delete** outside the project root | Fixed |
| TCA-02 | **High** | CSS injection through unvalidated `@apply` payloads from markup | Fixed |
| TCA-03 | **High** | ReDoS (event-loop hang) in the glob matcher, reachable from config | Fixed |
| TCA-04 | Medium | CSS/markup injection via unvalidated `classPrefix` | Fixed |
| TCA-05 | Medium | CSS injection through dictionary `label` / `category` / `elements` comments | Fixed |
| TCA-06 | Medium | Generated output clobbers project source files and foreign stylesheets | Fixed |
| TCA-07 | Medium | Unhandled `SyntaxError` from `[` glob patterns (crash / pattern injection) | Fixed |
| TCA-08 | Medium | Configuration is unvalidated: `TypeError` crashes, silent coercion, no provenance | Fixed |
| TCA-09 | Low | `revert` trusts manifest/CSS content and writes it into markup | Fixed |
| TCA-10 | Low | Glob recompiled on every call (O(tokens × patterns) on large sites) | Fixed |
| TCA-11 | Low | Correctness bugs: `pointer-fine:` variant, numeric class names, closing-tag offset bug | Fixed |
| TCA-12 | Low | Quadratic scans and repeated Set construction in hot loops | Mostly fixed |
| TCA-13 | Info | Supply-chain hardening opportunities in CI/publish workflows | Not changed |

---

## TCA-01 — Path traversal in `outputCss` / `manifestFile` / `dictionaryFile`

**Severity:** High (arbitrary file overwrite/deletion with attacker-influenced content).

`src/config.js` merged `tailclass.config.json` into the effective config without any
validation, and `src/rewriter.js` / `src/index.js` resolved those values with a plain
`path.resolve(absRoot, value)`. A relative path containing `..` therefore escaped the
scanned project.

```jsonc
// tailclass.config.json committed in a repository
{
  "outputCss": "../../home/user/.bashrc",
  "manifestFile": "../../home/user/.profile"
}
```

```console
$ npx tailclass apply .
✔ Wrote centralized stylesheet to ../tpwned.css     # written outside the project
```

Impact:

* `apply` overwrites arbitrary files with generated CSS/JSON (content is partly
  attacker-controlled, see TCA-02/TCA-05).
* `list` writes the dictionary wherever `dictionaryFile` points.
* `revert --clean` **deletes** `outputCss` and `manifestFile`; with a stylesheet-shaped
  target this removed files outside the project root (reproduced: exit code 0,
  "Removed centralized stylesheet and manifest").

Fix:

* `resolveConfig()` now validates every writable path (`validateOutputPath`) and rejects
  anything that resolves outside the project root — *unless the path was supplied
  explicitly on the command line* (`--output`, `--dict`, `--report`), which is treated
  as deliberate user intent and recorded in `config.pathSources`.
* `resolveWritablePath()` re-checks confinement at every write site (`apply`,
  `list`, `revert`, including the `--clean` unlink branch), so the library API is safe
  even for hand-built config objects.
* Paths are also rejected when they are empty, contain NUL bytes, or name a directory.

Tests: `test/security.test.js` → "config files cannot redirect generated output outside
the project root".

## TCA-02 — CSS injection via `@apply` payloads

**Severity:** High (arbitrary CSS, e.g. hiding the whole page or exfiltrating data via
`url()`), triggered by markup alone.

Arbitrary-value utilities were accepted as applyable whenever they matched
`...\[.+\]`, so a class token could contain `;`, `{`, `}`:

```html
<div class="p-4 bg-white rounded text-[red;}html{display:none}] flex items-center gap-2">
```

Produced:

```css
.inline-row {
  @apply flex items-center gap-2 p-4 text-[red;}html{display:none}] bg-white rounded;
}
```

The `}` closes the declaration and `html{display:none}` escapes into the stylesheet
(inside `@layer components`, which still applies). The same primitive can smuggle
`@import` / `url(...)` payloads.

Fix:

* New module `src/css-safety.js`: `isCssSafeToken()` rejects `;`, `{`, `}`, control
  characters and comment terminators.
* `classifyToken()` classifies such tokens as **custom (inline) classes**: they are
  preserved on the element, so nothing breaks visually, but they never reach `@apply`.
* `generateStylesheet()` independently filters the payload and refuses to emit a rule
  whose selector or `@apply` list is unsafe (defence in depth for third-party callers).

Tests: `test/security.test.js` → "CSS-breaking utility tokens are kept inline…" and
".classifier never marks CSS-unsafe tokens as applyable".

## TCA-03 — ReDoS in the glob matcher

**Severity:** High (denial of service; the process never returns).

`globSegmentToRegExp()` translated every `**` into `.*` and adjacent wildcards were kept,
so `**` repeated N times compiled to `.*.*.*…x`. A failing match then backtracks
combinatorially. Patterns come from `include` / `exclude` / `excludeClasses` /
`includeClasses` / `excludePatterns` and from `rules[].mustInclude`, all of which a
committed config can set.

```jsonc
{ "exclude": ["******************************************************************************z"] }
```

```console
$ npx tailclass apply .     # pre-fix: still running after >120s, 200-character filename
```

Fix:

* `src/glob.js` now compiles patterns to tokens (`lit`, `any`, `star`, `globstar`,
  `globstarDir`, `class`) and matches them with a dynamic-programming pass that is
  `O(pattern × candidate)` — **no backtracking**, so worst-case time is bounded and
  predictable.
* Compiled matchers are cached (`GLOB_CACHE_LIMIT`), patterns are length-capped
  (`MAX_GLOB_PATTERN_LENGTH = 1024`), NUL bytes rejected, and braces are still expanded.
* Documented semantics (`**`, `**/`, `*`, `?`, `[a-z]`, `[!…]`, `{a,b}`, basename
  fallback, `!negation`) are preserved; a 22-case equivalence table plus pathological
  timing tests live in `test/glob.test.js`.

Measured: the pattern above now completes in ~2 ms; 200k cached matches run in ~0.3 s.

## TCA-04 — `classPrefix` injection

**Severity:** Medium (CSS injection + corrupted markup).

`formatClassName()` concatenated `config.classPrefix` verbatim:

```jsonc
{ "classPrefix": "ui-}body{display:none}/*" }
```

```css
.ui-}body{display:none}/*inline-row {
  @apply …
}
```

and wrote the same string into every rewritten `class` attribute.

Fix: `resolveConfig()` rejects prefixes outside `^[A-Za-z0-9_-]*$` and prefixes that
would make a selector start with a digit; `formatClassName()` sanitizes again;
`tailwindPrefix` receives the same validation. `generateStylesheet()` refuses invalid
selectors regardless of origin.

## TCA-05 — Dictionary metadata injected into CSS comments

**Severity:** Medium (CSS injection from a committed `tailclass.map.json`, which
`apply` auto-loads without any flag).

`label`, `category` and `elements` from dictionary entries were written straight into
`/* … */` comments:

```jsonc
{ "mappings": [{ "classes": "p-6 shadow-lg", "customName": "evil",
                 "label": "x */ body{display:none} /*" }] }
```

```css
/* x */ body{display:none} /* */
.evil { @apply p-6 shadow-lg; }
```

Fix: `sanitizeCommentText()` (comment terminators escaped, braces/control characters
stripped, length-capped) is applied in `src/dictionary.js` (labels, categories, element
hints) **and** in `src/generator.js` for every comment it emits, so any other caller is
covered too.

## TCA-06 — Generated files clobber project sources

**Severity:** Medium (silent data loss; needs no traversal).

Two independent cases were reproduced:

1. `"outputCss": "page.html"` replaced a real page with the stylesheet.
2. `"outputCss": "styles.css"` replaced a hand-written stylesheet; the tool even read
   it as if it were its own output to merge rules from.

Fix:

* `apply` refuses to write when `outputCss`/`manifestFile` collide with a scanned
  source file.
* Existing targets are inspected first: a stylesheet is only overwritten when it is
  empty, carries the `Generated by TailClass` header, or contains `@apply` rules; a
  manifest only when it parses as `{ mappings: … }`. Otherwise the run aborts with a
  message pointing at `--force` (new `force` option, plumbed through the CLI and the
  TypeScript types).

## TCA-07 — Invalid regex from glob character classes

**Severity:** Medium (crash with a raw `SyntaxError`, no actionable message).

`compileGlob("[")` emitted `^[$`, throwing `Invalid regular expression: … Unterminated
character class` from deep inside scanning. Since patterns are config-supplied, this was
a trivial way to break `apply`/`scan` in CI.

Fix: the tokenizer treats an unterminated or descending/invalid `[` class as a literal
`[`. Covered in `test/glob.test.js`.

## TCA-08 — Configuration validation

**Severity:** Medium (robustness; no error provenance).

Before:

```console
$ tailclass apply .
Error: Cannot read properties of null (reading 'startsWith')     # exclude: ["dist/**", null]
Error: Unexpected token '}', "{"exclude": [}" is not valid JSON  # no file name
```

Additionally `minOccurrences: "abc"` silently fell back to the default, booleans
accepted arbitrary truthy values, and unknown keys were ignored silently.

Fix (`src/config.js`):

* arrays are validated element-by-element with index in the message; a lone string is
  coerced to a one-item array; glob length/NUL limits enforced;
* numeric thresholds must be numeric (`Invalid minClasses: expected a number …`) and are
  clamped to their documented minimum;
* booleans accept `true/false/"true"/"false"/"1"/"0"` and are normalised;
* `classPrefix`/`tailwindPrefix` are validated (see TCA-04);
* JSON parse failures name the file (`Invalid JSON in /path/tailclass.config.json: …`);
* unknown keys produce warnings, printed to **stderr** by the CLI so `--json` output
  stays machine-readable;
* malformed `rules` entries are skipped with a warning instead of crashing the namer;
* `.git/`, `node_modules/` and `.tailclass-backup/` are always excluded — even when
  `replaceDefaultExcludes: true` — so a committed config cannot make `apply` rewrite
  version-control internals or installed dependencies.

## TCA-09 — `revert` trusts manifest/CSS content

**Severity:** Low (requires a hostile manifest and a project where it is followed by
`revert`).

`revertSource()` expanded whatever string the manifest mapped a class to, inserting it
verbatim into markup — `"tc-evil": "p-4\" onmouseover=\"alert(1)"` injected an
attribute. Manifest keys were also unrestricted.

Fix: manifest JSON errors are reported with the file name; non-string values, keys that
are not valid class identifiers, and expansions containing `"`, `<`, `>`, backticks or
control characters are dropped before rewriting.

## TCA-10 / TCA-12 — Performance

* `matchesAnyGlob()` compiled each glob on **every** call, i.e. per class token and per
  naming-rule predicate. Compiled matchers are now cached (TCA-10).
* `analyzer` rebuilt a `Set` of occurrence tokens inside nested subset loops and used
  `array.includes()` in an O(n) scan; token sets are memoised per occurrence and
  membership uses `Set` (TCA-12).
* `findFiles()` filters non-string patterns defensively.

Remaining (documented, not fixed): the scanner's comment/coverage range lookups are
linear scans, so a single pathological multi-megabyte file with thousands of helper
calls is still super-linear; the analyzer caps pairwise shared-base comparisons at 80
occurrences per tag. Both are bounded in practice and would need interval indexes to
improve further.

## TCA-11 — Correctness bugs fixed along the way

* `pointer-fine:` was unreachable in `VALID_VARIANT_RE` because of a stray leading space
  (`| pointer-fine|`), so `pointer-fine:*` utilities were treated as custom classes.
* `sanitizeCustomClassName("123btn")` produced `.123btn`, an invalid CSS selector;
  numeric names are now prefixed with `tc-`.
* `<style>` / `<textarea>` skipping searched `source.toLowerCase()`, whose offsets can
  diverge from the original string (Unicode case folding) and which re-allocated the
  whole file per tag. Replaced with an anchored, case-insensitive scan that returns
  original offsets.
* `revertSource()` parsed the manifest with a bare `JSON.parse` (raw error, no file name).

## TCA-13 — Supply-chain notes (not changed)

* Workflows pin `actions/*` to mutable major tags (`@v7`). Pinning to commit SHAs is the
  usual hardening step for a package that publishes with OIDC provenance.
* `publish.yml` runs `npm install -g npm@latest` inside the publishing job; a compromised
  future npm release would execute there. Pinning an exact npm version (or using the
  bundled one) narrows that window. Note the job itself is least-privilege
  (`id-token: write` only, `persist-credentials: false`) — that part is good.
* Symlinks are deliberately **not** followed by `findFiles()` (a symlink inside the
  project could otherwise redirect a write outside it). The trade-off is that
  symlinked sources are silently skipped; worth documenting in the README if users hit it.

---

## Behaviour changes to be aware of

1. Repository-supplied `outputCss` / `dictionaryFile` / `manifestFile` must stay inside
   the project root. Use the CLI flags for deliberate out-of-root targets.
2. Invalid configuration now fails loudly instead of being silently coerced.
3. Tokens containing `;`, `{`, `}` or `*/` (and control characters) are never extracted
   into `@apply`; they stay inline on the element.
4. `apply` will not overwrite a file that does not look like TailClass output unless
   `--force` is passed.
5. `.git/`, `node_modules/` and `.tailclass-backup/` are always excluded, even with
   `replaceDefaultExcludes`.
6. Glob semantics are unchanged, but pathological patterns now run in linear time.

## Regression tests

| Finding | Test |
| --- | --- |
| TCA-01, TCA-06 | `test/security.test.js` (traversal, clobbering) |
| TCA-02, TCA-04, TCA-05 | `test/security.test.js` (CSS injection, prefix, dictionary) |
| TCA-03, TCA-07, TCA-10 | `test/glob.test.js` |
| TCA-08 | `test/security.test.js` (config errors, warnings) |
| TCA-09, TCA-11 | `test/security.test.js`, `test/tailwind.test.js` |

Run everything with `npm run check`.

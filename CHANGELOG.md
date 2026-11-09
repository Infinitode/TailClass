# Changelog

All notable changes to **TailClass** are documented here. The format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Security & robustness hardening. All items are covered by regression tests; see
[`docs/security-review.md`](docs/security-review.md) for proofs of concept and rationale.

### Security

- **Path confinement (High).** `outputCss`, `dictionaryFile` and `manifestFile` coming
  from a configuration file can no longer resolve outside the scanned project root, so a
  cloned repository can no longer make `apply`/`list` write — or `revert --clean` delete —
  arbitrary files. CLI-supplied paths remain unrestricted. Writes now go through a single
  checked resolver (`resolveWritablePath`).
- **CSS injection (High).** Class tokens containing `;`, `{`, `}`, control characters or
  comment terminators are no longer treated as applyable utilities; they are preserved
  inline on the element instead of being emitted into `@apply`. The stylesheet generator
  independently validates selectors and payloads.
- **ReDoS (High).** The glob matcher is now a backtracking-free dynamic-programming
  matcher (`O(pattern × candidate)`) instead of a translated `RegExp`. Pathological
  patterns such as `****…z` used to hang the process; they now finish in milliseconds.
  Compiled matchers are cached and patterns are length-capped.
- **`classPrefix` injection (Medium).** Prefixes must match `^[A-Za-z0-9_-]*$` and may not
  produce a selector starting with a digit; they are sanitized again in the namer.
- **Dictionary comment injection (Medium).** `label`, `category` and `elements` values are
  sanitized before being embedded in generated CSS comments.
- **`revert` hardening (Low).** Manifest entries that are not valid class names, or whose
  expansion could break out of a markup attribute, are ignored; corrupt manifests produce
  a descriptive error.

### Added

- `src/css-safety.js` — shared validators/sanitizers (`isCssSafeToken`,
  `isValidClassIdentifier`, `sanitizeCommentText`, `sanitizeElementName`,
  `sanitizeClassPrefix`).
- `--force` for `apply`/`revert`: required before overwriting a stylesheet or manifest that
  does not look like TailClass output.
- Configuration diagnostics: unknown keys and coerced values are reported as warnings on
  **stderr** (keeping `--json` stdout machine-readable).
- Tests: `test/glob.test.js` (glob semantics, ReDoS timings, caching) and
  `test/security.test.js` (traversal, clobbering, CSS injection, config validation).

### Changed

- Configuration is validated up front: array entries, numeric thresholds, booleans,
  enums and prefixes produce actionable errors (`Invalid exclude[1]: expected a string,
  received null`) instead of `TypeError`s, and JSON parse errors name the offending file.
- `apply` refuses to overwrite a scanned source file, or a stylesheet/manifest that it
  does not own (unless `--force`).
- `.git/`, `node_modules/` and `.tailclass-backup/` are always excluded, even when
  `replaceDefaultExcludes` is `true`.
- `revertProject()` now returns the resolved `config` (like the other workflows);
  `config.warnings` and `config.pathSources` are available to API consumers.
- Unknown `rules` entries are skipped with a warning rather than throwing.

### Fixed

- `pointer-fine:*` utilities are recognised again (a stray space made the variant
  unreachable).
- Numeric custom class names (`"123btn"`) are prefixed (`tc-123btn`) so selectors stay
  valid CSS.
- `<style>` / `<textarea>` skipping uses an anchored case-insensitive scan, so offsets
  stay correct on files containing Unicode case-folding characters.
- Analyzer subset matching memoises occurrence token sets and uses `Set` membership
  instead of `Array#includes`.

## [1.0.0] — 2026-11-08

Initial open-source release of **TailClass**.

### Added

- **Multi-framework site scanner (`src/scanner.js`)** — brace- and quote-aware parser supporting HTML, JSX/TSX, Vue, Svelte, Astro, PHP/Blade, EJS, ERB, Nunjucks, Twig, Liquid, and Jinja templates, plus static literals inside `clsx()`, `cn()`, `twMerge()`, `classNames()`, and `cva()`.
- **Tailwind CSS v3 & v4 utility classifier (`src/tailwind.js`)** — canonical order-independent utility sorting, stacked responsive/state/container/arbitrary variants, negative & `!important` modifiers, custom `tailwindPrefix`, and automatic inline preservation of non-`@apply` markers (`group`, `peer`, `dark`) and custom JS/BEM classes.
- **Smart visual & structural naming engine (`src/namer.js`)** — scores DOM element context (`<nav>`, `<header>`, `<button>`, `<input>`, `role`, ancestors) alongside visual CSS traits to assign human-readable names (`navbar`, `navbar-brand`, `nav-menu`, `nav-link`, `btn-primary`, `btn-outline`, `btn-danger`, `card`, `grid-3col`, `badge-success`, `avatar`, `form-input`, `modal-backdrop`, `modal-dialog`, `sidebar`, `site-footer`, etc.) with automatic variant disambiguation (`card-dark`, `card-elevated`).
- **Smart subset & shared-base layout matching (`src/analyzer.js`)** — extracts repeated component foundations even when individual elements include extra spacing or ring utilities (e.g. `class="card ring-2 ring-indigo-600"`).
- **Class List Mode & custom dictionaries (`src/dictionary.js`)** — `tailclass list` audits total classes, unique utilities, occurrence counts, and exact file/line locations, generating an editable `tailclass.map.json` (plus optional `.md` and `.csv` exports) that merges user `customName` and `enabled` choices across runs. Also accepts flat `{ "classes or autoName": "custom-name" }` JSON maps.
- **Centralized stylesheet generator & surgical rewriter (`src/generator.js`, `src/rewriter.js`)** — emits categorized `tailwind-v3`, `tailwind-v4`, or `plain` `@apply` stylesheets, supports `--dry-run`, `--backup`, incremental idempotent re-runs, and one-command `tailclass revert`.
- **Granular rules & filtering (`src/config.js`, `src/glob.js`)** — `include`, `exclude`, `excludeClasses`, `includeClasses`, `excludePatterns` (`tc-ignore`), `ignoreTags`, `onlyTags`, `minOccurrences`, `minClasses`, `minFiles`, `namingStyle` (`kebab`, `bem`, `camel`), `classPrefix`, and custom heuristic `rules`.
- **CLI & dual CJS/ESM Node.js API** with bundled TypeScript declarations (`types/index.d.ts`) and JSON Schemas (`schema/`).

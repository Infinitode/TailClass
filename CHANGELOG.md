# Changelog

All notable changes to **TailClass** are documented here. The format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

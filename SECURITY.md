# Security Policy

TailClass scans and rewrites source code files on disk when `tailclass apply` or
`tailclass revert` is invoked. Correctness, path confinement, and deterministic
rewriting are treated seriously.

## Hardening guarantees

TailClass treats the scanned project, including `tailclass.config.json` and
`tailclass.map.json`, as **untrusted input**, because those files arrive with the
repository you clone.

- **Path confinement.** `outputCss`, `dictionaryFile` and `manifestFile` taken from a
  configuration file must resolve inside the scanned project root; paths that escape it
  are rejected before anything is written or deleted. Paths supplied explicitly on the
  command line (`--output`, `--dict`, `--report`) are honoured as-is.
- **Physical path confinement.** The root check is not merely lexical (`../`):
  every existing component of an output path is `lstat`ed and resolved with
  `realpath` against the real project root. A directory symlink planted in a cloned
  repository (or a symlinked output file) can no longer redirect a write, read,
  backup or `revert --clean` deletion outside the project. Writes use
  `O_NOFOLLOW` and re-validate after creating parent directories; symlinks that
  resolve inside the root are still allowed.
- **No clobbering.** `apply` refuses to overwrite a scanned source file, or a
  stylesheet/manifest that does not look like TailClass output, unless `--force` is
  given.
- **No arbitrary deletion.** `revert --clean` deletes only regular files TailClass
  can positively identify as its own (generated CSS header, or `@apply` rules
  matching an owned revert manifest). Foreign stylesheets, foreign JSON files,
  scanned source files, symlinks and directories are left untouched and reported
  via `cleanupSkipped`/stderr. `--force` does not override this.
- **CSS payload validation.** Class tokens containing `;`, `{`, `}`, control characters
  or comment terminators are kept inline on the element and never emitted into
  `@apply`; selectors, comments and dictionary metadata are validated on output.
- **Bounded matching.** Globs are matched with a backtracking-free algorithm, so
  repository-supplied patterns cannot hang the process. Symlinks are never followed out
  of the project.

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.0.2+  | ✅        |
| 1.0.1   | ❌ superseded — upgrade for the v1.0.2 symlink / `--clean` fixes |
| 1.0.0   | ❌ superseded — upgrade for the v1.0.1 security fixes |
| < 1.0   | ❌        |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/Infinitode/TailClass/security/advisories/new)
or by email to **infinitode.ltd@gmail.com**.

Please include:

- the affected TailClass version and Node.js version,
- a minimal reproduction (sample input file, config, or dictionary JSON),
- the impact you believe it has.

We aim to acknowledge reports within 5 working days and to publish a fixed
release plus an advisory once a fix is available. Please give us a reasonable
window to ship a fix before any public disclosure.

## Scope

In scope:

- arbitrary file overwrite, deletion or path traversal outside the target project root caused by crafted configuration, dictionary or manifest files — including symlink-based traversal;
- deletion of non-TailClass files by `revert --clean`;
- catastrophic backtracking (ReDoS) or denial of service in the markup scanner, glob matcher, or Tailwind token parser;
- CSS injection or source corruption triggered by unsanitized dictionary values;
- supply-chain issues in the repository's build or release workflows.

Out of scope:

- vulnerabilities in Node.js, Tailwind CSS, or PostCSS themselves (please report those upstream);
- styling differences introduced when a user manually edits generated `@apply` rules after extraction.

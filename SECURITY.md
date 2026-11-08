# Security Policy

TailClass scans and rewrites source code files on disk when `tailclass apply` or
`tailclass revert` is invoked. Correctness, path confinement, and deterministic
rewriting are treated seriously.

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅        |
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

- arbitrary file overwrite or path traversal outside the target project root caused by crafted configuration or dictionary files;
- catastrophic backtracking (ReDoS) or denial of service in the markup scanner, glob matcher, or Tailwind token parser;
- CSS injection or source corruption triggered by unsanitized dictionary values;
- supply-chain issues in the repository's build or release workflows.

Out of scope:

- vulnerabilities in Node.js, Tailwind CSS, or PostCSS themselves (please report those upstream);
- styling differences introduced when a user manually edits generated `@apply` rules after extraction.

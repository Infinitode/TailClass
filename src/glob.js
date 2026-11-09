"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Longest glob pattern TailClass will compile. Patterns come from
 * `tailclass.config.json`, which is repository-supplied, so they are treated as
 * untrusted input.
 */
const MAX_GLOB_PATTERN_LENGTH = 1024;

/** Upper bound for the compiled-matcher cache (prevents unbounded growth). */
const GLOB_CACHE_LIMIT = 2000;

/** @type {Map<string, { tokens: Array<object> }>} */
const matcherCache = new Map();

/**
 * Normalize any filesystem path to forward-slash POSIX notation.
 * @param {string} p
 * @returns {string}
 */
function toPosixPath(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Expand single-level brace expressions such as `src/*.{html,jsx,tsx}` into
 * individual glob strings before compiling.
 * @param {string} pattern
 * @returns {string[]}
 */
function expandBraces(pattern) {
  const openIdx = pattern.indexOf("{");
  if (openIdx === -1) return [pattern];

  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < pattern.length; i++) {
    if (pattern[i] === "{") depth++;
    else if (pattern[i] === "}") {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx === -1) return [pattern];

  const prefix = pattern.slice(0, openIdx);
  const body = pattern.slice(openIdx + 1, closeIdx);
  const suffix = pattern.slice(closeIdx + 1);

  const alternatives = [];
  let start = 0;
  let innerDepth = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "{") innerDepth++;
    else if (body[i] === "}") innerDepth--;
    else if (body[i] === "," && innerDepth === 0) {
      alternatives.push(body.slice(start, i));
      start = i + 1;
    }
  }
  alternatives.push(body.slice(start));

  const results = [];
  for (const alt of alternatives) {
    for (const expanded of expandBraces(prefix + alt + suffix)) {
      results.push(expanded);
    }
  }
  return results;
}

/**
 * Parse a glob character class body (`a-z0-9_`) into ranges.
 * Returns `null` when the body is not a usable character class.
 * @param {string} body
 * @returns {{ ranges: Array<[string, string]> } | null}
 */
function parseCharClass(body) {
  if (!body) return null;
  const ranges = [];
  let i = 0;
  while (i < body.length) {
    const start = body[i];
    if (i + 2 < body.length && body[i + 1] === "-") {
      const end = body[i + 2];
      // Reject descending ranges and `-` used as an endpoint.
      if (start === "-" || end === "-" || start > end) return null;
      ranges.push([start, end]);
      i += 3;
      continue;
    }
    if (start === "-") return null;
    ranges.push([start, start]);
    i += 1;
  }
  return { ranges };
}

/**
 * Tokenize a brace-free glob pattern. The resulting token list is matched with
 * a dynamic-programming matcher (see `matchTokens`) so wildcard matching is
 * linear in `pattern.length * candidate.length` — never exponential.
 * @param {string} pattern
 * @returns {Array<object>}
 */
function tokenizeGlob(pattern) {
  const tokens = [];
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          tokens.push({ t: "globstarDir" });
          i += 3;
          continue;
        }
        tokens.push({ t: "globstar" });
        i += 2;
        continue;
      }
      tokens.push({ t: "star" });
      i += 1;
      continue;
    }

    if (ch === "?") {
      tokens.push({ t: "any" });
      i += 1;
      continue;
    }

    if (ch === "[") {
      const close = pattern.indexOf("]", i + 1);
      if (close !== -1) {
        let body = pattern.slice(i + 1, close);
        let neg = false;
        if (body.startsWith("!") || body.startsWith("^")) {
          neg = true;
          body = body.slice(1);
        }
        const parsed = parseCharClass(body);
        if (parsed) {
          tokens.push({ t: "class", neg, ranges: parsed.ranges });
          i = close + 1;
          continue;
        }
      }
      // Unterminated/invalid class -> treat `[` as a literal character.
      tokens.push({ t: "lit", c: "[" });
      i += 1;
      continue;
    }

    tokens.push({ t: "lit", c: ch });
    i += 1;
  }

  return tokens;
}

/**
 * @param {{ ranges: Array<[string, string]> }} token
 * @param {string} ch
 * @returns {boolean}
 */
function classContains(token, ch) {
  for (const [start, end] of token.ranges) {
    if (ch >= start && ch <= end) return true;
  }
  return false;
}

// Reusable scratch buffers so hot matching loops do not allocate per call.
let scratchA = new Uint8Array(0);
let scratchB = new Uint8Array(0);
let scratchSlash = new Int32Array(0);

/**
 * @param {number} size
 */
function ensureScratch(size) {
  if (scratchA.length < size) {
    scratchA = new Uint8Array(size);
    scratchB = new Uint8Array(size);
    scratchSlash = new Int32Array(size);
  }
}

/**
 * Backtracking-free glob matcher.
 *
 * `dp` holds, for the already-processed token suffix, whether the remaining
 * candidate (from index `j` on) matches. Each token pass is O(candidate length).
 *
 * @param {Array<object>} tokens
 * @param {string} target
 * @returns {boolean}
 */
function matchTokens(tokens, target) {
  const m = target.length;
  const n = tokens.length;

  ensureScratch(m + 1);
  const nextSlash = scratchSlash;

  // next[j] === 1 when tokens[i + 1 ..] matches target[j ..]
  let next = scratchA;
  let cur = scratchB;
  next.fill(0, 0, m + 1);
  cur.fill(0, 0, m + 1);
  next[m] = 1;

  for (let i = n - 1; i >= 0; i--) {
    const tok = tokens[i];
    cur.fill(0, 0, m + 1);

    switch (tok.t) {
      case "lit":
        for (let j = m - 1; j >= 0; j--) {
          cur[j] = target.charCodeAt(j) === tok.c.charCodeAt(0) && next[j + 1] ? 1 : 0;
        }
        break;

      case "any":
        for (let j = m - 1; j >= 0; j--) {
          cur[j] = target[j] !== "/" && next[j + 1] ? 1 : 0;
        }
        break;

      case "star": // matches any run of characters except `/`
        for (let j = m; j >= 0; j--) {
          cur[j] = next[j] || (j < m && target[j] !== "/" && cur[j + 1]) ? 1 : 0;
        }
        break;

      case "globstar": // matches anything, including `/`
        for (let j = m; j >= 0; j--) {
          cur[j] = next[j] || (j < m && cur[j + 1]) ? 1 : 0;
        }
        break;

      case "globstarDir": {
        // matches zero or more whole path segments, i.e. `(?:[^/]+/)*`
        let slash = m;
        for (let j = m; j >= 0; j--) {
          if (j < m && target[j] === "/") slash = j;
          nextSlash[j] = slash;
        }
        for (let j = m; j >= 0; j--) {
          if (next[j]) {
            cur[j] = 1;
          } else if (j < m && target[j] !== "/") {
            const k = nextSlash[j];
            cur[j] = k < m && target[k] === "/" && cur[k + 1] ? 1 : 0;
          } else {
            cur[j] = 0;
          }
        }
        break;
      }

      case "class":
        for (let j = m - 1; j >= 0; j--) {
          const ch = target[j];
          if (ch === "/") {
            cur[j] = 0;
            continue;
          }
          const inClass = classContains(tok, ch);
          cur[j] = (inClass !== tok.neg && next[j + 1]) ? 1 : 0;
        }
        break;

      default:
        break;
    }

    const swap = next;
    next = cur;
    cur = swap;
  }

  return next[0] === 1;
}

/**
 * Reject patterns that are unreasonable to compile (repository-supplied).
 * @param {string} pattern
 */
function assertValidPattern(pattern) {
  if (typeof pattern !== "string") {
    throw new Error("Glob pattern must be a string.");
  }
  if (pattern.length > MAX_GLOB_PATTERN_LENGTH) {
    throw new Error(
      `Glob pattern is too long (${pattern.length} characters, max ${MAX_GLOB_PATTERN_LENGTH}).`
    );
  }
  if (pattern.includes("\u0000")) {
    throw new Error("Glob pattern contains a NUL byte.");
  }
}

/**
 * Compile a single brace-free glob pattern into a token list (cached).
 * @param {string} pattern
 * @returns {Array<object>}
 */
function getTokens(pattern) {
  const cached = matcherCache.get(pattern);
  if (cached) return cached.tokens;

  assertValidPattern(pattern);
  const tokens = tokenizeGlob(pattern);

  if (matcherCache.size >= GLOB_CACHE_LIMIT) matcherCache.clear();
  matcherCache.set(pattern, { tokens });
  return tokens;
}

/**
 * Compile a glob string (supporting `{a,b}`, `**`, `*`, `?`, `[...]`) into a
 * matcher. Compiled matchers are cached, so calling this repeatedly with the
 * same pattern is cheap.
 *
 * @param {string} pattern
 * @returns {(candidate: string) => boolean}
 */
function compileGlob(pattern) {
  assertValidPattern(String(pattern));
  const normalized = toPosixPath(pattern);
  const variants = expandBraces(normalized).map((p) => {
    assertValidPattern(p);
    const hasSlash = p.includes("/");
    if (!/[*?[]/.test(p)) {
      return { kind: "literal", value: p, hasSlash };
    }
    // `*suffix` / `prefix*` are extremely common in exclude lists such as
    // `*.min.js` or `js-*`; match them without the general DP.
    const suffixOnly = /^\*([^*?[\]]+)$/.exec(p);
    if (suffixOnly) return { kind: "suffix", value: suffixOnly[1], hasSlash };
    const prefixOnly = /^([^*?[\]]+)\*$/.exec(p);
    if (prefixOnly) return { kind: "prefix", value: prefixOnly[1], hasSlash };
    return { kind: "tokens", tokens: getTokens(p), hasSlash };
  });

  const matchVariant = (variant, str) => {
    switch (variant.kind) {
      case "literal":
        return str === variant.value;
      case "suffix": {
        if (!str.endsWith(variant.value)) return false;
        const head = str.slice(0, str.length - variant.value.length);
        return !head.includes("/");
      }
      case "prefix": {
        if (!str.startsWith(variant.value)) return false;
        return !str.slice(variant.value.length).includes("/");
      }
      default:
        return matchTokens(variant.tokens, str);
    }
  };

  return (candidate) => {
    const target = toPosixPath(candidate);
    const basename = target.includes("/") ? target.slice(target.lastIndexOf("/") + 1) : target;
    for (const variant of variants) {
      if (matchVariant(variant, target)) return true;
      if (!variant.hasSlash && basename !== target && matchVariant(variant, basename)) return true;
    }
    return false;
  };
}

/**
 * Drop cached matchers. Exposed mainly for tests and long-lived processes that
 * build patterns dynamically.
 */
function clearGlobCache() {
  matcherCache.clear();
}

/**
 * Test whether a candidate string (file path or class token) matches any
 * pattern in a list of globs. Supports `!negated` entries as well.
 * @param {string} candidate
 * @param {string[]} patterns
 * @returns {boolean}
 */
function matchesAnyGlob(candidate, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  let matched = false;
  for (const raw of patterns) {
    if (!raw || typeof raw !== "string") continue;
    if (raw.startsWith("!")) {
      if (compileGlob(raw.slice(1))(candidate)) matched = false;
    } else if (compileGlob(raw)(candidate)) {
      matched = true;
    }
  }
  return matched;
}

/**
 * Extract directory names that can be skipped completely before descending
 * when exclusions look like `node_modules/**` or `.git/**`.
 * @param {string[]} excludePatterns
 * @returns {Set<string>}
 */
function extractPrunableDirs(excludePatterns) {
  const set = new Set();
  for (const raw of excludePatterns || []) {
    if (typeof raw !== "string" || raw.startsWith("!")) continue;
    const norm = toPosixPath(raw);
    const m = norm.match(/^(?:\*\*\/)?([a-zA-Z0-9._-]+)\/\*\*$/);
    if (m) set.add(m[1]);
  }
  return set;
}

/**
 * Walk a root directory and return sorted relative POSIX file paths matching
 * `include` and not matching `exclude`.
 * @param {string} rootDir
 * @param {{ include?: string[], exclude?: string[] }} [options]
 * @returns {string[]}
 */
function findFiles(rootDir, options = {}) {
  const absRoot = path.resolve(rootDir);
  if (!fs.existsSync(absRoot)) {
    return [];
  }

  const stat = fs.statSync(absRoot);
  if (stat.isFile()) {
    return [path.basename(absRoot)];
  }

  const include = options.include && options.include.length > 0 ? options.include : ["**/*"];
  const exclude = (options.exclude || []).filter((p) => typeof p === "string");
  const prunableDirs = extractPrunableDirs(exclude);

  const includeMatchers = include
    .filter((p) => typeof p === "string" && !p.startsWith("!"))
    .map(compileGlob);
  const negatedIncludeMatchers = include
    .filter((p) => typeof p === "string" && p.startsWith("!"))
    .map((p) => compileGlob(p.slice(1)));
  const excludeMatchers = exclude.filter((p) => !p.startsWith("!")).map(compileGlob);

  const matchedFiles = [];

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = toPosixPath(path.relative(absRoot, fullPath));

      if (entry.isDirectory()) {
        if (prunableDirs.has(entry.name)) continue;
        if (excludeMatchers.some((fn) => fn(relPath) || fn(relPath + "/index"))) continue;
        walk(fullPath);
        continue;
      }

      // Symlinks are intentionally not followed: writing through a symlink could
      // escape the project root.
      if (!entry.isFile()) continue;

      if (excludeMatchers.some((fn) => fn(relPath))) continue;
      if (negatedIncludeMatchers.some((fn) => fn(relPath))) continue;
      if (includeMatchers.some((fn) => fn(relPath))) {
        matchedFiles.push(relPath);
      }
    }
  }

  walk(absRoot);
  return matchedFiles;
}

module.exports = {
  MAX_GLOB_PATTERN_LENGTH,
  toPosixPath,
  expandBraces,
  compileGlob,
  clearGlobCache,
  matchesAnyGlob,
  findFiles,
};

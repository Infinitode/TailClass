"use strict";

const fs = require("node:fs");
const path = require("node:path");

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
 * individual glob strings before compiling to RegExp.
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
 * Compile a single brace-free glob pattern to a RegExp.
 * @param {string} rawPattern
 * @returns {RegExp}
 */
function globSegmentToRegExp(rawPattern) {
  const pattern = toPosixPath(rawPattern.trim());
  let re = "^";
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          re += "(?:.+/)?";
          i += 3;
          continue;
        }
        re += ".*";
        i += 2;
        continue;
      }
      re += "[^/]*";
      i++;
      continue;
    }

    if (ch === "?") {
      re += "[^/]";
      i++;
      continue;
    }

    if (ch === "[") {
      const close = pattern.indexOf("]", i + 1);
      if (close !== -1) {
        let content = pattern.slice(i + 1, close);
        if (content.startsWith("!")) {
          content = "^" + content.slice(1);
        }
        re += "[" + content + "]";
        i = close + 1;
        continue;
      }
    }

    if ("\\.^$+()|{}".includes(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
    i++;
  }

  re += "$";
  return new RegExp(re);
}

/**
 * Compile a glob string (supporting `{a,b}`, `**`, `*`, `?`) into a matcher.
 * @param {string} pattern
 * @returns {(candidate: string) => boolean}
 */
function compileGlob(pattern) {
  const normalized = toPosixPath(pattern);
  const regexes = expandBraces(normalized).map(globSegmentToRegExp);
  return (candidate) => {
    const target = toPosixPath(candidate);
    const basename = path.posix.basename(target);
    const hasSlash = normalized.includes("/");
    for (const rx of regexes) {
      if (rx.test(target)) return true;
      if (!hasSlash && rx.test(basename)) return true;
    }
    return false;
  };
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
      const negMatcher = compileGlob(raw.slice(1));
      if (negMatcher(candidate)) matched = false;
    } else {
      const posMatcher = compileGlob(raw);
      if (posMatcher(candidate)) matched = true;
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
  const exclude = options.exclude || [];
  const prunableDirs = extractPrunableDirs(exclude);

  const includeMatchers = include.filter((p) => !p.startsWith("!")).map(compileGlob);
  const negatedIncludeMatchers = include
    .filter((p) => p.startsWith("!"))
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
  toPosixPath,
  expandBraces,
  compileGlob,
  matchesAnyGlob,
  findFiles,
};

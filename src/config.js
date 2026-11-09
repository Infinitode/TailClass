"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { toPosixPath, MAX_GLOB_PATTERN_LENGTH } = require("./glob");
const { sanitizeClassPrefix } = require("./css-safety");
const {
  assertNoSymlinkEscape,
  ensureParentDirectory,
  unlinkRegularFile,
  writeFileNoFollow,
} = require("./fs-safety");

const DEFAULT_CONFIG = Object.freeze({
  include: [
    "**/*.{html,htm,jsx,tsx,js,ts,mjs,cjs,vue,svelte,astro,php,erb,ejs,hbs,mustache,twig,njk,liquid,jinja,jinja2}",
  ],
  exclude: [
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    "out/**",
    ".next/**",
    ".nuxt/**",
    ".svelte-kit/**",
    ".astro/**",
    "coverage/**",
    "vendor/**",
    ".tailclass-backup/**",
    "**/*.min.js",
    "**/*.min.css",
    "**/*.d.ts",
    "package.json",
    "package-lock.json",
  ],
  outputCss: "tailclass.css",
  dictionaryFile: "tailclass.map.json",
  manifestFile: ".tailclass-manifest.json",
  cssFormat: "tailwind-v3", // "tailwind-v3" | "tailwind-v4" | "plain"
  minOccurrences: 2,
  minClasses: 3,
  maxClasses: 0,
  minFiles: 1,
  subsetMatching: true,
  subsetMinClasses: 4,
  classPrefix: "",
  namingStyle: "kebab", // "kebab" | "bem" | "camel"
  tailwindPrefix: "",
  comments: true,
  groupByCategory: true,
  scanHelpers: true,
  excludeClasses: [],
  includeClasses: [],
  excludePatterns: ["tc-ignore", "no-tailclass"],
  ignoreTags: ["script", "style", "svg", "path", "defs", "lineargradient", "stop"],
  onlyTags: [],
  rules: [],
});

const CONFIG_FILENAMES = [
  "tailclass.config.json",
  ".tailclassrc.json",
  ".tailclassrc",
];

/** Keys whose value is a filesystem path that TailClass writes to. */
const WRITABLE_PATH_KEYS = ["outputCss", "dictionaryFile", "manifestFile"];

/** Keys that are accepted in a config file even though they are not defaults. */
const EXTRA_CONFIG_KEYS = ["$schema", "replaceDefaultExcludes", "strictDictionary"];

/**
 * Directories that are never scanned, even when `replaceDefaultExcludes` is set.
 * Rewriting version-control internals or installed dependencies is never the
 * intent of `tailclass apply`, and a repository-supplied config should not be
 * able to make it happen silently.
 */
const HARD_EXCLUDES = [".git/**", "node_modules/**", ".tailclass-backup/**"];

const ARRAY_KEYS = [
  "include",
  "exclude",
  "excludeClasses",
  "includeClasses",
  "excludePatterns",
  "ignoreTags",
  "onlyTags",
];

const NUMERIC_KEYS = {
  minOccurrences: { min: 1, fallback: 2 },
  minClasses: { min: 1, fallback: 3 },
  maxClasses: { min: 0, fallback: 0 },
  minFiles: { min: 1, fallback: 1 },
  subsetMinClasses: { min: 2, fallback: 4 },
};

const BOOLEAN_KEYS = [
  "comments",
  "groupByCategory",
  "scanHelpers",
  "subsetMatching",
  "replaceDefaultExcludes",
  "strictDictionary",
];

/**
 * Read and parse a JSON file, reporting the offending path instead of a bare
 * `Unexpected token` error.
 * @param {string} filePath
 * @returns {Record<string, any>}
 */
function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${filePath}: ${err.message}`);
  }
}

/**
 * Discover and read a configuration file in `rootDir` (or an explicit path).
 * @param {string} rootDir
 * @param {string} [explicitConfigPath]
 * @returns {{ config: Record<string, any>, configPath: string | null }}
 */
function loadConfigFile(rootDir, explicitConfigPath) {
  const absRoot = path.resolve(rootDir || ".");

  if (explicitConfigPath) {
    const resolved = path.resolve(absRoot, explicitConfigPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Configuration file not found: ${explicitConfigPath}`);
    }
    const parsed = readJsonFile(resolved);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Configuration file ${resolved} must contain a JSON object.`);
    }
    return { config: parsed, configPath: resolved };
  }

  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(absRoot, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const parsed = readJsonFile(candidate);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Configuration file ${candidate} must contain a JSON object.`);
      }
      return { config: parsed, configPath: candidate };
    }
  }

  const pkgPath = path.join(absRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg && typeof pkg.tailclass === "object" && pkg.tailclass !== null) {
        return { config: pkg.tailclass, configPath: pkgPath };
      }
    } catch {
      // Ignore malformed package.json in target project
    }
  }

  return { config: {}, configPath: null };
}

/**
 * Ensure a configured output path stays inside the project root.
 *
 * `outputCss`, `dictionaryFile` and `manifestFile` are written by `apply`/`list`/`revert`.
 * Values coming from a *repository-supplied config file* must never escape the
 * scanned project (that would allow a cloned repository to clobber arbitrary
 * files, e.g. `"outputCss": "../../.bashrc"`). Paths typed on the command line
 * are explicit user intent and are therefore allowed to leave the root.
 *
 * The check is both lexical (`../`) and physical (directory/file symlinks):
 * `"outputCss": "link/escaped.css"` with `link -> ../../outside` also escapes,
 * even though the string itself never leaves the root.
 *
 * @param {unknown} value
 * @param {string} key
 * @param {string} absRoot
 * @returns {string}
 */
function validateOutputPath(value, key, absRoot) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid ${key}: expected a non-empty relative file path.`);
  }
  if (value.includes("\u0000")) {
    throw new Error(`Invalid ${key}: path contains a NUL byte.`);
  }

  const resolved = path.resolve(absRoot, value);
  const rel = path.relative(absRoot, resolved);
  if (rel === "" || rel.split(path.sep)[0] === ".." || path.isAbsolute(rel)) {
    throw new Error(
      `Invalid ${key} "${value}": paths in the configuration file must stay inside the project root. ` +
        `Pass the path on the command line instead if you really need it outside (e.g. --output).`
    );
  }
  if (/[\\/]$/.test(value)) {
    throw new Error(`Invalid ${key} "${value}": expected a file path, not a directory.`);
  }

  try {
    assertNoSymlinkEscape(absRoot, resolved, { key, value, operation: "write" });
  } catch (err) {
    if (!err.symlinkEscape) throw err;
    // The CLI hint only applies when a link actually leaves the root. A symlink
    // *at the output path* is rejected for CLI paths too, so suggesting `-o`
    // there would send the user in the wrong direction.
    const cliHint = err.pathEscapesRoot
      ? " Pass the path on the command line instead if you really need it outside (e.g. --output)."
      : "";
    throw new Error(
      `Invalid ${key} "${value}": paths in the configuration file must stay inside the project root. ` +
        `${err.message}${cliHint}`
    );
  }
  return value;
}

/**
 * @param {string} root
 * @param {string} target
 * @returns {boolean}
 */
function isInsideRoot(root, target) {
  const rel = path.relative(root, target);
  if (rel === "" || rel === "..") return false;
  if (path.isAbsolute(rel)) return false;
  return !rel.startsWith(".." + path.sep) && rel !== "..";
}

/**
 * Resolve a path that TailClass is about to write to (or delete), enforcing that
 * repository-supplied configuration cannot escape the project root.
 *
 * `resolveConfig` performs this check already; writers repeat it so the low-level
 * API is safe even when a caller builds a config object by hand. A caller that
 * does not say where a path came from is treated as untrusted (`config`): only
 * an explicit `pathSources[key] === "cli"` relaxes the root boundary.
 *
 * Beyond the lexical `../` check, every existing path component is resolved
 * with `lstat`/`realpath`, so a symlinked directory or a symlinked output file
 * cannot redirect a write (or a `revert --clean` deletion) outside the project.
 *
 * @param {string} absRoot
 * @param {unknown} value
 * @param {string} key
 * @param {Record<string, any>} [config]
 * @param {"write" | "delete"} [operation]
 * @returns {string} absolute path
 */
function resolveWritablePath(absRoot, value, key, config = {}, operation = "write") {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\u0000")) {
    throw new Error(`Invalid ${key}: expected a non-empty file path.`);
  }
  const resolved = path.resolve(absRoot, value);
  const source =
    config && config.pathSources && config.pathSources[key] !== undefined
      ? config.pathSources[key]
      : "config";
  const lexicallyInside = isInsideRoot(absRoot, resolved);

  if (source !== "cli" && !lexicallyInside) {
    throw new Error(
      `Refusing to ${operation} ${key} "${value}" outside the project root (${absRoot}). ` +
        `Paths from configuration files must stay inside the project.`
    );
  }
  // Even an explicit CLI path that lands inside the root must not be redirected
  // through a symlink planted by the repository.
  if (lexicallyInside) {
    assertNoSymlinkEscape(absRoot, resolved, { key, value, operation });
  }
  return resolved;
}

/**
 * Write an output file through the checked resolver.
 *
 * The path is validated once more *after* the parent directories are created
 * (so a component swapped in between cannot redirect the write), and the final
 * `open()` refuses to follow a symlink.
 *
 * @param {string} absRoot
 * @param {string} target absolute path previously returned by `resolveWritablePath`
 * @param {string} key
 * @param {Record<string, any>} config
 * @param {string} content
 * @returns {string} the validated absolute path
 */
function writeResolvedFile(absRoot, target, key, config, content) {
  const checked = resolveWritablePath(absRoot, target, key, config);
  ensureParentDirectory(path.dirname(checked));
  resolveWritablePath(absRoot, checked, key, config);
  writeFileNoFollow(checked, content);
  return checked;
}

/**
 * Delete an output file through the checked resolver. Only regular files are
 * removed; symlinks, directories and special files are reported back to the
 * caller instead of being followed.
 *
 * @param {string} absRoot
 * @param {string} target absolute path previously returned by `resolveWritablePath`
 * @param {string} key
 * @param {Record<string, any>} config
 * @param {string} [label]
 * @returns {{ removed: boolean, reason: string | null }}
 */
function unlinkResolvedFile(absRoot, target, key, config, label = "file") {
  const checked = resolveWritablePath(absRoot, target, key, config, "delete");
  resolveWritablePath(absRoot, checked, key, config, "delete");
  return unlinkRegularFile(checked, label);
}

/**
 * Validate that a config value is an array of non-empty strings.
 * @param {unknown} value
 * @param {string} key
 * @returns {string[]}
 */
function validateStringArray(value, key) {
  // A single string is a common (harmless) config mistake: treat it as a one-item list.
  if (typeof value === "string") value = [value];
  if (!Array.isArray(value)) {
    throw new Error(
      `Invalid ${key}: expected an array of strings, received ${describeType(value)}.`
    );
  }
  const out = [];
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    if (typeof entry !== "string") {
      throw new Error(
        `Invalid ${key}[${i}]: expected a string, received ${describeType(entry)}.`
      );
    }
    if (entry.includes("\u0000")) {
      throw new Error(`Invalid ${key}[${i}]: pattern contains a NUL byte.`);
    }
    if (entry.length > MAX_GLOB_PATTERN_LENGTH) {
      throw new Error(
        `Invalid ${key}[${i}]: pattern is too long (${entry.length} characters, max ${MAX_GLOB_PATTERN_LENGTH}).`
      );
    }
    if (entry.trim() === "") continue;
    out.push(entry);
  }
  return out;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function describeType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

/**
 * Coerce a config value to a bounded number with a helpful error message.
 * @param {unknown} value
 * @param {string} key
 * @param {{ min: number, fallback: number }} bounds
 * @returns {number}
 */
function toBoundedNumber(value, key, bounds) {
  if (value === undefined || value === null || value === "") return bounds.fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${key}: expected a number, received ${JSON.stringify(value)}.`);
  }
  return Math.max(bounds.min, Math.floor(num));
}

/**
 * Coerce a config value to a boolean, accepting the usual JSON-ish spellings.
 * @param {unknown} value
 * @returns {boolean}
 */
function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "") {
      return false;
    }
  }
  return Boolean(value);
}

/**
 * Resolve final effective configuration by merging defaults, discovered file
 * config, and programmatic/CLI overrides.
 *
 * The returned object contains two extra, non-enumerable-ish helpers used by the
 * writers:
 *  - `warnings`: human-readable notes about ignored/coerced config values
 *  - `pathSources`: where each writable path came from (`cli` | `config` | `default`)
 *
 * @param {string} rootDir
 * @param {Record<string, any>} [overrides]
 */
function resolveConfig(rootDir, overrides = {}) {
  const absRoot = path.resolve(rootDir || ".");
  const { config: fileConfig, configPath } = loadConfigFile(
    absRoot,
    overrides.configPath
  );

  const warnings = [];

  for (const key of Object.keys(fileConfig)) {
    if (key in DEFAULT_CONFIG || EXTRA_CONFIG_KEYS.includes(key)) continue;
    warnings.push(
      `Unknown configuration key "${key}" in ${configPath || "config"} was ignored.`
    );
  }

  const merged = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && key !== "configPath") {
      merged[key] = value;
    }
  }

  // --- Arrays -------------------------------------------------------------
  for (const key of ARRAY_KEYS) {
    merged[key] = validateStringArray(merged[key], key);
  }

  // An explicit empty `include` keeps its historical meaning ("scan everything");
  // `findFiles` falls back to `**/*` in that case.
  merged.ignoreTags = merged.ignoreTags.map((t) => t.toLowerCase());
  merged.onlyTags = merged.onlyTags.map((t) => t.toLowerCase());

  // Merge user exclusions with safe baseline exclusions unless replaceDefaultExcludes is true
  merged.replaceDefaultExcludes = toBoolean(merged.replaceDefaultExcludes);
  const baseExcludes = merged.replaceDefaultExcludes ? [] : DEFAULT_CONFIG.exclude;
  const dynamicExcludes = [
    merged.outputCss ? toPosixPath(String(merged.outputCss)) : null,
    merged.dictionaryFile ? toPosixPath(String(merged.dictionaryFile)) : null,
    merged.manifestFile ? toPosixPath(String(merged.manifestFile)) : null,
    "tailclass.config.json",
    ".tailclassrc.json",
  ].filter(Boolean);

  merged.exclude = Array.from(
    new Set([...HARD_EXCLUDES, ...baseExcludes, ...merged.exclude, ...dynamicExcludes])
  );

  // --- Numeric thresholds --------------------------------------------------
  for (const [key, bounds] of Object.entries(NUMERIC_KEYS)) {
    merged[key] = toBoundedNumber(merged[key], key, bounds);
  }

  // --- Booleans ------------------------------------------------------------
  for (const key of BOOLEAN_KEYS) {
    if (key === "replaceDefaultExcludes") continue;
    merged[key] = toBoolean(merged[key]);
  }

  // --- Enums ---------------------------------------------------------------
  if (!["tailwind-v3", "tailwind-v4", "plain"].includes(merged.cssFormat)) {
    throw new Error(
      `Invalid cssFormat "${merged.cssFormat}". Expected "tailwind-v3", "tailwind-v4", or "plain".`
    );
  }

  if (!["kebab", "bem", "camel"].includes(merged.namingStyle)) {
    throw new Error(
      `Invalid namingStyle "${merged.namingStyle}". Expected "kebab", "bem", or "camel".`
    );
  }

  // --- Name prefixes -------------------------------------------------------
  if (typeof merged.classPrefix !== "string") {
    throw new Error(
      `Invalid classPrefix: expected a string, received ${describeType(merged.classPrefix)}.`
    );
  }
  const sanitizedPrefix = sanitizeClassPrefix(merged.classPrefix);
  if (sanitizedPrefix !== merged.classPrefix) {
    throw new Error(
      `Invalid classPrefix "${merged.classPrefix}": only letters, digits, "-" and "_" are allowed.`
    );
  }
  if (/^-?[0-9]/.test(sanitizedPrefix)) {
    throw new Error(
      `Invalid classPrefix "${merged.classPrefix}": a class name cannot start with a digit.`
    );
  }

  if (typeof merged.tailwindPrefix !== "string") {
    throw new Error(
      `Invalid tailwindPrefix: expected a string, received ${describeType(merged.tailwindPrefix)}.`
    );
  }
  if (merged.tailwindPrefix && sanitizeClassPrefix(merged.tailwindPrefix) !== merged.tailwindPrefix) {
    throw new Error(
      `Invalid tailwindPrefix "${merged.tailwindPrefix}": only letters, digits, "-" and "_" are allowed.`
    );
  }

  // --- Rules ---------------------------------------------------------------
  if (!Array.isArray(merged.rules)) {
    warnings.push(`Invalid rules: expected an array; ignoring.`);
    merged.rules = [];
  } else {
    merged.rules = merged.rules.filter((rule) => {
      if (!rule || typeof rule !== "object" || typeof rule.name !== "string") {
        warnings.push("Ignored a custom naming rule without a valid `name`.");
        return false;
      }
      return true;
    });
  }

  // --- Writable paths ------------------------------------------------------
  // Track provenance so writers can keep repository-supplied paths confined to
  // the project root while still honouring explicit CLI paths.
  const pathSources = {};
  for (const key of WRITABLE_PATH_KEYS) {
    const fromCli = overrides[key] !== undefined;
    const fromFile = !fromCli && fileConfig[key] !== undefined;
    pathSources[key] = fromCli ? "cli" : fromFile ? "config" : "default";

    if (pathSources[key] !== "cli") {
      merged[key] = validateOutputPath(merged[key], key, absRoot);
    } else if (typeof merged[key] !== "string" || merged[key].trim() === "") {
      throw new Error(`Invalid ${key}: expected a non-empty file path.`);
    }
  }

  return {
    ...merged,
    configPath,
    warnings,
    pathSources,
  };
}

/**
 * Create a starter `tailclass.config.json` object suitable for `tailclass init`.
 */
function createStarterConfig() {
  return {
    $schema:
      "https://raw.githubusercontent.com/Infinitode/TailClass/main/schema/tailclass.config.schema.json",
    include: DEFAULT_CONFIG.include,
    exclude: ["node_modules/**", "dist/**", "build/**"],
    outputCss: "tailclass.css",
    dictionaryFile: "tailclass.map.json",
    cssFormat: "tailwind-v3",
    minOccurrences: 2,
    minClasses: 3,
    minFiles: 1,
    subsetMatching: true,
    classPrefix: "",
    namingStyle: "kebab",
    tailwindPrefix: "",
    comments: true,
    groupByCategory: true,
    excludeClasses: ["js-*"],
    includeClasses: [],
    ignoreTags: ["script", "style", "svg", "path"],
    rules: [
      {
        name: "cta-button",
        matchTag: ["a", "button"],
        mustInclude: ["rounded-full", "font-semibold"],
        priority: 90,
      },
    ],
  };
}

module.exports = {
  DEFAULT_CONFIG,
  HARD_EXCLUDES,
  CONFIG_FILENAMES,
  WRITABLE_PATH_KEYS,
  loadConfigFile,
  resolveConfig,
  validateOutputPath,
  isInsideRoot,
  resolveWritablePath,
  writeResolvedFile,
  unlinkResolvedFile,
  createStarterConfig,
};

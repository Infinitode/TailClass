"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { toPosixPath } = require("./glob");

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
    const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
    return { config: parsed, configPath: resolved };
  }

  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(absRoot, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
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
 * Resolve final effective configuration by merging defaults, discovered file
 * config, and programmatic/CLI overrides.
 * @param {string} rootDir
 * @param {Record<string, any>} [overrides]
 */
function resolveConfig(rootDir, overrides = {}) {
  const { config: fileConfig, configPath } = loadConfigFile(
    rootDir,
    overrides.configPath
  );

  const merged = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && key !== "configPath") {
      merged[key] = value;
    }
  }

  // Merge user exclusions with safe baseline exclusions unless replaceDefaultExcludes is true
  const baseExcludes = merged.replaceDefaultExcludes ? [] : DEFAULT_CONFIG.exclude;
  const userExcludes = Array.isArray(merged.exclude) ? merged.exclude : [merged.exclude].filter(Boolean);
  const dynamicExcludes = [
    merged.outputCss ? toPosixPath(merged.outputCss) : null,
    merged.dictionaryFile ? toPosixPath(merged.dictionaryFile) : null,
    merged.manifestFile ? toPosixPath(merged.manifestFile) : null,
    "tailclass.config.json",
    ".tailclassrc.json",
  ].filter(Boolean);

  merged.exclude = Array.from(new Set([...baseExcludes, ...userExcludes, ...dynamicExcludes]));
  merged.include = Array.isArray(merged.include)
    ? merged.include
    : [merged.include].filter(Boolean);
  merged.excludeClasses = Array.isArray(merged.excludeClasses) ? merged.excludeClasses : [];
  merged.includeClasses = Array.isArray(merged.includeClasses) ? merged.includeClasses : [];
  merged.excludePatterns = Array.isArray(merged.excludePatterns) ? merged.excludePatterns : [];
  merged.ignoreTags = (merged.ignoreTags || []).map((t) => String(t).toLowerCase());
  merged.onlyTags = (merged.onlyTags || []).map((t) => String(t).toLowerCase());
  merged.rules = Array.isArray(merged.rules) ? merged.rules : [];

  merged.minOccurrences = Math.max(1, Number(merged.minOccurrences) || 2);
  merged.minClasses = Math.max(1, Number(merged.minClasses) || 3);
  merged.maxClasses = Math.max(0, Number(merged.maxClasses) || 0);
  merged.minFiles = Math.max(1, Number(merged.minFiles) || 1);
  merged.subsetMinClasses = Math.max(2, Number(merged.subsetMinClasses) || 4);

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

  return {
    ...merged,
    configPath,
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
    excludePatterns: ["tc-ignore", "no-tailclass"],
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
  CONFIG_FILENAMES,
  loadConfigFile,
  resolveConfig,
  createStarterConfig,
};

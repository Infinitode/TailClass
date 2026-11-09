"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  analyzeScanResult,
  checkSubsetCompatibility,
  computePatternId,
} = require("./analyzer");
const {
  DEFAULT_CONFIG,
  createStarterConfig,
  loadConfigFile,
  resolveConfig,
  resolveWritablePath,
  writeResolvedFile,
} = require("./config");
const { writeFileNoFollow } = require("./fs-safety");
const {
  buildDictionaryPayload,
  formatClassListCsv,
  formatClassListMarkdown,
  loadDictionary,
  resolveActiveMappings,
  sanitizeCustomClassName,
} = require("./dictionary");
const { generateStylesheet, parseExistingStylesheet } = require("./generator");
const { compileGlob, findFiles, matchesAnyGlob, toPosixPath } = require("./glob");
const {
  assignUniqueNames,
  extractSignals,
  formatClassName,
  inferSemanticName,
} = require("./namer");
const {
  applyMappingsToProject,
  mergeWithExistingCssRules,
  revertProjectFiles,
  revertSource,
  rewriteSource,
} = require("./rewriter");
const { scanDirectory, scanSource } = require("./scanner");
const {
  canonicalizeClasses,
  classifyToken,
  computeSubPriority,
  expandCssAxes,
  partitionAndCanonicalize,
  splitClassTokens,
} = require("./tailwind");

const { VERSION } = require("./version");

const NAME = "TailClass";

/**
 * Scan and analyze a project directory without modifying any files.
 *
 * @param {string} [rootDir="."]
 * @param {Record<string, any>} [options={}]
 */
function scanProject(rootDir = ".", options = {}) {
  const config = resolveConfig(rootDir, options);
  const scan = scanDirectory(rootDir, config);
  const analysis = analyzeScanResult(scan, config);
  return { config, scan, analysis };
}

/**
 * Run Class List Mode on a directory: returns comprehensive statistics,
 * auto-suggested semantic names, occurrence counts, file/line breakdowns,
 * and writes/merges `tailclass.map.json` (unless `write: false`).
 *
 * @param {string} [rootDir="."]
 * @param {Record<string, any>} [options={}]
 */
function generateClassList(rootDir = ".", options = {}) {
  const absRoot = path.resolve(rootDir || ".");
  const { config, scan, analysis } = scanProject(absRoot, options);

  // `resolveConfig` has already merged `options.dictionaryFile` into the config
  // and recorded its provenance; use that single checked resolver rather than
  // re-resolving the raw string (which would bypass the symlink checks).
  const dictionaryPath = resolveWritablePath(
    absRoot,
    config.dictionaryFile || "tailclass.map.json",
    "dictionaryFile",
    config
  );

  let existingDictionary = null;
  if (options.merge !== false && fs.existsSync(dictionaryPath)) {
    try {
      existingDictionary = JSON.parse(fs.readFileSync(dictionaryPath, "utf8"));
    } catch {
      existingDictionary = null;
    }
  }

  const dictionary = buildDictionaryPayload(analysis, {
    includeAll: Boolean(options.includeAll),
    includeUtilityInventory: options.includeUtilityInventory !== false,
    existingDictionary,
  });

  if (options.write !== false) {
    writeResolvedFile(
      absRoot,
      dictionaryPath,
      "dictionaryFile",
      config,
      JSON.stringify(dictionary, null, 2) + "\n"
    );
  }

  let reportPath = null;
  if (options.reportFile) {
    // Reports are an explicit CLI/API destination, so they may live outside the root.
    reportPath = resolveWritablePath(absRoot, options.reportFile, "reportFile", {
      pathSources: { reportFile: "cli" },
    });
    const ext = path.extname(reportPath).toLowerCase();
    const reportBody =
      ext === ".csv"
        ? formatClassListCsv(dictionary)
        : formatClassListMarkdown(dictionary);
    if (options.write !== false) {
      writeResolvedFile(absRoot, reportPath, "reportFile", {
        pathSources: { reportFile: "cli" },
      }, reportBody);
    }
  }

  return {
    config,
    scan,
    analysis,
    dictionary,
    dictionaryPath,
    reportPath,
  };
}

/**
 * Automatically extract repeated Tailwind layouts across a project (respecting
 * optional custom dictionaries), generate the centralized stylesheet, and
 * replace inline utilities in source files.
 *
 * @param {string} [rootDir="."]
 * @param {Record<string, any>} [options={}]
 */
function applyAutoClasses(rootDir = ".", options = {}) {
  const absRoot = path.resolve(rootDir || ".");
  const { config, scan, analysis } = scanProject(absRoot, options);

  let dictionaryObj = null;
  if (options.dictionary) {
    dictionaryObj = loadDictionary(options.dictionary, absRoot);
  } else if (!options.ignoreDictionary) {
    // The auto-discovered dictionary comes from the repository: use the same
    // confined resolver as the writers so a symlink cannot redirect the read.
    const defaultDictPath = resolveWritablePath(
      absRoot,
      config.dictionaryFile || "tailclass.map.json",
      "dictionaryFile",
      config
    );
    if (fs.existsSync(defaultDictPath)) {
      dictionaryObj = loadDictionary(defaultDictPath, absRoot);
    }
  }

  const resolvedMappings = resolveActiveMappings(analysis, dictionaryObj, config);

  const result = applyMappingsToProject(scan, resolvedMappings, config, {
    dryRun: Boolean(options.dryRun),
    backup: Boolean(options.backup),
    force: Boolean(options.force),
    version: VERSION,
  });

  return {
    config,
    analysis,
    usedDictionary: Boolean(dictionaryObj),
    ...result,
  };
}

/**
 * Revert centralized TailClass class names across a project back to their
 * original inline Tailwind utility strings.
 *
 * @param {string} [rootDir="."]
 * @param {Record<string, any>} [options={}]
 */
function revertProject(rootDir = ".", options = {}) {
  const absRoot = path.resolve(rootDir || ".");
  const config = resolveConfig(absRoot, options);
  return {
    config,
    ...revertProjectFiles(absRoot, config, {
      dryRun: Boolean(options.dryRun),
      clean: Boolean(options.clean),
      force: Boolean(options.force),
    }),
  };
}

/**
 * Scaffold a starter `tailclass.config.json` in `rootDir`.
 *
 * @param {string} [rootDir="."]
 * @param {{ force?: boolean, fileName?: string }} [options={}]
 */
function initConfig(rootDir = ".", options = {}) {
  const absRoot = path.resolve(rootDir || ".");
  const fileName = options.fileName || "tailclass.config.json";
  const targetPath = path.resolve(absRoot, fileName);

  if (fs.existsSync(targetPath) && !options.force) {
    throw new Error(
      `${fileName} already exists in ${absRoot}. Pass --force to overwrite it.`
    );
  }

  const starter = createStarterConfig();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileNoFollow(targetPath, JSON.stringify(starter, null, 2) + "\n");
  return { configPath: targetPath, config: starter };
}

module.exports = {
  NAME,
  VERSION,
  DEFAULT_CONFIG,
  // High-level project workflows
  scanProject,
  generateClassList,
  applyAutoClasses,
  revertProject,
  initConfig,
  // Low-level / in-memory APIs
  resolveConfig,
  loadConfigFile,
  createStarterConfig,
  scanSource,
  scanDirectory,
  analyzeScanResult,
  computePatternId,
  checkSubsetCompatibility,
  extractSignals,
  inferSemanticName,
  formatClassName,
  assignUniqueNames,
  buildDictionaryPayload,
  loadDictionary,
  resolveActiveMappings,
  sanitizeCustomClassName,
  formatClassListMarkdown,
  formatClassListCsv,
  generateStylesheet,
  parseExistingStylesheet,
  rewriteSource,
  revertSource,
  mergeWithExistingCssRules,
  classifyToken,
  computeSubPriority,
  expandCssAxes,
  canonicalizeClasses,
  partitionAndCanonicalize,
  splitClassTokens,
  findFiles,
  compileGlob,
  matchesAnyGlob,
  toPosixPath,
};

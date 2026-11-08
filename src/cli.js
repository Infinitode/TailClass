"use strict";

const path = require("node:path");
const {
  NAME,
  VERSION,
  applyAutoClasses,
  generateClassList,
  initConfig,
  revertProject,
  scanProject,
} = require("./index");

function createPalette(enabled) {
  const wrap = (code) => (str) => (enabled ? `\x1b[${code}m${str}\x1b[0m` : String(str));
  return {
    bold: wrap("1"),
    dim: wrap("2"),
    cyan: wrap("36"),
    green: wrap("32"),
    yellow: wrap("33"),
    magenta: wrap("35"),
    red: wrap("31"),
    purple: (str) => (enabled ? `\x1b[38;2;93;23;235m${str}\x1b[0m` : String(str)),
  };
}

function splitListArg(val) {
  if (!val) return [];
  return String(val)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse CLI argument array into `{ command, targetDir, flags }`.
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const args = Array.from(argv || []);
  const flags = {
    include: [],
    exclude: [],
    excludeClasses: [],
    includeClasses: [],
    ignoreTags: [],
    onlyTags: [],
  };
  const positionals = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      flags.help = true;
      i++;
      continue;
    }
    if (arg === "-v" || arg === "--version") {
      flags.version = true;
      i++;
      continue;
    }
    if (arg === "--json") {
      flags.json = true;
      i++;
      continue;
    }
    if (arg === "--dry-run" || arg === "-d") {
      flags.dryRun = true;
      i++;
      continue;
    }
    if (arg === "--backup") {
      flags.backup = true;
      i++;
      continue;
    }
    if (arg === "--all" || arg === "-a") {
      flags.all = true;
      i++;
      continue;
    }
    if (arg === "--no-write") {
      flags.noWrite = true;
      i++;
      continue;
    }
    if (arg === "--no-merge") {
      flags.noMerge = true;
      i++;
      continue;
    }
    if (arg === "--no-subset") {
      flags.subsetMatching = false;
      i++;
      continue;
    }
    if (arg === "--subset") {
      flags.subsetMatching = true;
      i++;
      continue;
    }
    if (arg === "--no-comments") {
      flags.comments = false;
      i++;
      continue;
    }
    if (arg === "--no-group") {
      flags.groupByCategory = false;
      i++;
      continue;
    }
    if (arg === "--no-dict") {
      flags.ignoreDictionary = true;
      i++;
      continue;
    }
    if (arg === "--strict-dict") {
      flags.strictDictionary = true;
      i++;
      continue;
    }
    if (arg === "--clean") {
      flags.clean = true;
      i++;
      continue;
    }
    if (arg === "--force" || arg === "-f") {
      flags.force = true;
      i++;
      continue;
    }

    const nextVal = () => {
      if (i + 1 >= args.length) {
        throw new Error(`Missing value for option ${arg}`);
      }
      i += 2;
      return args[i - 1];
    };

    if (arg === "-c" || arg === "--config") {
      flags.configPath = nextVal();
      continue;
    }
    if (arg === "-o" || arg === "--output") {
      flags.outputCss = nextVal();
      continue;
    }
    if (arg === "--dict" || arg === "--dictionary") {
      flags.dictionary = nextVal();
      continue;
    }
    if (arg === "--report") {
      flags.reportFile = nextVal();
      continue;
    }
    if (arg === "--format") {
      flags.cssFormat = nextVal();
      continue;
    }
    if (arg === "--prefix") {
      flags.classPrefix = nextVal();
      continue;
    }
    if (arg === "--tw-prefix") {
      flags.tailwindPrefix = nextVal();
      continue;
    }
    if (arg === "--style") {
      flags.namingStyle = nextVal();
      continue;
    }
    if (arg === "--min-occurrences") {
      flags.minOccurrences = Number(nextVal());
      continue;
    }
    if (arg === "--min-classes") {
      flags.minClasses = Number(nextVal());
      continue;
    }
    if (arg === "--max-classes") {
      flags.maxClasses = Number(nextVal());
      continue;
    }
    if (arg === "--min-files") {
      flags.minFiles = Number(nextVal());
      continue;
    }
    if (arg === "-i" || arg === "--include") {
      flags.include.push(...splitListArg(nextVal()));
      continue;
    }
    if (arg === "-e" || arg === "--exclude") {
      flags.exclude.push(...splitListArg(nextVal()));
      continue;
    }
    if (arg === "--exclude-classes") {
      flags.excludeClasses.push(...splitListArg(nextVal()));
      continue;
    }
    if (arg === "--include-classes") {
      flags.includeClasses.push(...splitListArg(nextVal()));
      continue;
    }
    if (arg === "--ignore-tags") {
      flags.ignoreTags.push(...splitListArg(nextVal()));
      continue;
    }
    if (arg === "--only-tags") {
      flags.onlyTags.push(...splitListArg(nextVal()));
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}. Run "tailclass --help" for usage.`);
    }

    positionals.push(arg);
    i++;
  }

  const knownCommands = new Set(["scan", "list", "apply", "revert", "init", "help"]);
  let command = "scan";
  let targetDir = ".";

  if (positionals.length > 0) {
    if (knownCommands.has(positionals[0])) {
      command = positionals[0];
      targetDir = positionals[1] || ".";
    } else {
      command = "scan";
      targetDir = positionals[0];
    }
  }

  return { command, targetDir, flags };
}

function buildConfigOverrides(flags) {
  const overrides = {};
  if (flags.configPath) overrides.configPath = flags.configPath;
  if (flags.outputCss) overrides.outputCss = flags.outputCss;
  if (flags.cssFormat) overrides.cssFormat = flags.cssFormat;
  if (flags.classPrefix !== undefined) overrides.classPrefix = flags.classPrefix;
  if (flags.tailwindPrefix !== undefined) overrides.tailwindPrefix = flags.tailwindPrefix;
  if (flags.namingStyle) overrides.namingStyle = flags.namingStyle;
  if (flags.minOccurrences !== undefined) overrides.minOccurrences = flags.minOccurrences;
  if (flags.minClasses !== undefined) overrides.minClasses = flags.minClasses;
  if (flags.maxClasses !== undefined) overrides.maxClasses = flags.maxClasses;
  if (flags.minFiles !== undefined) overrides.minFiles = flags.minFiles;
  if (flags.subsetMatching !== undefined) overrides.subsetMatching = flags.subsetMatching;
  if (flags.comments !== undefined) overrides.comments = flags.comments;
  if (flags.groupByCategory !== undefined) overrides.groupByCategory = flags.groupByCategory;
  if (flags.strictDictionary !== undefined) overrides.strictDictionary = flags.strictDictionary;
  if (flags.include.length > 0) overrides.include = flags.include;
  if (flags.exclude.length > 0) overrides.exclude = flags.exclude;
  if (flags.excludeClasses.length > 0) overrides.excludeClasses = flags.excludeClasses;
  if (flags.includeClasses.length > 0) overrides.includeClasses = flags.includeClasses;
  if (flags.ignoreTags.length > 0) overrides.ignoreTags = flags.ignoreTags;
  if (flags.onlyTags.length > 0) overrides.onlyTags = flags.onlyTags;
  return overrides;
}

function formatHelpText(c) {
  return [
    `${c.purple(c.bold(NAME))} ${c.dim(`v${VERSION}`)} — Smart Tailwind CSS Auto-Classer & Centralized Layout Extractor`,
    "",
    `${c.bold("USAGE")}`,
    `  tailclass <command> [directory] [options]`,
    "",
    `${c.bold("COMMANDS")}`,
    `  ${c.cyan("scan")}   [dir]    Scan site files & preview smart semantic class detections (read-only)`,
    `  ${c.cyan("list")}   [dir]    Class List Mode: list class counts, occurrences & files, and generate dictionary`,
    `  ${c.cyan("apply")}  [dir]    Generate centralized CSS and replace repeated Tailwind classes across files`,
    `  ${c.cyan("revert")} [dir]    Expand centralized TailClass names back to inline Tailwind utilities`,
    `  ${c.cyan("init")}   [dir]    Create a starter tailclass.config.json configuration file`,
    "",
    `${c.bold("KEY OPTIONS")}`,
    `  -c, --config <file>           Path to tailclass.config.json`,
    `  -o, --output <file>           Centralized CSS output path (default: tailclass.css)`,
    `      --dict <file>             Custom mapping dictionary path (default: tailclass.map.json)`,
    `      --no-dict                 Ignore existing tailclass.map.json and use pure auto-detection`,
    `      --strict-dict             Only extract patterns explicitly listed in --dict`,
    `  -d, --dry-run                 Preview CSS & file changes without touching disk`,
    `      --backup                  Save original modified files under .tailclass-backup/`,
    `  -a, --all                     Include 1-off / non-repeated patterns in "list" mode`,
    `      --report <file>           Also export a .md or .csv report in "list" mode`,
    `      --format <mode>           CSS output format: tailwind-v3 | tailwind-v4 | plain`,
    `      --prefix <str>            Prefix generated class names (e.g. "ui-" -> .ui-navbar)`,
    `      --style <mode>            Naming convention: kebab | bem | camel (default: kebab)`,
    `      --tw-prefix <str>         Custom Tailwind utility prefix (e.g. "tw-")`,
    `      --min-occurrences <n>     Minimum occurrences across site to extract (default: 2)`,
    `      --min-classes <n>         Minimum Tailwind utilities in a pattern (default: 3)`,
    `      --min-files <n>           Minimum distinct files a pattern must appear in (default: 1)`,
    `      --no-subset               Disable smart shared-base / subset layout matching`,
    `  -i, --include <globs>         Comma-separated file globs to include`,
    `  -e, --exclude <globs>         Comma-separated file globs to exclude`,
    `      --exclude-classes <globs> Utility globs to always keep inline (e.g. "js-*,animate-*")`,
    `      --include-classes <globs> Only extract utilities matching these globs`,
    `      --ignore-tags <tags>      HTML/JSX tags to skip (e.g. "svg,code")`,
    `      --only-tags <tags>        Only auto-class specific tags (e.g. "nav,button,div")`,
    `      --clean                   Delete tailclass.css and manifest after "revert"`,
    `      --json                    Emit machine-readable JSON output`,
    `  -h, --help                    Display this help message`,
    `  -v, --version                 Display version number`,
    "",
    `${c.bold("EXAMPLES")}`,
    `  tailclass scan ./src`,
    `  tailclass list ./src --report class-report.md`,
    `  tailclass apply ./src --dry-run`,
    `  tailclass apply ./src --dict tailclass.map.json -o src/styles/components.css`,
    `  tailclass revert ./src --clean`,
    "",
  ].join("\n");
}

function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, Math.max(0, maxLen - 1)) + "…";
}

function printSummaryBox(write, c, summary) {
  write(
    [
      `  Files scanned:            ${c.bold(summary.filesScanned)} (${summary.filesWithClasses} with Tailwind classes)`,
      `  Class attributes found:   ${c.bold(summary.totalClassAttributes)}`,
      `  Total utility tokens:     ${c.bold(summary.totalUtilityTokens)} (${summary.uniqueUtilityTokens} unique utilities)`,
      `  Unique class patterns:    ${c.bold(summary.uniqueClassPatterns)}`,
      `  Extractable layouts:      ${c.green(c.bold(summary.extractablePatterns))} (${summary.totalReplacementsPossible} total occurrences)`,
    ].join("\n")
  );
}

/**
 * Execute the TailClass CLI and return a numeric exit code (`0` = success, `1` = error).
 *
 * @param {string[]} argv
 * @param {{ stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream, color?: boolean }} [io]
 * @returns {number}
 */
function runCli(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const useColor =
    io.color !== undefined
      ? Boolean(io.color)
      : Boolean(stdout.isTTY && !process.env.NO_COLOR);
  const c = createPalette(useColor);

  const write = (msg = "") => stdout.write(String(msg) + "\n");
  const writeErr = (msg = "") => stderr.write(String(msg) + "\n");

  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    writeErr(`${c.red("Error:")} ${err.message}`);
    return 1;
  }

  const { command, targetDir, flags } = parsed;

  if (flags.version) {
    write(`${NAME} v${VERSION}`);
    return 0;
  }

  if (flags.help || command === "help") {
    write(formatHelpText(c));
    return 0;
  }

  try {
    const overrides = buildConfigOverrides(flags);

    if (command === "init") {
      const { configPath, config } = initConfig(targetDir, { force: flags.force });
      if (flags.json) {
        write(JSON.stringify({ configPath, config }, null, 2));
      } else {
        write(
          `${c.green("✔")} Created starter configuration at ${c.bold(
            path.relative(process.cwd(), configPath) || "tailclass.config.json"
          )}`
        );
      }
      return 0;
    }

    if (command === "scan") {
      const { analysis } = scanProject(targetDir, overrides);
      if (flags.json) {
        write(
          JSON.stringify(
            {
              summary: analysis.summary,
              patterns: analysis.extractablePatterns.map((p) => ({
                id: p.id,
                autoName: p.autoName,
                category: p.category,
                classCount: p.classCount,
                timesFound: p.timesFound,
                fileCount: p.fileCount,
                elements: p.elements,
                classes: p.canonicalKey,
                files: p.files,
              })),
            },
            null,
            2
          )
        );
        return 0;
      }

      write(`${c.purple(c.bold("TailClass Scan"))} ${c.dim(`— ${path.resolve(targetDir)}`)}`);
      write("");
      printSummaryBox(write, c, analysis.summary);
      write("");

      if (analysis.extractablePatterns.length === 0) {
        write(c.yellow("No repeated Tailwind layouts met the extraction thresholds."));
        write(c.dim("Tip: lower --min-occurrences or --min-classes, or run `tailclass list --all`."));
        return 0;
      }

      write(c.bold("Auto-Detected Repeated Layouts:"));
      for (const p of analysis.extractablePatterns) {
        const elems = p.elements.map((e) => `<${e}>`).join(",");
        write(
          `  ${c.cyan(`.${p.autoName}`)} ${c.dim(`[${p.category}]`)} — ${c.bold(
            `${p.timesFound}x`
          )} across ${p.fileCount} file(s), ${p.classCount} classes ${c.dim(`(${elems})`)}`
        );
        write(`    ${c.dim(truncate(p.canonicalKey, 96))}`);
      }
      write("");
      write(
        c.dim(
          `Next: run "tailclass list ${targetDir}" to generate a custom dictionary, or "tailclass apply ${targetDir}" to extract & rewrite.`
        )
      );
      return 0;
    }

    if (command === "list") {
      const dictOptions = {
        ...overrides,
        dictionaryFile: flags.dictionary || overrides.dictionaryFile,
        includeAll: Boolean(flags.all),
        merge: !flags.noMerge,
        write: !flags.noWrite,
        reportFile: flags.reportFile,
      };

      const { dictionary, dictionaryPath, reportPath } = generateClassList(
        targetDir,
        dictOptions
      );

      if (flags.json) {
        write(JSON.stringify(dictionary, null, 2));
        return 0;
      }

      write(
        `${c.purple(c.bold("TailClass — Class List Mode"))} ${c.dim(
          `— ${path.resolve(targetDir)}`
        )}`
      );
      write("");
      printSummaryBox(write, c, dictionary.summary);
      write("");

      if (dictionary.mappings.length > 0) {
        write(
          c.bold(
            `Pattern Inventory (${dictionary.mappings.length} ${
              flags.all ? "total unique" : "extractable repeated"
            } patterns):`
          )
        );
        for (const m of dictionary.mappings) {
          const activeLabel = m.customName
            ? `${c.green(`.${m.customName}`)} ${c.dim(`(auto: .${m.autoName})`)}`
            : c.cyan(`.${m.autoName}`);
          const fileLocs = m.files
            .map((f) => `${f.file}:${f.lines.join(",")}`)
            .join(", ");
          write(
            `  • ${activeLabel} ${c.dim(`(${m.id})`)} — ${c.bold(
              `${m.classCount} classes`
            )}, found ${c.bold(`${m.timesFound}x`)} in ${m.fileCount} file(s) ${c.dim(
              `[${m.elements.map((e) => `<${e}>`).join(", ")}]`
            )}`
          );
          write(`    Classes: ${m.classes}`);
          write(`    Files:   ${c.dim(truncate(fileLocs, 96))}`);
        }
        write("");
      }

      if (Array.isArray(dictionary.utilityInventory) && dictionary.utilityInventory.length > 0) {
        const topUtils = dictionary.utilityInventory.slice(0, 12);
        write(
          c.bold(
            `Top Individual Tailwind Utilities (${dictionary.utilityInventory.length} distinct utilities across site):`
          )
        );
        for (const u of topUtils) {
          write(
            `  ${c.magenta(u.utility.padEnd(28))} ${String(u.timesFound).padStart(
              3
            )}x in ${u.fileCount} file(s) ${c.dim(`(${truncate(u.files.join(", "), 54)})`)}`
          );
        }
        write("");
      }

      if (!flags.noWrite) {
        write(
          `${c.green("✔")} Dictionary saved to ${c.bold(
            path.relative(process.cwd(), dictionaryPath) || dictionaryPath
          )}`
        );
        write(
          c.dim(
            `  Edit "customName" on any entry in that file, then run: tailclass apply ${targetDir} --dict ${
              path.relative(process.cwd(), dictionaryPath) || "tailclass.map.json"
            }`
          )
        );
      }
      if (reportPath && !flags.noWrite) {
        write(
          `${c.green("✔")} Report exported to ${c.bold(
            path.relative(process.cwd(), reportPath) || reportPath
          )}`
        );
      }
      return 0;
    }

    if (command === "apply") {
      const res = applyAutoClasses(targetDir, {
        ...overrides,
        dictionary: flags.dictionary,
        ignoreDictionary: Boolean(flags.ignoreDictionary),
        dryRun: Boolean(flags.dryRun),
        backup: Boolean(flags.backup),
      });

      if (flags.json) {
        write(
          JSON.stringify(
            {
              dryRun: res.dryRun,
              usedDictionary: res.usedDictionary,
              outputCssPath: res.outputCssPath,
              totalClassesGenerated: res.activeMappings.length,
              totalFilesModified: res.totalFilesModified,
              totalReplacements: res.totalReplacements,
              totalBytesSaved: res.totalBytesSaved,
              mappings: res.activeMappings.map((m) => ({
                id: m.id,
                finalName: m.finalName,
                autoName: m.autoName,
                nameSource: m.nameSource,
                classes: m.canonicalKey,
              })),
              filesModified: res.filesModified.map((f) => ({
                file: f.file,
                replacementsCount: f.replacementsCount,
                bytesSaved: f.bytesSaved,
                edits: f.edits,
              })),
            },
            null,
            2
          )
        );
        return 0;
      }

      const modeTag = res.dryRun ? c.yellow(" [DRY RUN]") : "";
      write(
        `${c.purple(c.bold("TailClass Apply"))}${modeTag} ${c.dim(
          `— ${path.resolve(targetDir)}`
        )}`
      );
      write("");

      if (res.activeMappings.length === 0) {
        write(c.yellow("No patterns matched extraction criteria. Nothing to rewrite."));
        return 0;
      }

      write(
        `  Centralized classes:  ${c.green(c.bold(res.activeMappings.length))}${
          res.usedDictionary ? c.dim(" (with custom dictionary mappings)") : ""
        }`
      );
      write(`  Files updated:        ${c.bold(res.totalFilesModified)}`);
      write(`  Class replacements:   ${c.bold(res.totalReplacements)}`);
      write(
        `  Markup size delta:    ${
          res.totalBytesSaved >= 0
            ? c.green(`-${res.totalBytesSaved} bytes`)
            : `${Math.abs(res.totalBytesSaved)} bytes`
        }`
      );
      write("");

      for (const f of res.filesModified) {
        write(`  ${c.cyan(f.file)} ${c.dim(`(${f.replacementsCount} replacement(s))`)}`);
        for (const ed of f.edits.slice(0, 6)) {
          write(`    L${ed.line}: ${c.dim(truncate(ed.before.trim(), 52))} → ${c.green(ed.after.trim())}`);
        }
        if (f.edits.length > 6) {
          write(`    ${c.dim(`...and ${f.edits.length - 6} more in this file`)}`);
        }
      }

      write("");
      if (res.dryRun) {
        write(c.bold("Preview of centralized CSS:"));
        write(c.dim("─".repeat(60)));
        write(res.cssContent.trimEnd());
        write(c.dim("─".repeat(60)));
        write(c.yellow("Dry run complete — no files were modified on disk."));
      } else {
        write(
          `${c.green("✔")} Wrote centralized stylesheet to ${c.bold(
            path.relative(process.cwd(), res.outputCssPath) || res.outputCssPath
          )}`
        );
        write(
          c.dim(
            `  Import this CSS file in your main stylesheet so Tailwind compiles the @apply rules.`
          )
        );
      }
      return 0;
    }

    if (command === "revert") {
      const res = revertProject(targetDir, {
        ...overrides,
        dryRun: Boolean(flags.dryRun),
        clean: Boolean(flags.clean),
      });

      if (flags.json) {
        write(JSON.stringify(res, null, 2));
        return 0;
      }

      const modeTag = res.dryRun ? c.yellow(" [DRY RUN]") : "";
      write(`${c.purple(c.bold("TailClass Revert"))}${modeTag}`);
      write(
        `  Expanded ${c.bold(res.totalReverted)} centralized class attribute(s) across ${c.bold(
          res.totalFilesReverted
        )} file(s).`
      );
      if (flags.clean && !res.dryRun) {
        write(`${c.green("✔")} Removed centralized stylesheet and manifest.`);
      }
      return 0;
    }

    writeErr(`${c.red("Error:")} Unrecognized command "${command}".`);
    return 1;
  } catch (err) {
    writeErr(`${c.red("Error:")} ${err.message}`);
    return 1;
  }
}

module.exports = {
  parseArgs,
  runCli,
};

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { computePatternId } = require("./analyzer");
const { VERSION } = require("./version");
const { partitionAndCanonicalize } = require("./tailwind");
const {
  MAX_CLASS_NAME_LENGTH,
  sanitizeCommentText,
  sanitizeElementName,
} = require("./css-safety");

/**
 * Sanitize a user-provided custom CSS class name (preserving valid BEM `__`, `--`,
 * camelCase, underscores, and hyphens while stripping leading `.` or whitespace).
 * @param {string} rawName
 * @returns {string}
 */
function sanitizeCustomClassName(rawName) {
  const trimmed = String(rawName || "")
    .trim()
    .replace(/^\.+/, "")
    .replace(/\s+/g, "-");
  const cleaned = trimmed.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, MAX_CLASS_NAME_LENGTH);
  // `.123btn` (or `.-3d`) is not a valid CSS class selector, so give numeric
  // names a valid prefix instead of silently emitting broken CSS.
  return /^-?[0-9]/.test(cleaned) ? `tc-${cleaned}` : cleaned;
}

/**
 * Normalise a dictionary-supplied category so it can safely be emitted inside a
 * generated `/* === ... === *\/` section comment and in report tables.
 * @param {unknown} rawCategory
 * @returns {string}
 */
function sanitizeCategory(rawCategory) {
  const clean = sanitizeCommentText(rawCategory, 40)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  return clean || "custom";
}

/**
 * Build a Class List Mode dictionary object from an analysis result, optionally
 * merging `customName` and `enabled` choices from a previous dictionary file.
 *
 * @param {object} analysis - Output of `analyzeScanResult`
 * @param {{
 *   includeAll?: boolean,
 *   includeUtilityInventory?: boolean,
 *   existingDictionary?: object | null
 * }} [options]
 */
function buildDictionaryPayload(analysis, options = {}) {
  const includeAll = Boolean(options.includeAll);
  const includeUtilityInventory = options.includeUtilityInventory !== false;
  const existing = options.existingDictionary || null;

  const prevById = new Map();
  const prevByClasses = new Map();
  if (existing && Array.isArray(existing.mappings)) {
    for (const item of existing.mappings) {
      if (item && item.id) prevById.set(item.id, item);
      if (item && item.classes) prevByClasses.set(item.classes.trim(), item);
    }
  }

  const sourcePatterns = includeAll ? analysis.allPatterns : analysis.extractablePatterns;

  const mappings = sourcePatterns.map((p) => {
    const prior = prevById.get(p.id) || prevByClasses.get(p.canonicalKey) || null;
    const priorCustom =
      prior && typeof prior.customName === "string" ? prior.customName.trim() : "";

    let enabled = Boolean(p.qualifies);
    if (prior && typeof prior.enabled === "boolean") {
      enabled = prior.enabled;
    } else if (!p.qualifies && priorCustom) {
      enabled = true;
    }

    return {
      id: p.id,
      autoName: p.autoName,
      customName: priorCustom,
      enabled,
      category: p.category || "layout",
      label: p.label || "Layout Pattern",
      confidence: Number((p.confidence || 0.8).toFixed(2)),
      matchType: p.matchType || "exact",
      classCount: p.classCount,
      classes: p.canonicalKey,
      timesFound: p.timesFound,
      exactMatches: p.exactMatches,
      subsetMatches: p.subsetMatches,
      fileCount: p.fileCount,
      elements: p.elements,
      files: p.files,
    };
  });

  const payload = {
    $schema:
      "https://raw.githubusercontent.com/Infinitode/TailClass/main/schema/tailclass.map.schema.json",
    version: VERSION,
    generatedAt: new Date().toISOString(),
    instructions:
      "Type your preferred class name into 'customName' to override 'autoName', or set 'enabled' to false to skip a pattern. Apply with: tailclass apply --dict tailclass.map.json",
    summary: analysis.summary,
    mappings,
  };

  if (includeUtilityInventory) {
    payload.utilityInventory = analysis.utilityInventory;
  }

  return payload;
}

/**
 * Load a dictionary from a file path or plain JS object.
 * @param {string | object | null | undefined} dictionarySource
 * @param {string} [rootDir]
 */
function loadDictionary(dictionarySource, rootDir = ".") {
  if (!dictionarySource) return null;
  if (typeof dictionarySource === "object") return dictionarySource;

  const resolved = path.resolve(rootDir, String(dictionarySource));
  if (!fs.existsSync(resolved)) {
    throw new Error(`Dictionary file not found: ${dictionarySource}`);
  }
  const content = fs.readFileSync(resolved, "utf8");
  return JSON.parse(content);
}

/**
 * Resolve final active class mappings by combining automatic analysis with
 * an optional custom dictionary (supports both generated `tailclass.map.json`
 * format AND flat `{ "classes or autoName or id": "custom-name" }` objects).
 *
 * @param {object} analysis - Output of `analyzeScanResult`
 * @param {object | null} dictionary - Loaded dictionary object (optional)
 * @param {Record<string, any>} [config]
 * @returns {Array<object>} Active resolved pattern mappings ready for CSS generation & rewriting
 */
function resolveActiveMappings(analysis, dictionary = null, config = {}) {
  const byId = new Map();
  const byCanonical = new Map();
  const byAutoName = new Map();

  for (const p of analysis.allPatterns) {
    byId.set(p.id, p);
    byCanonical.set(p.canonicalKey, p);
    byAutoName.set(p.autoName, p);
  }

  // Case 1: No dictionary supplied -> use all auto-detected extractable patterns
  if (!dictionary) {
    return analysis.extractablePatterns.map((p) => ({
      ...p,
      finalName: p.autoName,
      customName: "",
      nameSource: "auto",
    }));
  }

  // Case 2: Structured `tailclass.map.json` with `mappings` array
  if (Array.isArray(dictionary.mappings)) {
    const active = [];
    const seenCanonical = new Set();
    const mentionedCanonical = new Set();

    for (const entry of dictionary.mappings) {
      if (!entry) continue;
      const custom = sanitizeCustomClassName(entry.customName || "");

      const rawCanonical = entry.classes
        ? partitionAndCanonicalize(entry.classes, {
            tailwindPrefix: config.tailwindPrefix || "",
          }).canonicalKey
        : "";

      const matchedPattern =
        (entry.id && byId.get(entry.id)) ||
        (rawCanonical && byCanonical.get(rawCanonical)) ||
        null;

      if (rawCanonical) mentionedCanonical.add(rawCanonical);
      if (matchedPattern) mentionedCanonical.add(matchedPattern.canonicalKey);

      const wasAutoQualifying = matchedPattern ? Boolean(matchedPattern.qualifies) : false;

      if (entry.enabled === false && !(custom && !wasAutoQualifying)) {
        continue;
      }

      const finalName =
        custom ||
        (matchedPattern && matchedPattern.autoName) ||
        sanitizeCustomClassName(entry.autoName);
      if (!finalName || !rawCanonical) continue;

      if (seenCanonical.has(rawCanonical)) continue;
      seenCanonical.add(rawCanonical);

      if (matchedPattern) {
        active.push({
          ...matchedPattern,
          finalName,
          customName: custom,
          nameSource: custom ? "dictionary" : "auto",
        });
      } else {
        // Entry defined in dictionary that may match supersets or future files
        const part = partitionAndCanonicalize(rawCanonical, {
          tailwindPrefix: config.tailwindPrefix || "",
        });
        const propGroups = new Set(part.applyableInfos.map((i) => i.propertyGroup));
        active.push({
          id: entry.id || computePatternId(part.canonicalKey),
          canonicalKey: part.canonicalKey,
          canonicalTokens: part.canonicalTokens,
          propGroups,
          classCount: part.canonicalTokens.length,
          timesFound: entry.timesFound || 0,
          exactMatches: entry.exactMatches || 0,
          subsetMatches: entry.subsetMatches || 0,
          fileCount: entry.fileCount || 0,
          files: entry.files || [],
          elements: Array.isArray(entry.elements)
            ? Array.from(new Set(entry.elements.map(sanitizeElementName).filter(Boolean)))
            : [],
          occurrences: [],
          qualifies: true,
          autoName: entry.autoName || finalName,
          finalName,
          customName: custom,
          category: sanitizeCategory(entry.category),
          label: sanitizeCommentText(entry.label) || finalName,
          confidence: 1,
          nameSource: custom ? "dictionary" : "auto",
        });
      }
    }

    if (!config.strictDictionary) {
      const takenNames = new Set(active.map((a) => a.finalName));
      for (const p of analysis.extractablePatterns) {
        if (!mentionedCanonical.has(p.canonicalKey) && !takenNames.has(p.autoName)) {
          active.push({
            ...p,
            finalName: p.autoName,
            customName: "",
            nameSource: "auto",
          });
          takenNames.add(p.autoName);
        }
      }
    }

    ensureUniqueFinalNames(active);
    return active;
  }

  // Case 3: Flat key-value dictionary `{ "flex items-center ...": "my-nav", "btn-primary": "cta" }`
  if (typeof dictionary === "object") {
    const activeMap = new Map();
    for (const p of analysis.extractablePatterns) {
      activeMap.set(p.canonicalKey, {
        ...p,
        finalName: p.autoName,
        customName: "",
        nameSource: "auto",
      });
    }

    for (const [rawKey, rawTarget] of Object.entries(dictionary)) {
      if (rawKey.startsWith("$")) continue;
      if (rawTarget === false || rawTarget === null) {
        // Allow disabling via `{ "navbar": false }` or `{ "tc_12345678": false }`
        const pat =
          byId.get(rawKey) ||
          byAutoName.get(rawKey) ||
          byCanonical.get(
            partitionAndCanonicalize(rawKey, {
              tailwindPrefix: config.tailwindPrefix || "",
            }).canonicalKey
          );
        if (pat) activeMap.delete(pat.canonicalKey);
        continue;
      }

      if (typeof rawTarget !== "string" || !rawTarget.trim()) continue;
      const customName = sanitizeCustomClassName(rawTarget);
      if (!customName) continue;

      // Match by ID, by autoName, or by canonicalized class list
      let targetPat = byId.get(rawKey) || byAutoName.get(rawKey) || null;
      if (!targetPat) {
        const canon = partitionAndCanonicalize(rawKey, {
          tailwindPrefix: config.tailwindPrefix || "",
        });
        if (canon.canonicalKey) {
          targetPat = byCanonical.get(canon.canonicalKey) || {
            id: computePatternId(canon.canonicalKey),
            canonicalKey: canon.canonicalKey,
            canonicalTokens: canon.canonicalTokens,
            propGroups: new Set(canon.applyableInfos.map((i) => i.propertyGroup)),
            classCount: canon.canonicalTokens.length,
            timesFound: 0,
            exactMatches: 0,
            subsetMatches: 0,
            fileCount: 0,
            files: [],
            elements: [],
            occurrences: [],
            qualifies: true,
            autoName: customName,
            category: "custom",
            label: customName,
            confidence: 1,
          };
        }
      }

      if (targetPat) {
        activeMap.set(targetPat.canonicalKey, {
          ...targetPat,
          finalName: customName,
          customName,
          nameSource: "dictionary",
        });
      }
    }

    const active = Array.from(activeMap.values());
    ensureUniqueFinalNames(active);
    return active;
  }

  return [];
}

/**
 * Validate that two distinct class patterns do not emit conflicting identical
 * CSS class names. Throws a descriptive error if a user mapped two different
 * patterns to the exact same custom class name.
 * @param {Array<object>} activeMappings
 */
function ensureUniqueFinalNames(activeMappings) {
  const seen = new Map();
  for (const item of activeMappings) {
    const prev = seen.get(item.finalName);
    if (prev && prev.canonicalKey !== item.canonicalKey) {
      throw new Error(
        `Duplicate class name "${item.finalName}" assigned to two distinct Tailwind patterns (${prev.id} and ${item.id}). Give each pattern a unique name in your dictionary.`
      );
    }
    seen.set(item.finalName, item);
  }
}

/**
 * Render a Markdown report for Class List Mode (`--report report.md`).
 * @param {object} dictionaryPayload
 * @returns {string}
 */
function formatClassListMarkdown(dictionaryPayload) {
  const s = dictionaryPayload.summary;
  const lines = [
    "# TailClass — Site Class List Report",
    "",
    `Generated: \`${dictionaryPayload.generatedAt}\``,
    "",
    "## Summary",
    "",
    "| Metric | Count |",
    "| --- | ---: |",
    `| Files scanned | ${s.filesScanned} |`,
    `| Files containing classes | ${s.filesWithClasses} |`,
    `| Total class attributes | ${s.totalClassAttributes} |`,
    `| Total Tailwind utility occurrences | ${s.totalUtilityTokens} |`,
    `| Unique Tailwind utilities | ${s.uniqueUtilityTokens} |`,
    `| Unique class combinations | ${s.uniqueClassPatterns} |`,
    `| Extractable repeated layouts | ${s.extractablePatterns} |`,
    "",
    "## Layout Patterns",
    "",
    "| ID | Auto Name | Custom Name | Classes (#) | Times Found | Elements | Files | Utilities |",
    "| --- | --- | --- | ---: | ---: | --- | --- | --- |",
  ];

  for (const m of dictionaryPayload.mappings) {
    const fileSummary = m.files
      .map((f) => `\`${f.file}\` (L${f.lines.join(",")})`)
      .join(", ");
    lines.push(
      `| \`${m.id}\` | \`.${m.autoName}\` | ${m.customName ? `\`.${m.customName}\`` : "—"} | ${m.classCount} | ${m.timesFound} | ${m.elements.map((e) => `\`<${e}>\``).join(", ")} | ${fileSummary} | \`${m.classes}\` |`
    );
  }

  if (Array.isArray(dictionaryPayload.utilityInventory) && dictionaryPayload.utilityInventory.length > 0) {
    lines.push(
      "",
      "## Top Individual Tailwind Utilities",
      "",
      "| Utility | Times Found | Files Count | Files |",
      "| --- | ---: | ---: | --- |"
    );
    for (const u of dictionaryPayload.utilityInventory.slice(0, 50)) {
      lines.push(
        `| \`${u.utility}\` | ${u.timesFound} | ${u.fileCount} | ${u.files.map((f) => `\`${f}\``).join(", ")} |`
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Render a CSV export for Class List Mode (`--report report.csv`).
 * @param {object} dictionaryPayload
 * @returns {string}
 */
function formatClassListCsv(dictionaryPayload) {
  const esc = (val) => `"${String(val ?? "").replace(/"/g, '""')}"`;
  const rows = [
    [
      "id",
      "autoName",
      "customName",
      "enabled",
      "category",
      "classCount",
      "timesFound",
      "fileCount",
      "elements",
      "files",
      "classes",
    ].join(","),
  ];

  for (const m of dictionaryPayload.mappings) {
    const filesStr = m.files.map((f) => `${f.file}:${f.lines.join("+")}`).join("; ");
    rows.push(
      [
        esc(m.id),
        esc(m.autoName),
        esc(m.customName),
        esc(m.enabled),
        esc(m.category),
        m.classCount,
        m.timesFound,
        m.fileCount,
        esc(m.elements.join(" ")),
        esc(filesStr),
        esc(m.classes),
      ].join(",")
    );
  }

  return rows.join("\n") + "\n";
}

module.exports = {
  sanitizeCustomClassName,
  buildDictionaryPayload,
  loadDictionary,
  resolveActiveMappings,
  formatClassListMarkdown,
  formatClassListCsv,
};

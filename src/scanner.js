"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { findFiles, matchesAnyGlob, toPosixPath } = require("./glob");
const { partitionAndCanonicalize, splitClassTokens } = require("./tailwind");

const VOID_HTML_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const HELPER_FN_RE = /\b(?:clsx|cn|classnames|classNames|twMerge|twJoin|cva)\s*\(/g;

/**
 * Build an array of 0-based character indices for the start of each line.
 * @param {string} source
 * @returns {number[]}
 */
function buildLineIndex(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

/**
 * Convert a 0-based character offset to 1-based `{ line, column }`.
 * @param {number[]} lineStarts
 * @param {number} offset
 * @returns {{ line: number, column: number }}
 */
function offsetToLineCol(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  const lineIdx = Math.max(0, hi);
  return {
    line: lineIdx + 1,
    column: offset - lineStarts[lineIdx] + 1,
  };
}

/**
 * Advance past a JS/HTML quoted string starting at `quoteIdx`.
 * Returns the index of the closing quote, or `source.length` if unterminated.
 * @param {string} source
 * @param {number} quoteIdx
 * @returns {number}
 */
function skipQuotedString(source, quoteIdx) {
  const quote = source[quoteIdx];
  let i = quoteIdx + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (quote === "`" && ch === "$" && source[i + 1] === "{") {
      i = skipBalancedBraces(source, i + 1);
      i++;
      continue;
    }
    if (ch === quote) return i;
    i++;
  }
  return source.length;
}

/**
 * Advance past a `{ ... }` block starting at `openBraceIdx` (where `source[openBraceIdx] === '{'`).
 * Returns the index of the matching `}`, or `source.length` if unbalanced.
 * @param {string} source
 * @param {number} openBraceIdx
 * @returns {number}
 */
function skipBalancedBraces(source, openBraceIdx) {
  let depth = 0;
  let i = openBraceIdx;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipQuotedString(source, i) + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const endComment = source.indexOf("*/", i + 2);
      i = endComment === -1 ? source.length : endComment + 2;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i + 2);
      i = nl === -1 ? source.length : nl + 1;
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return source.length;
}

/**
 * Extract safe static class segments from a template literal starting at `backtickStart`
 * and ending at `backtickEnd`. Tokens glued directly to `${...}` without whitespace
 * (e.g. `bg-${color}-500`) are left untouched so dynamic interpolations never break.
 *
 * @param {string} source
 * @param {number} backtickStart
 * @param {number} backtickEnd
 * @returns {Array<{ valueStart: number, valueEnd: number, rawValue: string }>}
 */
function extractTemplateLiteralSegments(source, backtickStart, backtickEnd) {
  const segments = [];
  let segStart = backtickStart + 1;
  let afterExpr = false;
  let i = segStart;

  function pushSafeQuasi(start, end, gluedLeft, gluedRight) {
    let s = start;
    let e = end;

    // If glued immediately after `}`, skip the trailing fragment of the dynamic token
    if (gluedLeft && s < e && !/\s/.test(source[s])) {
      while (s < e && !/\s/.test(source[s])) s++;
    }
    // If glued immediately before `${`, skip the leading fragment of the dynamic token
    if (gluedRight && s < e && !/\s/.test(source[e - 1])) {
      while (e > s && !/\s/.test(source[e - 1])) e--;
    }

    const raw = source.slice(s, e);
    if (raw.trim().length > 0) {
      segments.push({ valueStart: s, valueEnd: e, rawValue: raw });
    }
  }

  while (i < backtickEnd) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "$" && source[i + 1] === "{") {
      pushSafeQuasi(segStart, i, afterExpr, true);
      const exprOpen = i + 1;
      const exprClose = skipBalancedBraces(source, exprOpen);
      // Also extract standalone quoted string literals inside `${ cond ? "..." : "..." }`
      for (const inner of extractStringLiteralsInRegion(source, exprOpen + 1, exprClose)) {
        segments.push(inner);
      }
      i = exprClose + 1;
      segStart = i;
      afterExpr = true;
      continue;
    }
    i++;
  }

  pushSafeQuasi(segStart, backtickEnd, afterExpr, false);
  return segments;
}

/**
 * Extract standalone single/double/template string literals inside a JS expression
 * region (e.g. inside `className={...}` or `clsx(...)`), skipping object keys
 * (`{ "btn-active": isActive }` —Wait: actually even object keys in `clsx({ "flex p-4": ok })`
 * ARE class strings! Wait: what about `data.type === "primary"`? Non-Tailwind strings like
 * `"primary"` have < minClasses Tailwind tokens anyway and won't be extracted, EXCEPT we
 * should skip `=== "..."`, `!== "..."`, `== "..."`, `!= "..."` comparisons just to be extra safe!).
 *
 * @param {string} source
 * @param {number} regionStart
 * @param {number} regionEnd
 * @returns {Array<{ valueStart: number, valueEnd: number, rawValue: string }>}
 */
function extractStringLiteralsInRegion(source, regionStart, regionEnd) {
  const results = [];
  let i = regionStart;

  while (i < regionEnd) {
    const ch = source[i];

    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? regionEnd : end + 2;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i + 2);
      i = end === -1 ? regionEnd : end + 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const close = skipQuotedString(source, i);
      if (close < regionEnd) {
        // Check preceding non-whitespace tokens to avoid comparison strings (`role === "flex"`)
        const before = source.slice(Math.max(regionStart, i - 8), i).trimEnd();
        const isComparison = /(?:===|!==|==|!=)$/.test(before);
        if (!isComparison) {
          const rawValue = source.slice(i + 1, close);
          if (rawValue.trim().length > 0) {
            results.push({
              valueStart: i + 1,
              valueEnd: close,
              rawValue,
            });
          }
        }
      }
      i = close + 1;
      continue;
    }

    if (ch === "`") {
      const close = skipQuotedString(source, i);
      if (close < regionEnd) {
        for (const seg of extractTemplateLiteralSegments(source, i, close)) {
          results.push(seg);
        }
      }
      i = close + 1;
      continue;
    }

    i++;
  }

  return results;
}

/**
 * Parse an opening markup/JSX tag starting at `tagOpenIdx` (`source[tagOpenIdx] === '<'`).
 * Returns `null` if the `<` is not a valid opening tag (e.g. `a < b` comparison).
 *
 * @param {string} source
 * @param {number} tagOpenIdx
 */
function parseOpeningTag(source, tagOpenIdx) {
  const len = source.length;
  let i = tagOpenIdx + 1;

  const nameMatch = source.slice(i, i + 80).match(/^([a-zA-Z][a-zA-Z0-9._:-]*)/);
  if (!nameMatch) return null;

  const rawTagName = nameMatch[1];
  i += rawTagName.length;

  // Handle optional TypeScript generic on JSX component `<Select<Option> className="...">`
  if (source[i] === "<") {
    const closeGen = source.indexOf(">", i + 1);
    if (closeGen !== -1 && closeGen - i < 80) {
      i = closeGen + 1;
    }
  }

  // Next character after tag name must be whitespace, `/`, or `>`
  if (i < len && !/[\s/>]/.test(source[i])) {
    return null;
  }

  const passiveAttrs = {};
  const classSlices = [];
  let selfClosing = false;

  while (i < len) {
    while (i < len && /\s/.test(source[i])) i++;
    if (i >= len) return null;

    if (source[i] === ">") {
      return {
        tagName: rawTagName,
        tagEndIdx: i,
        selfClosing,
        attributes: passiveAttrs,
        classSlices,
      };
    }

    if (source[i] === "/" && source[i + 1] === ">") {
      selfClosing = true;
      return {
        tagName: rawTagName,
        tagEndIdx: i + 1,
        selfClosing: true,
        attributes: passiveAttrs,
        classSlices,
      };
    }

    // JSX spread attribute `{...props}`
    if (source[i] === "{") {
      i = skipBalancedBraces(source, i) + 1;
      continue;
    }

    // Comments inside multiline tags
    if (source[i] === "/" && source[i + 1] === "*") {
      const endC = source.indexOf("*/", i + 2);
      i = endC === -1 ? len : endC + 2;
      continue;
    }
    if (source[i] === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i + 2);
      i = nl === -1 ? len : nl + 1;
      continue;
    }

    // If we hit characters impossible at attribute start in markup, abort tag parse (was `<` operator)
    if (/[;|&=()[\]]/.test(source[i])) {
      return null;
    }

    const attrMatch = source.slice(i, i + 100).match(/^([:@a-zA-Z_][a-zA-Z0-9_.:-]*)/);
    if (!attrMatch) {
      return null;
    }

    const attrName = attrMatch[1];
    i += attrName.length;

    while (i < len && /\s/.test(source[i])) i++;

    // Boolean attribute without `=value`
    if (source[i] !== "=") {
      passiveAttrs[attrName.toLowerCase()] = "true";
      continue;
    }

    i++; // skip '='
    while (i < len && /\s/.test(source[i])) i++;
    if (i >= len) return null;

    const isClassAttr =
      attrName === "class" ||
      attrName === "className" ||
      attrName === ":class" ||
      attrName === "v-bind:class" ||
      attrName === "class:list" ||
      attrName === "ngClass";

    const valCh = source[i];

    if (valCh === '"' || valCh === "'") {
      const closeQuote = skipQuotedString(source, i);
      const rawVal = source.slice(i + 1, closeQuote);
      if (isClassAttr) {
        if (attrName === ":class" || attrName === "v-bind:class") {
          for (const lit of extractStringLiteralsInRegion(source, i + 1, closeQuote)) {
            classSlices.push({ ...lit, attrName, syntax: "vue-bind" });
          }
        } else {
          classSlices.push({
            valueStart: i + 1,
            valueEnd: closeQuote,
            rawValue: rawVal,
            attrName,
            syntax: "static",
          });
        }
      } else {
        passiveAttrs[attrName.toLowerCase()] = rawVal;
      }
      i = closeQuote + 1;
      continue;
    }

    if (valCh === "{") {
      const closeBrace = skipBalancedBraces(source, i);
      if (isClassAttr) {
        for (const lit of extractStringLiteralsInRegion(source, i + 1, closeBrace)) {
          classSlices.push({ ...lit, attrName, syntax: "expression" });
        }
      } else {
        const inner = source.slice(i + 1, closeBrace).trim();
        if (
          (inner.startsWith('"') && inner.endsWith('"')) ||
          (inner.startsWith("'") && inner.endsWith("'"))
        ) {
          passiveAttrs[attrName.toLowerCase()] = inner.slice(1, -1);
        }
      }
      i = closeBrace + 1;
      continue;
    }

    // Unquoted HTML attribute value: `class=btn` or `type=submit`
    let unqEnd = i;
    while (unqEnd < len && !/[\s/>]/.test(source[unqEnd])) unqEnd++;
    const rawUnq = source.slice(i, unqEnd);
    if (!isClassAttr) {
      passiveAttrs[attrName.toLowerCase()] = rawUnq;
    }
    i = unqEnd;
  }

  return null;
}

/**
 * Scan a single file's source text and return all discovered class occurrences,
 * token inventory counts, and existing custom class names.
 *
 * @param {string} source
 * @param {string} filePath
 * @param {Record<string, any>} config
 */
function scanSource(source, filePath, config = {}) {
  const relFile = toPosixPath(filePath);
  const ext = path.extname(relFile).toLowerCase();
  const isScriptOnly = [".js", ".ts", ".mjs", ".cjs"].includes(ext);
  const lineStarts = buildLineIndex(source);

  const ignoreTags = new Set((config.ignoreTags || []).map((t) => String(t).toLowerCase()));
  const onlyTags = new Set((config.onlyTags || []).map((t) => String(t).toLowerCase()));
  const excludePatterns = config.excludePatterns || [];
  const excludeClasses = config.excludeClasses || [];
  const includeClasses = config.includeClasses || [];

  const isExcludedToken =
    excludeClasses.length > 0 ? (tok) => matchesAnyGlob(tok, excludeClasses) : undefined;
  const isIncludedToken =
    includeClasses.length > 0 ? (tok) => matchesAnyGlob(tok, includeClasses) : undefined;

  const occurrences = [];
  const coveredRanges = [];
  const ignoredRanges = [];
  const existingCustomClasses = new Set();
  const utilityFrequency = new Map(); // utility -> { count, files: Set }
  const tagStack = [];

  let i = 0;
  const len = source.length;

  while (i < len) {
    // Skip HTML comments <!-- ... -->
    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      const nextIdx = end === -1 ? len : end + 3;
      ignoredRanges.push([i, nextIdx]);
      i = nextIdx;
      continue;
    }

    // Skip block comments /* ... */
    if (source[i] === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const nextIdx = end === -1 ? len : end + 2;
      ignoredRanges.push([i, nextIdx]);
      i = nextIdx;
      continue;
    }

    // Skip line comments in JS/TS/JSX/TSX (avoiding `https://` protocol slashes)
    if (
      (isScriptOnly || ext === ".jsx" || ext === ".tsx") &&
      source[i] === "/" &&
      source[i + 1] === "/" &&
      (i === 0 || source[i - 1] !== ":")
    ) {
      const nl = source.indexOf("\n", i + 2);
      const nextIdx = nl === -1 ? len : nl + 1;
      ignoredRanges.push([i, nextIdx]);
      i = nextIdx;
      continue;
    }

    // Closing tag `</nav>`
    if (source[i] === "<" && source[i + 1] === "/") {
      const closeMatch = source.slice(i + 2, i + 80).match(/^([a-zA-Z][a-zA-Z0-9._:-]*)\s*>/);
      if (closeMatch) {
        const closingName = closeMatch[1].toLowerCase();
        for (let s = tagStack.length - 1; s >= 0; s--) {
          if (tagStack[s].tag === closingName) {
            tagStack.length = s;
            break;
          }
        }
        i += 2 + closeMatch[0].length;
        continue;
      }
    }

    // Opening tag `<nav ...>`
    if (source[i] === "<" && /[a-zA-Z]/.test(source[i + 1] || "")) {
      const parsedTag = parseOpeningTag(source, i);
      if (parsedTag) {
        const lowerTag = parsedTag.tagName.toLowerCase();

        // Skip raw <style>...</style> blocks completely
        if (lowerTag === "style" && !parsedTag.selfClosing) {
          const closeStyle = source.toLowerCase().indexOf("</style>", parsedTag.tagEndIdx + 1);
          const nextIdx = closeStyle === -1 ? len : closeStyle + 8;
          ignoredRanges.push([parsedTag.tagEndIdx + 1, nextIdx]);
          i = nextIdx;
          continue;
        }

        const parentEntry = tagStack.length > 0 ? tagStack[tagStack.length - 1] : null;
        const ancestors = tagStack.map((t) => t.tag);

        const tagAllowed =
          !ignoreTags.has(lowerTag) && (onlyTags.size === 0 || onlyTags.has(lowerTag));

        if (tagAllowed) {
          for (const slice of parsedTag.classSlices) {
            recordClassSlice({
              slice,
              rawTagName: parsedTag.tagName,
              lowerTag,
              parentTag: parentEntry ? parentEntry.tag : null,
              ancestors,
              attributes: parsedTag.attributes,
            });
          }
        }

        // Skip raw RCDATA inside <textarea>...</textarea> so literal sample text is never rewritten
        if (lowerTag === "textarea" && !parsedTag.selfClosing) {
          const closeTa = source.toLowerCase().indexOf("</textarea>", parsedTag.tagEndIdx + 1);
          const nextIdx = closeTa === -1 ? len : closeTa + 11;
          ignoredRanges.push([parsedTag.tagEndIdx + 1, nextIdx]);
          i = nextIdx;
          continue;
        }

        if (!parsedTag.selfClosing && !VOID_HTML_TAGS.has(lowerTag)) {
          tagStack.push({ tag: lowerTag, rawTag: parsedTag.tagName });
        }

        i = parsedTag.tagEndIdx + 1;
        continue;
      }
    }

    i++;
  }

  // Scan standalone helper calls (`clsx(...)`, `cn(...)`, `twMerge(...)`, `cva(...)`)
  // outside already-recorded tag attribute ranges and outside comments/<style>/<textarea>
  if (config.scanHelpers !== false) {
    HELPER_FN_RE.lastIndex = 0;
    let m;
    while ((m = HELPER_FN_RE.exec(source)) !== null) {
      const inIgnored = ignoredRanges.some(([s, e]) => m.index >= s && m.index < e);
      if (inIgnored) continue;

      const openParenIdx = m.index + m[0].length - 1;
      const closeParenIdx = skipBalancedParens(source, openParenIdx);
      const lits = extractStringLiteralsInRegion(source, openParenIdx + 1, closeParenIdx);
      for (const slice of lits) {
        const alreadyCovered = coveredRanges.some(
          ([s, e]) => slice.valueStart >= s && slice.valueEnd <= e
        );
        const litIgnored = ignoredRanges.some(
          ([s, e]) => slice.valueStart >= s && slice.valueEnd <= e
        );
        if (!alreadyCovered && !litIgnored) {
          recordClassSlice({
            slice: { ...slice, attrName: "helper", syntax: "helper" },
            rawTagName: "div",
            lowerTag: "div",
            parentTag: null,
            ancestors: [],
            attributes: {},
          });
        }
      }
    }
  }

  function recordClassSlice({
    slice,
    rawTagName,
    lowerTag,
    parentTag,
    ancestors,
    attributes,
  }) {
    coveredRanges.push([slice.valueStart, slice.valueEnd]);
    const rawTokens = splitClassTokens(slice.rawValue);
    if (rawTokens.length === 0) return;

    const skippedByPattern =
      excludePatterns.length > 0 &&
      rawTokens.some((tok) => matchesAnyGlob(tok, excludePatterns));

    const partitioned = partitionAndCanonicalize(rawTokens, {
      tailwindPrefix: config.tailwindPrefix || "",
      isExcludedToken,
      isIncludedToken,
    });

    for (const inlineTok of partitioned.inlineTokens) {
      existingCustomClasses.add(inlineTok);
    }

    for (const twInfo of partitioned.allTailwindTokens) {
      utilityFrequency.set(twInfo.raw, (utilityFrequency.get(twInfo.raw) || 0) + 1);
    }

    if (skippedByPattern) return;

    const leadingMatch = slice.rawValue.match(/^(\s*)/);
    const trailingMatch = slice.rawValue.match(/(\s*)$/);
    const rawLeading = leadingMatch ? leadingMatch[1] : "";
    const rawTrailing =
      slice.rawValue.trim().length > 0 && trailingMatch ? trailingMatch[1] : "";

    const leadingWs =
      slice.syntax === "static" && rawLeading.includes("\n") ? "" : rawLeading;
    const trailingWs =
      slice.syntax === "static" && rawTrailing.includes("\n") ? "" : rawTrailing;

    const { line, column } = offsetToLineCol(lineStarts, slice.valueStart);

    occurrences.push({
      file: relFile,
      line,
      column,
      valueStart: slice.valueStart,
      valueEnd: slice.valueEnd,
      rawValue: slice.rawValue,
      leadingWs,
      trailingWs,
      attrName: slice.attrName,
      syntax: slice.syntax,
      tag: lowerTag,
      rawTag: rawTagName,
      parentTag,
      ancestors,
      attributes,
      canonicalTokens: partitioned.canonicalTokens,
      canonicalKey: partitioned.canonicalKey,
      applyableInfos: partitioned.applyableInfos,
      inlineTokens: partitioned.inlineTokens,
    });
  }

  return {
    file: relFile,
    occurrences,
    existingCustomClasses,
    utilityFrequency,
  };
}

/**
 * Advance past balanced parentheses starting at `openParenIdx`.
 * @param {string} source
 * @param {number} openParenIdx
 * @returns {number}
 */
function skipBalancedParens(source, openParenIdx) {
  let depth = 0;
  let i = openParenIdx;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipQuotedString(source, i) + 1;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return source.length;
}

/**
 * Scan an entire project directory according to resolved configuration.
 * @param {string} rootDir
 * @param {Record<string, any>} config
 */
function scanDirectory(rootDir, config) {
  const absRoot = path.resolve(rootDir || ".");
  const files = findFiles(absRoot, {
    include: config.include,
    exclude: config.exclude,
  });

  const fileResults = [];
  const allOccurrences = [];
  const existingCustomClasses = new Set();
  const utilityInventoryMap = new Map(); // token -> { count, files: Set<string> }

  for (const relFile of files) {
    const fullPath = path.join(absRoot, relFile);
    let source;
    try {
      source = fs.readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }
    // Skip binary files quickly
    if (source.includes("\u0000")) continue;

    const scanned = scanSource(source, relFile, config);
    fileResults.push(scanned);

    for (const occ of scanned.occurrences) {
      allOccurrences.push(occ);
    }
    for (const custom of scanned.existingCustomClasses) {
      existingCustomClasses.add(custom);
    }
    for (const [tok, count] of scanned.utilityFrequency.entries()) {
      if (!utilityInventoryMap.has(tok)) {
        utilityInventoryMap.set(tok, { token: tok, count: 0, files: new Set() });
      }
      const entry = utilityInventoryMap.get(tok);
      entry.count += count;
      entry.files.add(relFile);
    }
  }

  const utilityInventory = Array.from(utilityInventoryMap.values())
    .map((entry) => ({
      utility: entry.token,
      timesFound: entry.count,
      fileCount: entry.files.size,
      files: Array.from(entry.files).sort(),
    }))
    .sort((a, b) => b.timesFound - a.timesFound || a.utility.localeCompare(b.utility));

  return {
    rootDir: absRoot,
    filesScanned: files,
    fileResults,
    occurrences: allOccurrences,
    existingCustomClasses,
    utilityInventory,
  };
}

module.exports = {
  buildLineIndex,
  offsetToLineCol,
  scanSource,
  scanDirectory,
};

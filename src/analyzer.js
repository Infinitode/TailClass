"use strict";

const crypto = require("node:crypto");
const { assignUniqueNames } = require("./namer");
const { expandCssAxes, partitionAndCanonicalize } = require("./tailwind");

/**
 * Deterministic short pattern ID derived from the canonical Tailwind key.
 * @param {string} canonicalKey
 * @returns {string}
 */
function computePatternId(canonicalKey) {
  const digest = crypto.createHash("sha256").update(canonicalKey).digest("hex");
  return `tc_${digest.slice(0, 8)}`;
}

/**
 * Memoised token sets for occurrences. Subset checks run in nested loops, so
 * rebuilding a Set per comparison turns large sites quadratic for no reason.
 * @type {WeakMap<object, Set<string>>}
 */
const occurrenceTokenSets = new WeakMap();

/**
 * @param {object} occurrence
 * @returns {Set<string>}
 */
function getOccurrenceTokenSet(occurrence) {
  let set = occurrenceTokenSets.get(occurrence);
  if (!set) {
    set = new Set(occurrence.canonicalTokens);
    occurrenceTokenSets.set(occurrence, set);
  }
  return set;
}

/**
 * Build expanded atomic CSS property axes set from a set of propertyGroups.
 * @param {Set<string> | Iterable<string>} patternPropGroups
 * @returns {Set<string>}
 */
function buildExpandedAxesSet(patternPropGroups) {
  const axes = new Set();
  for (const grp of patternPropGroups || []) {
    axes.add(grp);
    for (const leaf of expandCssAxes(grp)) {
      axes.add(leaf);
    }
  }
  return axes;
}

/**
 * Check whether `candidatePattern` can cleanly substitute into `occurrence`
 * as an exact match or conflict-free subset (verifying both exact property
 * groups and shorthand/longhand CSS box-model axes such as `p` vs `px`,
 * `rounded` vs `rounded-b`, and `text-lg` vs `leading-none`).
 *
 * @param {string[]} patternTokens
 * @param {Set<string>} patternPropGroups
 * @param {object} occurrence
 * @returns {{ matches: boolean, isExact: boolean, residualTokens: string[] }}
 */
function checkSubsetCompatibility(patternTokens, patternPropGroups, occurrence) {
  const occTokens = occurrence.canonicalTokens;
  if (patternTokens.length > occTokens.length) {
    return { matches: false, isExact: false, residualTokens: [] };
  }

  const occSet = getOccurrenceTokenSet(occurrence);
  for (const t of patternTokens) {
    if (!occSet.has(t)) {
      return { matches: false, isExact: false, residualTokens: [] };
    }
  }

  if (patternTokens.length === occTokens.length) {
    return { matches: true, isExact: true, residualTokens: [] };
  }

  const expandedPatternAxes = buildExpandedAxesSet(patternPropGroups);
  const patSet = new Set(patternTokens);
  const residualTokens = [];

  for (const info of occurrence.applyableInfos) {
    if (!patSet.has(info.raw)) {
      const infoAxes = info.cssAxes || expandCssAxes(info.propertyGroup);
      if (
        expandedPatternAxes.has(info.propertyGroup) ||
        infoAxes.some((ax) => expandedPatternAxes.has(ax))
      ) {
        return { matches: false, isExact: false, residualTokens: [] };
      }
      residualTokens.push(info.raw);
    }
  }

  return { matches: true, isExact: false, residualTokens };
}

/**
 * Build structured file breakdown array from a list of occurrences.
 * @param {Array<object>} occurrences
 */
function summarizePatternFiles(occurrences) {
  const byFile = new Map();
  for (const occ of occurrences) {
    if (!byFile.has(occ.file)) {
      byFile.set(occ.file, { file: occ.file, count: 0, lines: [] });
    }
    const entry = byFile.get(occ.file);
    entry.count += 1;
    if (!entry.lines.includes(occ.line)) {
      entry.lines.push(occ.line);
    }
  }
  return Array.from(byFile.values())
    .map((e) => ({
      file: e.file,
      count: e.count,
      lines: e.lines.sort((a, b) => a - b),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Analyze scan results to identify repeated Tailwind layouts, shared base
 * intersections (when `subsetMatching` is enabled), and complete site statistics.
 *
 * @param {object} scanResult - Output of `scanDirectory` or aggregated `scanSource`
 * @param {Record<string, any>} config - Resolved TailClass configuration
 */
function analyzeScanResult(scanResult, config = {}) {
  const minOccurrences = Math.max(1, Number(config.minOccurrences) || 2);
  const minClasses = Math.max(1, Number(config.minClasses) || 3);
  const maxClasses = Math.max(0, Number(config.maxClasses) || 0);
  const minFiles = Math.max(1, Number(config.minFiles) || 1);
  const subsetMatching = config.subsetMatching !== false;
  const subsetMinClasses = Math.max(minClasses, Number(config.subsetMinClasses) || 4);

  const exactGroups = new Map(); // canonicalKey -> occurrences[]

  for (const occ of scanResult.occurrences) {
    const count = occ.canonicalTokens.length;
    if (count === 0) continue;
    if (!exactGroups.has(occ.canonicalKey)) {
      exactGroups.set(occ.canonicalKey, []);
    }
    exactGroups.get(occ.canonicalKey).push(occ);
  }

  const allPatterns = [];
  const extractedMap = new Map(); // canonicalKey -> patternObj
  const claimedOccurrences = new Set();

  // Pass 1: Collect all exact groups & mark those meeting exact thresholds
  for (const [canonicalKey, occs] of exactGroups.entries()) {
    const sample = occs[0];
    const classCount = sample.canonicalTokens.length;
    const files = summarizePatternFiles(occs);
    const elements = Array.from(new Set(occs.map((o) => o.tag))).sort();
    const propGroups = new Set(sample.applyableInfos.map((i) => i.propertyGroup));

    const withinMax = maxClasses === 0 || classCount <= maxClasses;
    const qualifiesExact =
      classCount >= minClasses &&
      withinMax &&
      occs.length >= minOccurrences &&
      files.length >= minFiles;

    const patternObj = {
      id: computePatternId(canonicalKey),
      canonicalKey,
      canonicalTokens: sample.canonicalTokens,
      propGroups,
      classCount,
      timesFound: occs.length,
      exactMatches: occs.length,
      subsetMatches: 0,
      fileCount: files.length,
      files,
      elements,
      occurrences: [...occs],
      qualifies: qualifiesExact,
      matchType: "exact",
    };

    allPatterns.push(patternObj);

    if (qualifiesExact) {
      extractedMap.set(canonicalKey, patternObj);
      for (const o of occs) claimedOccurrences.add(o);
    }
  }

  // Pass 2: Smart Subset & Shared-Foundation Discovery on unclaimed occurrences
  if (subsetMatching) {
    // 2a: First match unclaimed superset elements against already-qualified exact patterns
    const initialUnclaimed = scanResult.occurrences.filter(
      (o) => !claimedOccurrences.has(o) && o.canonicalTokens.length >= subsetMinClasses
    );
    const exactQualifiedBySize = Array.from(extractedMap.values()).sort(
      (a, b) => b.classCount - a.classCount
    );

    for (const occ of initialUnclaimed) {
      for (const pat of exactQualifiedBySize) {
        if (pat.classCount < subsetMinClasses) continue;
        const compat = checkSubsetCompatibility(pat.canonicalTokens, pat.propGroups, occ);
        if (compat.matches) {
          pat.occurrences.push(occ);
          pat.timesFound += 1;
          pat.subsetMatches += 1;
          pat.files = summarizePatternFiles(pat.occurrences);
          pat.fileCount = pat.files.length;
          claimedOccurrences.add(occ);
          break;
        }
      }
    }

    // 2b: Check if existing 1-occurrence patterns are subsets of other unclaimed occurrences
    const unclaimed = scanResult.occurrences.filter(
      (o) => !claimedOccurrences.has(o) && o.canonicalTokens.length >= subsetMinClasses
    );

    for (const pat of allPatterns) {
      if (pat.qualifies) continue;
      if (pat.classCount < subsetMinClasses) continue;
      if (maxClasses > 0 && pat.classCount > maxClasses) continue;

      const matchedOccs = [...pat.occurrences];
      const alreadyMatched = new Set(pat.occurrences);
      for (const occ of unclaimed) {
        if (alreadyMatched.has(occ)) continue;
        const compat = checkSubsetCompatibility(pat.canonicalTokens, pat.propGroups, occ);
        if (compat.matches) {
          matchedOccs.push(occ);
        }
      }

      const files = summarizePatternFiles(matchedOccs);
      if (matchedOccs.length >= minOccurrences && files.length >= minFiles) {
        pat.qualifies = true;
        pat.timesFound = matchedOccs.length;
        pat.subsetMatches = matchedOccs.length - pat.exactMatches;
        pat.files = files;
        pat.fileCount = files.length;
        pat.occurrences = matchedOccs;
        pat.elements = Array.from(new Set(matchedOccs.map((o) => o.tag))).sort();
        extractedMap.set(pat.canonicalKey, pat);
        for (const o of matchedOccs) claimedOccurrences.add(o);
      }
    }

    // 2c: Pairwise shared-base discovery among remaining unclaimed occurrences of the same tag
    const stillUnclaimed = scanResult.occurrences.filter(
      (o) => !claimedOccurrences.has(o) && o.canonicalTokens.length >= subsetMinClasses
    );

    const candidateIntersections = new Map(); // canonicalKey -> token array
    const byTag = new Map();
    for (const occ of stillUnclaimed) {
      if (!byTag.has(occ.tag)) byTag.set(occ.tag, []);
      byTag.get(occ.tag).push(occ);
    }

    for (const group of byTag.values()) {
      const limit = Math.min(group.length, 80);
      for (let i = 0; i < limit; i++) {
        const setA = new Set(group[i].canonicalTokens);
        for (let j = i + 1; j < limit; j++) {
          const shared = group[j].canonicalTokens.filter((t) => setA.has(t));
          if (shared.length >= subsetMinClasses && (maxClasses === 0 || shared.length <= maxClasses)) {
            const key = shared.join(" ");
            if (!extractedMap.has(key) && !candidateIntersections.has(key)) {
              candidateIntersections.set(key, shared);
            }
          }
        }
      }
    }

    const sortedCandidates = Array.from(candidateIntersections.entries()).sort(
      (a, b) => b[1].length - a[1].length
    );

    for (const [, sharedTokens] of sortedCandidates) {
      const part = partitionAndCanonicalize(sharedTokens, {
        tailwindPrefix: config.tailwindPrefix || "",
      });
      const propGroups = new Set(part.applyableInfos.map((i) => i.propertyGroup));

      const matchedOccs = [];
      for (const occ of stillUnclaimed) {
        if (claimedOccurrences.has(occ)) continue;
        const compat = checkSubsetCompatibility(part.canonicalTokens, propGroups, occ);
        if (compat.matches) {
          matchedOccs.push(occ);
        }
      }

      const files = summarizePatternFiles(matchedOccs);
      if (matchedOccs.length >= minOccurrences && files.length >= minFiles) {
        const synthPattern = {
          id: computePatternId(part.canonicalKey),
          canonicalKey: part.canonicalKey,
          canonicalTokens: part.canonicalTokens,
          propGroups,
          classCount: part.canonicalTokens.length,
          timesFound: matchedOccs.length,
          exactMatches: 0,
          subsetMatches: matchedOccs.length,
          fileCount: files.length,
          files,
          elements: Array.from(new Set(matchedOccs.map((o) => o.tag))).sort(),
          occurrences: matchedOccs,
          qualifies: true,
          matchType: "shared-base",
        };
        extractedMap.set(part.canonicalKey, synthPattern);
        allPatterns.push(synthPattern);
        for (const o of matchedOccs) claimedOccurrences.add(o);
      }
    }
  }

  const extractablePatterns = Array.from(extractedMap.values()).sort(
    (a, b) =>
      b.timesFound - a.timesFound ||
      b.classCount - a.classCount ||
      a.canonicalKey.localeCompare(b.canonicalKey)
  );

  // Assign collision-free smart semantic names to extractable patterns
  assignUniqueNames(extractablePatterns, scanResult.existingCustomClasses, config);

  // Also infer preview names on non-extracted patterns for `--all` class list inspection
  const nonExtracted = allPatterns
    .filter((p) => !extractedMap.has(p.canonicalKey))
    .sort((a, b) => b.timesFound - a.timesFound || b.classCount - a.classCount);

  const takenPreview = new Set([
    ...scanResult.existingCustomClasses,
    ...extractablePatterns.map((p) => p.autoName),
  ]);
  assignUniqueNames(nonExtracted, takenPreview, config);

  const totalUtilityTokens = scanResult.occurrences.reduce(
    (sum, occ) => sum + occ.canonicalTokens.length,
    0
  );

  const summary = {
    filesScanned: scanResult.filesScanned.length,
    filesWithClasses: new Set(scanResult.occurrences.map((o) => o.file)).size,
    totalClassAttributes: scanResult.occurrences.length,
    totalUtilityTokens,
    uniqueUtilityTokens: scanResult.utilityInventory.length,
    uniqueClassPatterns: allPatterns.length,
    extractablePatterns: extractablePatterns.length,
    totalReplacementsPossible: extractablePatterns.reduce((s, p) => s + p.timesFound, 0),
  };

  return {
    summary,
    extractablePatterns,
    allPatterns: [...extractablePatterns, ...nonExtracted],
    utilityInventory: scanResult.utilityInventory,
    existingCustomClasses: scanResult.existingCustomClasses,
  };
}

module.exports = {
  computePatternId,
  checkSubsetCompatibility,
  summarizePatternFiles,
  analyzeScanResult,
};

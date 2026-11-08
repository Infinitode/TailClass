#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { applyAutoClasses, generateClassList, revertProject } = require("../src");

const sampleDir = path.join(__dirname, "sample-site");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailclass-demo-"));

fs.cpSync(sampleDir, tempDir, { recursive: true });

console.log("=== 1. Generating Class List Dictionary ===");
const { dictionary, dictionaryPath } = generateClassList(tempDir);
console.log("Summary:", dictionary.summary);
console.log(
  "Auto-Detected Patterns:",
  dictionary.mappings.map((m) => `.${m.autoName} (${m.timesFound}x, ${m.classCount} classes)`)
);

// Demonstrate overriding one auto-detected name via customName in the dictionary
const navEntry = dictionary.mappings.find((m) => m.autoName === "navbar");
if (navEntry) {
  navEntry.customName = "site-navbar";
  fs.writeFileSync(dictionaryPath, JSON.stringify(dictionary, null, 2));
  console.log('\nCustomized ".navbar" -> ".site-navbar" inside tailclass.map.json!');
}

console.log("\n=== 2. Applying Centralized Classes Across Sample Site ===");
const applied = applyAutoClasses(tempDir, { dictionary: dictionaryPath });
console.log(
  `Updated ${applied.totalFilesModified} files (${applied.totalReplacements} replacements, saved ${applied.totalBytesSaved} bytes).`
);
console.log("\n--- Generated tailclass.css ---\n" + applied.cssContent);

console.log("--- Rewritten pricing.html (first 25 lines) ---");
const rewrittenPricing = fs
  .readFileSync(path.join(tempDir, "pricing.html"), "utf8")
  .split("\n")
  .slice(0, 25)
  .join("\n");
console.log(rewrittenPricing);

console.log("\n=== 3. Verifying Clean Revert ===");
const reverted = revertProject(tempDir, { clean: true });
console.log(
  `Reverted ${reverted.totalReverted} class attributes across ${reverted.totalFilesReverted} files.`
);

fs.rmSync(tempDir, { recursive: true, force: true });

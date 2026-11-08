#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function collectFiles(dir, exts, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith(".tailclass")) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, exts, results);
    } else if (exts.includes(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

let failures = 0;

// 1. Syntax check every JS / MJS file via `node --check`
const jsFiles = collectFiles(ROOT, [".js", ".mjs"]);
for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    console.error(`Syntax error in ${path.relative(ROOT, file)}:\n${err.stderr?.toString() || err.message}`);
    failures++;
  }
}

// 2. Validate every JSON file
const jsonFiles = collectFiles(ROOT, [".json"]);
for (const file of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`Invalid JSON in ${path.relative(ROOT, file)}: ${err.message}`);
    failures++;
  }
}

// 3. Ensure src/ modules do not contain stray debug console.log calls
const srcFiles = collectFiles(path.join(ROOT, "src"), [".js", ".mjs"]);
for (const file of srcFiles) {
  const txt = fs.readFileSync(file, "utf8");
  if (/\bconsole\.(log|debug)\s*\(/.test(txt)) {
    console.error(`Disallowed console.log/debug in library module: ${path.relative(ROOT, file)}`);
    failures++;
  }
}

// 4. Verify package.json version matches src/index.js VERSION
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const lib = require(path.join(ROOT, "src", "index.js"));
if (pkg.version !== lib.VERSION) {
  console.error(`Version mismatch: package.json (${pkg.version}) !== src/index.js (${lib.VERSION})`);
  failures++;
}

if (failures > 0) {
  console.error(`\nLint failed with ${failures} issue(s).`);
  process.exit(1);
}

console.log(`✔ Lint passed (${jsFiles.length} JS files, ${jsonFiles.length} JSON files checked).`);

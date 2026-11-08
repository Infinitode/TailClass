"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { applyAutoClasses, canonicalizeClasses, revertProject } = require("../src");

test("applyAutoClasses supports dryRun, backup, incremental idempotency, and lossless revert", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tailclass-rewrite-test-"));
  try {
    const page1Original =
      '<div class="group js-card rounded-xl border border-slate-200 bg-white p-6 shadow-sm">One</div>\n';
    const page2Original =
      '<div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm mt-8">Two</div>\n';

    fs.writeFileSync(path.join(dir, "one.html"), page1Original, "utf8");
    fs.writeFileSync(path.join(dir, "two.html"), page2Original, "utf8");

    // 1. Dry-run leaves disk completely untouched
    const dry = applyAutoClasses(dir, { dryRun: true });
    assert.equal(dry.totalFilesModified, 2);
    assert.equal(fs.readFileSync(path.join(dir, "one.html"), "utf8"), page1Original);
    assert.equal(fs.existsSync(path.join(dir, "tailclass.css")), false);

    // 2. Real apply with backup
    const applied = applyAutoClasses(dir, { backup: true, cssFormat: "tailwind-v4" });
    assert.equal(applied.totalFilesModified, 2);
    assert.ok(fs.existsSync(path.join(dir, ".tailclass-backup", "one.html")));
    assert.ok(applied.cssContent.includes("Tailwind CSS v4"));

    // Preserves `group` and `js-card` inline on page 1, and `mt-8` residual on page 2!
    assert.equal(
      fs.readFileSync(path.join(dir, "one.html"), "utf8"),
      '<div class="card group js-card">One</div>\n'
    );
    assert.equal(
      fs.readFileSync(path.join(dir, "two.html"), "utf8"),
      '<div class="card mt-8">Two</div>\n'
    );

    // 3. Incremental idempotency: add a 3rd page later and re-run applyAutoClasses!
    fs.writeFileSync(
      path.join(dir, "three.html"),
      '<div class="p-6 bg-white shadow-sm rounded-xl border border-slate-200">Three</div>\n',
      "utf8"
    );
    const secondApply = applyAutoClasses(dir);
    assert.equal(
      fs.readFileSync(path.join(dir, "three.html"), "utf8"),
      '<div class="card">Three</div>\n'
    );
    assert.ok(secondApply.cssContent.includes(".card {"));

    // 4. Revert restores all 3 pages to equivalent canonical Tailwind utilities and cleans up CSS
    const rev = revertProject(dir, { clean: true });
    assert.equal(rev.totalFilesReverted, 3);
    assert.equal(fs.existsSync(path.join(dir, "tailclass.css")), false);

    const revertedOne = fs.readFileSync(path.join(dir, "one.html"), "utf8");
    const matchOne = revertedOne.match(/class="([^"]+)"/);
    assert.equal(
      canonicalizeClasses(matchOne[1]),
      canonicalizeClasses("group js-card rounded-xl border border-slate-200 bg-white p-6 shadow-sm")
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

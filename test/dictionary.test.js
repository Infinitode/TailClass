"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  applyAutoClasses,
  formatClassListCsv,
  formatClassListMarkdown,
  generateClassList,
} = require("../src");

function createTempSite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tailclass-dict-test-"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    [
      '<nav class="sticky top-0 z-50 flex items-center justify-between bg-white px-6 py-4">',
      '  <a href="/" class="text-sm font-medium text-slate-600 hover:text-indigo-600">Home</a>',
      '  <a href="/about" class="text-sm font-medium text-slate-600 hover:text-indigo-600">About</a>',
      "</nav>",
      '<div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">Unique Card</div>',
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "about.html"),
    '<nav class="px-6 py-4 bg-white flex items-center justify-between sticky top-0 z-50">About</nav>\n',
    "utf8"
  );
  return dir;
}

test("Class List Mode generates dictionary, tracks counts/files/lines, and preserves customName on re-run", () => {
  const dir = createTempSite();
  try {
    const first = generateClassList(dir, { reportFile: "report.md" });
    assert.equal(first.dictionary.summary.filesScanned, 2);
    assert.equal(first.dictionary.mappings.length, 2);
    assert.ok(fs.existsSync(path.join(dir, "tailclass.map.json")));
    assert.ok(fs.existsSync(path.join(dir, "report.md")));

    const navMapping = first.dictionary.mappings.find((m) => m.autoName === "navbar");
    assert.ok(navMapping);
    assert.equal(navMapping.timesFound, 2);
    assert.equal(navMapping.fileCount, 2);

    // User types customName and disables nav-link
    navMapping.customName = "main-topbar";
    const linkMapping = first.dictionary.mappings.find((m) => m.autoName === "nav-link");
    linkMapping.enabled = false;
    fs.writeFileSync(first.dictionaryPath, JSON.stringify(first.dictionary, null, 2));

    // Re-running generateClassList merges and preserves user edits
    const second = generateClassList(dir);
    const mergedNav = second.dictionary.mappings.find((m) => m.id === navMapping.id);
    const mergedLink = second.dictionary.mappings.find((m) => m.id === linkMapping.id);
    assert.equal(mergedNav.customName, "main-topbar");
    assert.equal(mergedLink.enabled, false);

    // Applying uses "main-topbar" and skips disabled "nav-link"
    const applied = applyAutoClasses(dir);
    assert.ok(applied.cssContent.includes(".main-topbar {"));
    assert.ok(!applied.cssContent.includes(".nav-link"));

    const rewrittenIndex = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    assert.ok(rewrittenIndex.includes('class="main-topbar"'));
    assert.ok(rewrittenIndex.includes("hover:text-indigo-600"));

    // Test Markdown & CSV formatters
    const md = formatClassListMarkdown(second.dictionary);
    const csv = formatClassListCsv(second.dictionary);
    assert.ok(md.includes("# TailClass — Site Class List Report"));
    assert.ok(csv.includes('"main-topbar"'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Flat key-value custom dictionary supports unordered class keys, autoName keys, and duplicate detection", () => {
  const dir = createTempSite();
  try {
    const applied = applyAutoClasses(dir, {
      dictionary: {
        // Unordered utility key for the 1-off card!
        "shadow-sm p-6 bg-white border-slate-200 border rounded-xl": "hero-card",
        // Rename autoName
        navbar: "global-nav",
      },
    });

    assert.ok(applied.cssContent.includes(".global-nav"));
    assert.ok(applied.cssContent.includes(".hero-card"));

    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    assert.ok(html.includes('class="global-nav"'));
    assert.ok(html.includes('class="hero-card"'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Duplicate customName across two distinct patterns throws a clear validation error", () => {
  const dir = createTempSite();
  try {
    assert.throws(
      () =>
        applyAutoClasses(dir, {
          dictionary: {
            navbar: "same-name",
            "nav-link": "same-name",
          },
        }),
      /Duplicate class name "same-name"/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  applyAutoClasses,
  classifyToken,
  expandCssAxes,
  parseExistingStylesheet,
  splitClassTokens,
} = require("../src");
const { scanSource } = require("../src/scanner");

/**
 * Simulate Tailwind CSS cascade resolution for an element's class attribute:
 * 1. `@layer components` rules (from `tailclass.css`) apply first in utility order.
 * 2. `@layer utilities` inline tokens on the element apply after `@layer components`,
 *    overriding any overlapping atomic CSS axes.
 * 3. Non-applyable DOM markers (`group`, `peer`, `@container/*`, `dark`) and
 *    JS/BEM custom classes (`js-*`) must remain identical on the element itself!
 *
 * Returns a deterministic snapshot `{ computedAxes, domMarkersAndHooks }` for every
 * element in the file so we can prove 100% layout equivalence before vs. after TailClass!
 */
function resolveDocumentStyles(source, filePath, cssRulesMap = new Map()) {
  const scanned = scanSource(source, filePath, {
    excludePatterns: [],
    ignoreTags: ["script", "style"],
  });

  return scanned.occurrences.map((occ) => {
    const rawTokens = splitClassTokens(occ.rawValue);
    const componentTokens = [];
    const inlineUtilityTokens = [];
    const domMarkersAndHooks = [];

    for (const tok of rawTokens) {
      if (cssRulesMap.has(tok)) {
        // Expand centralized `@apply` component class
        for (const inner of splitClassTokens(cssRulesMap.get(tok))) {
          componentTokens.push(inner);
        }
        continue;
      }

      const info = classifyToken(tok);
      if (info.isTailwind && info.isApplyable) {
        inlineUtilityTokens.push(tok);
      } else {
        domMarkersAndHooks.push(tok);
      }
    }

    // Sort utilities within `@layer components` and within `@layer utilities`
    // in canonical CSS stylesheet order (shorthands before longhands), then
    // cascade `@layer components` -> `@layer utilities`.
    const sortLayer = (tokens) =>
      tokens
        .map((t) => classifyToken(t))
        .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

    const computedAxes = {};

    for (const info of [...sortLayer(componentTokens), ...sortLayer(inlineUtilityTokens)]) {
      const axes = info.cssAxes || expandCssAxes(info.propertyGroup);
      for (const axis of axes) {
        // Track exact winning value for each atomic CSS property axis
        computedAxes[axis] = resolveAxisValue(axis, info);
      }
    }

    return {
      tag: occ.tag,
      line: occ.line,
      computedAxes,
      domMarkersAndHooks: domMarkersAndHooks.sort(),
    };
  });
}

/**
 * Normalize the value an atomic CSS axis receives from a Tailwind utility token.
 * Note: `text-lg` sets BOTH `font-size` (`text-lg`) AND default `leading` (`default-leading:text-lg`),
 * whereas `leading-relaxed` sets `leading` (`leading-relaxed`). Similarly `p-6` and `px-6`
 * both set `pl` to scale `6`!
 */
function resolveAxisValue(axis, info) {
  const imp = info.important ? "!" : "";
  const neg = info.negative ? "-" : "";
  const base = info.base;

  // Padding value extraction (`p-6`, `px-6`, `pl-6` all set `pl` to `6`)
  const padMatch = base.match(/^(?:p|px|py|pt|pr|pb|pl|ps|pe)-(.+)$/);
  if (padMatch) return `${imp}pad:${padMatch[1]}`;

  // Margin value extraction
  const marMatch = base.match(/^(?:m|mx|my|mt|mr|mb|ml|ms|me)-(.+)$/);
  if (marMatch) return `${imp}${neg}mar:${marMatch[1]}`;

  // Inset value extraction
  const insetMatch = base.match(/^(?:inset|inset-x|inset-y|top|right|bottom|left|start|end)-(.+)$/);
  if (insetMatch) return `${imp}${neg}inset:${insetMatch[1]}`;

  // Gap value extraction
  const gapMatch = base.match(/^gap-(?:[xy]-)?(.+)$/);
  if (gapMatch) return `${imp}gap:${gapMatch[1]}`;

  // Rounded radius value extraction
  if (base === "rounded" || base.startsWith("rounded-")) {
    const radVal = base.replace(/^rounded(?:-(?:tl|tr|br|bl|ss|se|ee|es|t|r|b|l|s|e))?(?:-|$)/, "") || "DEFAULT";
    return `${imp}radius:${radVal}`;
  }

  // Border width extraction
  if (axis.includes("border-width")) {
    const bw = base.replace(/^border(?:-(?:x|y|s|e|t|r|b|l))?(?:-|$)/, "") || "1";
    return `${imp}bw:${bw}`;
  }

  // Text size sets default line-height unless overridden by explicit `leading-*`
  if (axis.endsWith("leading") && base.startsWith("text-")) {
    const slashIdx = base.indexOf("/");
    if (slashIdx !== -1) return `${imp}leading:${base.slice(slashIdx + 1)}`;
    return `${imp}default-leading:${base}`;
  }
  if (axis.endsWith("font-size") && base.startsWith("text-")) {
    const slashIdx = base.indexOf("/");
    return `${imp}font-size:${slashIdx === -1 ? base : base.slice(0, slashIdx)}`;
  }

  return `${imp}${neg}${base}`;
}

test("Layout Integrity Proof: sample-site preserves 100% identical computed styles on every element across all pages", () => {
  const sampleDir = path.resolve(__dirname, "../examples/sample-site");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailclass-layout-proof-"));

  try {
    fs.cpSync(sampleDir, tempDir, { recursive: true });
    const files = ["index.html", "pricing.html", "contact.html", "components/UpgradeModal.jsx"];

    const beforeSnapshots = {};
    for (const rel of files) {
      const src = fs.readFileSync(path.join(tempDir, rel), "utf8");
      beforeSnapshots[rel] = resolveDocumentStyles(src, rel);
    }

    const applied = applyAutoClasses(tempDir);
    assert.ok(applied.totalReplacements > 40, "Expected substantial class replacements");

    const cssRules = parseExistingStylesheet(applied.cssContent);

    for (const rel of files) {
      const afterSrc = fs.readFileSync(path.join(tempDir, rel), "utf8");
      const afterSnap = resolveDocumentStyles(afterSrc, rel, cssRules);

      assert.equal(
        afterSnap.length,
        beforeSnapshots[rel].length,
        `Element count changed in ${rel}`
      );

      for (let idx = 0; idx < afterSnap.length; idx++) {
        assert.deepEqual(
          afterSnap[idx].computedAxes,
          beforeSnapshots[rel][idx].computedAxes,
          `Computed layout/style mismatch in ${rel} at element #${idx} (<${afterSnap[idx].tag}> line ${afterSnap[idx].line})`
        );
        assert.deepEqual(
          afterSnap[idx].domMarkersAndHooks,
          beforeSnapshots[rel][idx].domMarkersAndHooks,
          `DOM markers/hooks (group, peer, js-*) changed in ${rel} at element #${idx}`
        );
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Layout Integrity Proof: complex responsive dashboard with dark mode, group/peer, shorthands+longhands, and arbitrary values", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tailclass-dashboard-proof-"));

  const pageA = `
    <div class="dark min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header class="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 px-6 py-3 backdrop-blur-md">
        <span class="text-lg font-bold tracking-tight">Dashboard</span>
        <button class="js-theme-btn inline-flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition">
          Toggle Theme
        </button>
      </header>

      <div class="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 max-w-7xl mx-auto w-full p-6 px-10">
        <aside class="@container/sidebar w-full flex flex-col gap-2 rounded-2xl rounded-b-none border border-t-4 border-slate-200 bg-white p-4 shadow-sm">
          <a href="#overview" class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 transition">Overview</a>
          <a href="#metrics" class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 transition">Metrics</a>
        </aside>

        <section class="space-y-6">
          <!-- Card 1: standard padding p-6 -->
          <article class="group/card relative rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm hover:shadow-md transition duration-200 ease-out">
            <h2 class="text-xl leading-snug font-semibold text-slate-900 dark:text-white group-hover/card:text-indigo-600">Revenue</h2>
            <p class="mt-2 text-base leading-relaxed text-slate-600 dark:text-slate-400">Up 24% month over month.</p>
          </article>

          <!-- Card 2: same card utilities in completely shuffled order + extra -mt-2 -->
          <article class="duration-200 transition ease-out hover:shadow-md shadow-sm p-6 dark:bg-slate-900 bg-white dark:border-slate-800 border-slate-200 border rounded-2xl relative -mt-2">
            <h2 class="font-semibold leading-snug text-xl dark:text-white text-slate-900 group-hover/card:text-indigo-600">Active Users</h2>
            <p class="leading-relaxed text-base mt-2 dark:text-slate-400 text-slate-600">14,820 active workspaces.</p>
          </article>

          <!-- Card 3: looks similar to Card 1 EXCEPT overrides horizontal padding px-12 and line-height leading-none! Must NOT lose px-12 or leading-none! -->
          <article class="relative rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 px-12 shadow-sm hover:shadow-md transition duration-200 ease-out">
            <h2 class="text-xl leading-none font-semibold text-slate-900 dark:text-white group-hover/card:text-indigo-600">Custom Wide Card</h2>
          </article>

          <!-- Peer input + label -->
          <div>
            <input id="opt" type="checkbox" class="peer/opt sr-only" />
            <label for="opt" class="inline-flex cursor-pointer items-center rounded-full border border-slate-300 px-4 py-1.5 text-xs font-semibold peer-checked/opt:border-indigo-600 peer-checked/opt:bg-indigo-50">
              Enable Alerts
            </label>
          </div>
        </section>
      </div>
    </div>
  `;

  const pageB = `
    <div class="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header class="px-6 py-3 backdrop-blur-md bg-white/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between sticky top-0 z-40">
        <span class="text-lg font-bold tracking-tight">Settings</span>
        <button class="inline-flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition">
          Reset
        </button>
      </header>
      <div class="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 max-w-7xl mx-auto w-full p-6 px-10">
        <aside class="w-full flex flex-col gap-2 rounded-2xl rounded-b-none border border-t-4 border-slate-200 bg-white p-4 shadow-sm">
          <a href="#billing" class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 transition">Billing</a>
        </aside>
        <div>
          <input id="opt2" type="checkbox" class="peer/opt sr-only" />
          <label for="opt2" class="inline-flex cursor-pointer items-center rounded-full border border-slate-300 px-4 py-1.5 text-xs font-semibold peer-checked/opt:border-indigo-600 peer-checked/opt:bg-indigo-50">
            Weekly Digest
          </label>
        </div>
      </div>
    </div>
  `;

  try {
    for (const cssFormat of ["tailwind-v3", "tailwind-v4", "plain"]) {
      const subDir = path.join(dir, cssFormat);
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, "dashboard.html"), pageA, "utf8");
      fs.writeFileSync(path.join(subDir, "settings.html"), pageB, "utf8");

      const beforeA = resolveDocumentStyles(pageA, "dashboard.html");
      const beforeB = resolveDocumentStyles(pageB, "settings.html");

      const res = applyAutoClasses(subDir, { cssFormat });
      const rules = parseExistingStylesheet(res.cssContent);

      const afterASrc = fs.readFileSync(path.join(subDir, "dashboard.html"), "utf8");
      const afterBSrc = fs.readFileSync(path.join(subDir, "settings.html"), "utf8");

      const afterA = resolveDocumentStyles(afterASrc, "dashboard.html", rules);
      const afterB = resolveDocumentStyles(afterBSrc, "settings.html", rules);

      assert.deepEqual(afterA, beforeA, `Layout mismatch in dashboard.html (${cssFormat})`);
      assert.deepEqual(afterB, beforeB, `Layout mismatch in settings.html (${cssFormat})`);

      // Verify @container/sidebar, group/card, peer/opt, dark, and js-theme-btn stayed inline!
      assert.match(afterASrc, /@container\/sidebar/);
      assert.match(afterASrc, /group\/card/);
      assert.match(afterASrc, /peer\/opt/);
      assert.match(afterASrc, /js-theme-btn/);
      assert.doesNotMatch(res.cssContent, /@apply[^;]*(?:^|\s)(group|peer|dark)(?=\s|;)/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

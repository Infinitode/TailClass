"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { analyzeScanResult } = require("../src/analyzer");
const { scanSource } = require("../src/scanner");

function scanMultiple(filesObj, config = {}) {
  const occurrences = [];
  const existingCustomClasses = new Set();
  const utilityMap = new Map();

  for (const [file, code] of Object.entries(filesObj)) {
    const res = scanSource(code, file, config);
    occurrences.push(...res.occurrences);
    for (const c of res.existingCustomClasses) existingCustomClasses.add(c);
    for (const [u, cnt] of res.utilityFrequency.entries()) {
      if (!utilityMap.has(u)) utilityMap.set(u, { utility: u, timesFound: 0, files: new Set() });
      const entry = utilityMap.get(u);
      entry.timesFound += cnt;
      entry.files.add(file);
    }
  }

  return analyzeScanResult(
    {
      filesScanned: Object.keys(filesObj),
      occurrences,
      existingCustomClasses,
      utilityInventory: Array.from(utilityMap.values()).map((e) => ({
        utility: e.utility,
        timesFound: e.timesFound,
        fileCount: e.files.size,
        files: Array.from(e.files),
      })),
    },
    config
  );
}

test("scanner handles JSX arrow props containing '>' without prematurely ending tag scan", () => {
  const jsx = `
    export function Toolbar({ count, setOpen }) {
      return (
        <div>
          <button onClick={() => setOpen(count > 0)} className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-white">
            Open
          </button>
          <button onClick={() => setOpen(count > 1)} className="px-4 py-2 text-white bg-indigo-600 rounded-lg inline-flex items-center">
            Open Again
          </button>
        </div>
      );
    }
  `;

  const analysis = scanMultiple({ "Toolbar.jsx": jsx });
  assert.equal(analysis.extractablePatterns.length, 1);
  assert.equal(analysis.extractablePatterns[0].autoName, "btn-primary");
  assert.equal(analysis.extractablePatterns[0].timesFound, 2);
});

test("scanner safely skips dynamic interpolation fragments while extracting static Tailwind classes", () => {
  const jsx = `
    export function Alert({ color }) {
      return (
        <>
          <div className={\`bg-\${color}-50 border-l-4 p-4 rounded-lg shadow-sm\`}>One</div>
          <div className={\`bg-\${color}-100 border-l-4 p-4 rounded-lg shadow-sm\`}>Two</div>
        </>
      );
    }
  `;

  const analysis = scanMultiple({ "Alert.jsx": jsx });
  assert.equal(analysis.extractablePatterns.length, 1);
  assert.equal(
    analysis.extractablePatterns[0].canonicalKey,
    "p-4 border-l-4 rounded-lg shadow-sm"
  );
});

test("scanner extracts static strings inside clsx/cn helper calls and respects excludeClasses & tc-ignore", () => {
  const files = {
    "a.tsx": `
      const c1 = cn("rounded-xl border border-slate-200 bg-white p-6 shadow-sm js-track", active && "ring-2");
      export const A = () => <div className="tc-ignore rounded-xl border border-slate-200 bg-white p-6 shadow-sm" />;
    `,
    "b.tsx": `
      export const B = () => <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm animate-bounce" />;
    `,
  };

  const analysis = scanMultiple(files, {
    excludeClasses: ["animate-*"],
    excludePatterns: ["tc-ignore"],
  });

  // `a.tsx` helper + `b.tsx` JSX match (while `tc-ignore` div is untouched and `animate-bounce` is excluded inline)
  assert.equal(analysis.extractablePatterns.length, 1);
  assert.equal(analysis.extractablePatterns[0].timesFound, 2);
  assert.ok(!analysis.extractablePatterns[0].canonicalKey.includes("animate-bounce"));
});

test("smart shared-base discovery finds common foundation across two distinct variants", () => {
  const files = {
    "page.html": `
      <nav class="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-white">Light</nav>
      <nav class="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-slate-900">Dark</nav>
    `,
  };

  const withSubset = scanMultiple(files, { subsetMatching: true });
  assert.equal(withSubset.extractablePatterns.length, 1);
  assert.equal(withSubset.extractablePatterns[0].autoName, "navbar");
  assert.equal(withSubset.extractablePatterns[0].matchType, "shared-base");

  const strictOnly = scanMultiple(files, { subsetMatching: false });
  assert.equal(strictOnly.extractablePatterns.length, 0);
});

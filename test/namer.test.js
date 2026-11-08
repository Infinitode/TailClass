"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { assignUniqueNames, formatClassName, inferSemanticName } = require("../src/namer");
const { partitionAndCanonicalize } = require("../src/tailwind");

function makePattern(classes, tag = "div", extra = {}) {
  const part = partitionAndCanonicalize(classes);
  return {
    canonicalTokens: part.canonicalTokens,
    canonicalKey: part.canonicalKey,
    classCount: part.canonicalTokens.length,
    timesFound: extra.timesFound || 3,
    occurrences: [
      {
        tag,
        rawTag: extra.rawTag || tag,
        parentTag: extra.parentTag || null,
        ancestors: extra.ancestors || (extra.parentTag ? [extra.parentTag] : []),
        attributes: extra.attributes || {},
      },
    ],
  };
}

test("inferSemanticName accurately classifies common UI layout archetypes", () => {
  assert.equal(
    inferSemanticName(
      makePattern(
        "sticky top-0 z-50 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4",
        "nav"
      )
    ).baseName,
    "navbar"
  );

  assert.equal(
    inferSemanticName(
      makePattern("text-xl font-bold tracking-tight text-slate-900", "a", {
        parentTag: "nav",
        ancestors: ["nav"],
      })
    ).baseName,
    "navbar-brand"
  );

  assert.equal(
    inferSemanticName(
      makePattern("text-sm font-medium text-slate-600 hover:text-indigo-600 transition", "a", {
        parentTag: "li",
        ancestors: ["nav", "ul", "li"],
      })
    ).baseName,
    "nav-link"
  );

  assert.equal(
    inferSemanticName(
      makePattern(
        "inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500",
        "button"
      )
    ).baseName,
    "btn-primary"
  );

  assert.equal(
    inferSemanticName(
      makePattern(
        "inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500",
        "button"
      )
    ).baseName,
    "btn-danger"
  );

  assert.equal(
    inferSemanticName(
      makePattern(
        "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50",
        "button"
      )
    ).baseName,
    "btn-outline"
  );

  assert.equal(
    inferSemanticName(
      makePattern("rounded-xl border border-slate-200 bg-white p-6 shadow-sm", "div")
    ).baseName,
    "card"
  );

  assert.equal(
    inferSemanticName(
      makePattern("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6", "div")
    ).baseName,
    "grid-3col"
  );

  assert.equal(
    inferSemanticName(
      makePattern(
        "inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700",
        "span"
      )
    ).baseName,
    "badge-success"
  );

  assert.equal(
    inferSemanticName(makePattern("h-10 w-10 rounded-full object-cover", "img")).baseName,
    "avatar"
  );

  assert.equal(
    inferSemanticName(
      makePattern(
        "block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500",
        "input",
        { attributes: { type: "email" } }
      )
    ).baseName,
    "form-input"
  );

  assert.equal(
    inferSemanticName(
      makePattern("fixed inset-0 z-50 bg-black/50 backdrop-blur-sm", "div")
    ).baseName,
    "modal-backdrop"
  );

  assert.equal(
    inferSemanticName(
      makePattern("rounded-2xl bg-white p-6 shadow-xl max-w-lg mx-auto", "div", {
        attributes: { role: "dialog" },
      })
    ).baseName,
    "modal-dialog"
  );

  assert.equal(
    inferSemanticName(
      makePattern("w-64 flex flex-col min-h-screen border-r border-slate-200 bg-white", "aside")
    ).baseName,
    "sidebar"
  );

  assert.equal(
    inferSemanticName(
      makePattern("border-t border-slate-200 bg-slate-900 py-12 text-slate-400", "footer")
    ).baseName,
    "site-footer"
  );

  assert.equal(
    inferSemanticName(
      makePattern("h-5 w-5 animate-spin rounded-full border-2 border-indigo-600", "div")
    ).baseName,
    "spinner"
  );
});

test("assignUniqueNames disambiguates visual variants and avoids existing project classes", () => {
  const lightCard = makePattern("rounded-xl border border-slate-200 bg-white p-6 shadow-sm", "div", {
    timesFound: 5,
  });
  const darkCard = makePattern("rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-lg", "div", {
    timesFound: 3,
  });

  assignUniqueNames([lightCard, darkCard], new Set(["card"]));
  assert.equal(lightCard.autoName, "card-2");
  assert.equal(darkCard.autoName, "card-dark");
});

test("formatClassName supports kebab, bem, camel, and classPrefix", () => {
  assert.equal(formatClassName("btn-primary", { namingStyle: "kebab", classPrefix: "ui-" }), "ui-btn-primary");
  assert.equal(formatClassName("btn-primary", { namingStyle: "bem" }), "btn--primary");
  assert.equal(formatClassName("navbar-brand", { namingStyle: "bem" }), "navbar__brand");
  assert.equal(formatClassName("btn-primary", { namingStyle: "camel" }), "btnPrimary");
});

test("custom config rules take precedence over built-in heuristics", () => {
  const pat = makePattern("inline-flex rounded-full bg-purple-600 px-6 py-3 font-semibold text-white", "a");
  const info = inferSemanticName(pat, {
    rules: [
      {
        name: "infinitode-pill-cta",
        matchTag: ["a", "button"],
        mustInclude: ["rounded-full", "bg-purple-*"],
        priority: 100,
      },
    ],
  });
  assert.equal(info.baseName, "infinitode-pill-cta");
});

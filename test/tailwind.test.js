"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  canonicalizeClasses,
  classifyToken,
  partitionAndCanonicalize,
  splitClassTokens,
} = require("../src/tailwind");

test("splitClassTokens handles arbitrary values and whitespace cleanly", () => {
  const tokens = splitClassTokens(
    "  flex   grid-cols-[240px_1fr]  bg-[#5d17eb]/90  [mask-type:luminance]  "
  );
  assert.deepEqual(tokens, [
    "flex",
    "grid-cols-[240px_1fr]",
    "bg-[#5d17eb]/90",
    "[mask-type:luminance]",
  ]);
});

test("classifyToken identifies standard, responsive, state, arbitrary, negative, and important utilities", () => {
  assert.equal(classifyToken("flex").isTailwind, true);
  assert.equal(classifyToken("flex").isApplyable, true);

  const stacked = classifyToken("dark:md:hover:bg-indigo-600/80");
  assert.equal(stacked.isTailwind, true);
  assert.equal(stacked.isApplyable, true);
  assert.deepEqual(stacked.variants, ["dark", "md", "hover"]);

  const neg = classifyToken("-translate-x-1/2");
  assert.equal(neg.isTailwind, true);
  assert.equal(neg.negative, true);

  const impPrefix = classifyToken("!mt-0");
  assert.equal(impPrefix.isTailwind, true);
  assert.equal(impPrefix.important, true);

  const impSuffix = classifyToken("p-4!");
  assert.equal(impSuffix.isTailwind, true);
  assert.equal(impSuffix.important, true);

  const arbProp = classifyToken("[mask-type:luminance]");
  assert.equal(arbProp.isTailwind, true);
  assert.equal(arbProp.isApplyable, true);
});

test("classifyToken marks group, peer, and bare dark as non-applyable Tailwind markers", () => {
  for (const marker of ["group", "group/sidebar", "peer", "peer/input", "dark"]) {
    const info = classifyToken(marker);
    assert.equal(info.isTailwind, true, `${marker} should be recognized as Tailwind`);
    assert.equal(info.isApplyable, false, `${marker} must not be placed inside @apply`);
    assert.equal(info.isMarker, true);
  }
});

test("classifyToken rejects custom BEM and JS hook classes", () => {
  for (const custom of ["js-toggle-menu", "header__logo--dark", "swiper-slide", "my-card"]) {
    const info = classifyToken(custom);
    assert.equal(info.isTailwind, false, `${custom} should not be classified as Tailwind`);
    assert.equal(info.isApplyable, false);
  }
});

test("classifyToken supports custom tailwindPrefix", () => {
  assert.equal(classifyToken("tw-flex", { tailwindPrefix: "tw-" }).isTailwind, true);
  assert.equal(classifyToken("md:tw-px-6", { tailwindPrefix: "tw-" }).isTailwind, true);
  assert.equal(classifyToken("flex", { tailwindPrefix: "tw-" }).isTailwind, false);
});

test("partitionAndCanonicalize produces identical canonicalKey regardless of input token order", () => {
  const a = partitionAndCanonicalize(
    "hover:bg-indigo-500 bg-indigo-600 text-white px-4 py-2 rounded-lg inline-flex items-center"
  );
  const b = partitionAndCanonicalize(
    "inline-flex items-center rounded-lg py-2 px-4 text-white bg-indigo-600 hover:bg-indigo-500"
  );

  assert.equal(a.canonicalKey, b.canonicalKey);
  assert.equal(
    canonicalizeClasses("p-4 group js-card flex items-center"),
    "flex items-center p-4 group js-card"
  );
});

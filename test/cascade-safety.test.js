"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  canonicalizeClasses,
  checkSubsetCompatibility,
  classifyToken,
  partitionAndCanonicalize,
} = require("../src");

test("Shorthand utilities ALWAYS sort before axis shorthands and longhands in @apply", () => {
  // Padding: p -> px/py -> pt/pr/pb/pl
  assert.equal(
    canonicalizeClasses("pt-2 px-10 p-6"),
    "p-6 px-10 pt-2"
  );

  // Margin: m -> mx/my -> mt/mr/mb/ml
  assert.equal(
    canonicalizeClasses("mt-0 mx-auto m-4"),
    "m-4 mx-auto mt-0"
  );

  // Positioning inset: inset -> inset-x/y -> top/right/bottom/left
  assert.equal(
    canonicalizeClasses("top-16 inset-x-4 inset-0 fixed"),
    "fixed inset-0 inset-x-4 top-16"
  );

  // Typography: text-<size> (sets font-size + default line-height) BEFORE leading-*!
  assert.equal(
    canonicalizeClasses("leading-relaxed text-lg font-semibold"),
    "font-semibold text-lg leading-relaxed"
  );

  // Border radius: rounded-2xl -> rounded-b-none -> rounded-tl-sm
  assert.equal(
    canonicalizeClasses("rounded-tl-sm rounded-b-none rounded-2xl"),
    "rounded-2xl rounded-b-none rounded-tl-sm"
  );

  // Border width: border -> border-x-2 -> border-t-4
  assert.equal(
    canonicalizeClasses("border-t-4 border-x-2 border"),
    "border border-x-2 border-t-4"
  );

  // Overflow: overflow-hidden -> overflow-y-auto
  assert.equal(
    canonicalizeClasses("overflow-y-auto overflow-hidden"),
    "overflow-hidden overflow-y-auto"
  );

  // Gap: gap-4 -> gap-x-8
  assert.equal(
    canonicalizeClasses("gap-x-8 gap-4 grid"),
    "grid gap-4 gap-x-8"
  );

  // Sizing: size-10 -> w-14
  assert.equal(
    canonicalizeClasses("w-14 size-10"),
    "size-10 w-14"
  );

  // Transitions: transition -> duration -> ease -> delay
  assert.equal(
    canonicalizeClasses("delay-75 ease-out duration-200 transition"),
    "transition duration-200 ease-out delay-75"
  );
});

test("Subset compatibility blocks shorthand/longhand clobbering while allowing orthogonal supplements", () => {
  const cardPart = partitionAndCanonicalize(
    "rounded-xl border border-slate-200 bg-white p-6 text-lg shadow-sm"
  );
  const cardPropGroups = new Set(cardPart.applyableInfos.map((i) => i.propertyGroup));

  const makeOcc = (cls) => {
    const p = partitionAndCanonicalize(cls);
    return {
      canonicalTokens: p.canonicalTokens,
      applyableInfos: p.applyableInfos,
    };
  };

  // 1. Orthogonal additions (margin `mt-8`, ring `ring-2 ring-indigo-600`, layout `col-span-2`) -> SAFE!
  const safeSuperset = checkSubsetCompatibility(
    cardPart.canonicalTokens,
    cardPropGroups,
    makeOcc("rounded-xl border border-slate-200 bg-white p-6 text-lg shadow-sm mt-8 ring-2 ring-indigo-600 col-span-2")
  );
  assert.equal(safeSuperset.matches, true);
  assert.deepEqual(safeSuperset.residualTokens, ["col-span-2", "mt-8", "ring-2", "ring-indigo-600"]);

  // 2. Overlapping padding (`p-6` in card vs extra `px-10` on element) -> BLOCKED!
  const clobberPadding = checkSubsetCompatibility(
    cardPart.canonicalTokens,
    cardPropGroups,
    makeOcc("rounded-xl border border-slate-200 bg-white p-6 px-10 text-lg shadow-sm")
  );
  assert.equal(clobberPadding.matches, false);

  // 3. Overlapping border-radius (`rounded-xl` in card vs `rounded-b-none` on element) -> BLOCKED!
  const clobberRadius = checkSubsetCompatibility(
    cardPart.canonicalTokens,
    cardPropGroups,
    makeOcc("rounded-xl rounded-b-none border border-slate-200 bg-white p-6 text-lg shadow-sm")
  );
  assert.equal(clobberRadius.matches, false);

  // 4. Overlapping border-width (`border` in card vs `border-t-4` on element) -> BLOCKED!
  const clobberBorder = checkSubsetCompatibility(
    cardPart.canonicalTokens,
    cardPropGroups,
    makeOcc("rounded-xl border border-t-4 border-slate-200 bg-white p-6 text-lg shadow-sm")
  );
  assert.equal(clobberBorder.matches, false);

  // 5. Overlapping line-height (`text-lg` in card vs `leading-none` on element) -> BLOCKED!
  const clobberLeading = checkSubsetCompatibility(
    cardPart.canonicalTokens,
    cardPropGroups,
    makeOcc("rounded-xl border border-slate-200 bg-white p-6 text-lg leading-none shadow-sm")
  );
  assert.equal(clobberLeading.matches, false);
});

test("Named @container/name markers stay inline alongside group and peer", () => {
  const namedContainer = classifyToken("@container/main");
  assert.equal(namedContainer.isTailwind, true);
  assert.equal(namedContainer.isApplyable, false);
  assert.equal(namedContainer.isMarker, true);

  // Plain `@container` without a name sets `container-type: inline-size` and is applyable
  const unnamedContainer = classifyToken("@container");
  assert.equal(unnamedContainer.isTailwind, true);
  assert.equal(unnamedContainer.isApplyable, true);
});

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MAX_GLOB_PATTERN_LENGTH,
  clearGlobCache,
  compileGlob,
  expandBraces,
  matchesAnyGlob,
} = require("../src/glob");

test("glob matcher keeps its documented semantics", () => {
  const cases = [
    ["**/*.html", "a/b/c.html", true],
    ["**/*.html", "c.html", true],
    ["**/*.html", "c.htm", false],
    ["src/**", "src/a/b.js", true],
    ["src/**", "lib/a/b.js", false],
    ["*.js", "src/a.js", true], // no slash in pattern -> basename match
    ["src/*.js", "src/a/b.js", false],
    ["?.js", "a.js", true],
    ["?.js", "ab.js", false],
    ["[abc].js", "b.js", true],
    ["[abc].js", "d.js", false],
    ["[!abc].js", "d.js", true],
    ["[a-c]x", "bx", true],
    ["**", "a/b", true],
    ["a/**/b", "a/b", true],
    ["a/**/b", "a/x/y/b", true],
    ["a/**/b", "a/x/y/c", false],
    ["node_modules/**", "node_modules/pkg/index.js", true],
    ["node_modules/**", "src/node_modules.js", false],
    ["*.{js,ts}", "x.ts", true],
    ["*.{js,ts}", "x.css", false],
  ];

  for (const [pattern, candidate, expected] of cases) {
    assert.equal(
      compileGlob(pattern)(candidate),
      expected,
      `${pattern} vs ${candidate} should be ${expected}`
    );
  }
});

test("expandBraces handles multiple and nested alternatives", () => {
  assert.deepEqual(expandBraces("a.{js,ts}"), ["a.js", "a.ts"]);
  assert.deepEqual(expandBraces("{a,b}.{js,ts}"), ["a.js", "a.ts", "b.js", "b.ts"]);
  assert.deepEqual(expandBraces("no-braces"), ["no-braces"]);
  assert.deepEqual(expandBraces("unclosed{js"), ["unclosed{js"]);
});

test("matchesAnyGlob supports negated entries", () => {
  const patterns = ["**/*.js", "!**/*.min.js"];
  assert.equal(matchesAnyGlob("src/app.js", patterns), true);
  assert.equal(matchesAnyGlob("src/app.min.js", patterns), false);
  assert.equal(matchesAnyGlob("src/app.html", patterns), false);
  assert.equal(matchesAnyGlob("src/app.js", []), false);
  assert.equal(matchesAnyGlob("src/app.js", null), false);
});

test("malformed character classes are treated as literals instead of crashing", () => {
  assert.doesNotThrow(() => compileGlob("[")("anything"));
  assert.equal(compileGlob("a[b")("a[b"), true);
  assert.equal(compileGlob("[abc")("[abc"), true);
  assert.equal(compileGlob("[]")("[]"), true);
});

test("pathological wildcard patterns match in linear time (no ReDoS)", () => {
  clearGlobCache();
  const candidates = [
    ["**".repeat(40) + "z", "a".repeat(500)],
    ["**/**/**/**/**/**/**/**/**/**/z", "/a".repeat(500)],
    ["*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*b", "a".repeat(500)],
    ["[".repeat(200) + "z", "[".repeat(200)],
  ];

  for (const [pattern, candidate] of candidates) {
    const started = Date.now();
    const result = compileGlob(pattern)(candidate);
    const elapsed = Date.now() - started;
    assert.equal(result, false);
    assert.ok(
      elapsed < 2000,
      `pattern ${pattern.slice(0, 24)}… took ${elapsed}ms (expected << 2s)`
    );
  }
});

test("repeated compilation is cached and stays fast", () => {
  clearGlobCache();
  const matcher = compileGlob("**/*.html");
  const started = Date.now();
  for (let i = 0; i < 20000; i++) {
    matcher(`src/components/file-${i}.html`);
  }
  const firstRun = Date.now() - started;

  const startedAgain = Date.now();
  for (let i = 0; i < 20000; i++) {
    compileGlob("**/*.html")(`src/components/file-${i}.html`);
  }
  const cachedRun = Date.now() - startedAgain;

  assert.ok(firstRun < 2000, `20k matches took ${firstRun}ms`);
  assert.ok(cachedRun < 2000, `20k recompiled matches took ${cachedRun}ms`);
});

test("over-long glob patterns are rejected with a clear message", () => {
  clearGlobCache();
  const pattern = "a".repeat(MAX_GLOB_PATTERN_LENGTH + 1);
  assert.throws(() => compileGlob(pattern), /too long/i);
  assert.throws(() => compileGlob("a\u0000b"), /NUL/);
});

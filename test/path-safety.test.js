"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Writable } = require("node:stream");
const { runCli } = require("../src/cli");
const {
  VERSION,
  applyAutoClasses,
  generateClassList,
  resolveConfig,
  revertProject,
} = require("../src");
const { resolveWritablePath, writeResolvedFile } = require("../src/config");

const NAV =
  "sticky top-0 flex items-center justify-between bg-white px-6 py-4 border-b border-slate-200";
const NAV_HTML = `<nav class="${NAV}">home</nav>\n<nav class="${NAV}">about</nav>\n`;

/** @param {string} prefix */
function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `tailclass-${prefix}-`));
}

/** @param {string} dir @param {string} name @param {string} content */
function writeFile(dir, name, content) {
  const target = path.join(dir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return target;
}

/** @param {string} file */
function read(file) {
  return fs.readFileSync(file, "utf8");
}

/** Symlink creation can require elevated privileges on Windows. */
function symlinksAvailable() {
  const dir = tempDir("symlink-probe");
  try {
    fs.mkdirSync(path.join(dir, "target"));
    fs.symlinkSync(path.join(dir, "target"), path.join(dir, "link"), "dir");
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const SKIP_SYMLINKS = symlinksAvailable() ? false : "symbolic links unavailable";

function execCli(args) {
  let out = "";
  let err = "";
  const stdout = new Writable({ write(chunk, _enc, cb) { out += chunk.toString(); cb(); } });
  const stderr = new Writable({ write(chunk, _enc, cb) { err += chunk.toString(); cb(); } });
  const code = runCli(args, { stdout, stderr, color: false });
  return { code, out, err };
}

test("release is version 1.0.2", () => {
  assert.equal(require("../package.json").version, "1.0.2");
  assert.equal(VERSION, "1.0.2");
});

test("configured output paths cannot escape through a symlinked directory", { skip: SKIP_SYMLINKS }, () => {
  const cases = [
    ["outputCss", "escaped.css"],
    ["manifestFile", "escaped-manifest.json"],
    ["dictionaryFile", "escaped-map.json"],
  ];

  for (const [key, fileName] of cases) {
    const dir = tempDir("symlink-escape");
    try {
      const site = path.join(dir, "site");
      const outside = path.join(dir, "outside");
      fs.mkdirSync(site);
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(site, "link"), "dir");
      writeFile(site, "index.html", NAV_HTML);
      writeFile(site, "tailclass.config.json", JSON.stringify({ [key]: `link/${fileName}` }));

      // The config is rejected up front (and every workflow repeats the check).
      assert.throws(() => resolveConfig(site), /symlink|project root/, key);
      assert.throws(() => applyAutoClasses(site), /symlink|project root/, key);
      assert.throws(() => generateClassList(site), /symlink|project root/, key);
      assert.throws(() => revertProject(site, { clean: true }), /symlink|project root/, key);

      assert.deepEqual(fs.readdirSync(outside), [], `${key} must not write outside`);
      assert.match(read(path.join(site, "index.html")), /sticky top-0/, "sources untouched");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("a symlinked output file is never written, even with --force", { skip: SKIP_SYMLINKS }, () => {
  const dir = tempDir("symlink-file");
  try {
    const site = path.join(dir, "site");
    const outside = path.join(dir, "outside");
    fs.mkdirSync(site);
    fs.mkdirSync(outside);
    writeFile(site, "index.html", NAV_HTML);

    const victimCss = writeFile(outside, "victim.css", "KEEP CSS\n");
    const victimManifest = writeFile(outside, "victim.json", "KEEP MANIFEST\n");
    fs.symlinkSync(victimCss, path.join(site, "tailclass.css"), "file");
    fs.symlinkSync(victimManifest, path.join(site, ".tailclass-manifest.json"), "file");

    assert.throws(() => resolveConfig(site), /symlink/);
    assert.throws(() => applyAutoClasses(site, { force: true }), /symlink/);
    assert.throws(() => generateClassList(site), /symlink/);
    assert.equal(read(victimCss), "KEEP CSS\n");
    assert.equal(read(victimManifest), "KEEP MANIFEST\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("revert --clean cannot delete an outside file through a symlinked directory", { skip: SKIP_SYMLINKS }, () => {
  const dir = tempDir("symlink-clean");
  try {
    const site = path.join(dir, "site");
    const outside = path.join(dir, "outside");
    fs.mkdirSync(site);
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(site, "link"), "dir");
    const precious = writeFile(outside, "precious.txt", "DO NOT DELETE\n");
    writeFile(site, "index.html", '<div class="tc-card p-1">a</div>\n');
    writeFile(
      site,
      ".tailclass-manifest.json",
      JSON.stringify({ version: "1.0.2", mappings: { "tc-card": "flex p-4 m-2" } })
    );
    writeFile(site, "tailclass.config.json", JSON.stringify({ outputCss: "link/precious.txt" }));

    assert.throws(() => revertProject(site, { clean: true }), /symlink|project root/);
    assert.equal(read(precious), "DO NOT DELETE\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("directory symlinks that stay inside the root remain usable", { skip: SKIP_SYMLINKS }, () => {
  const dir = tempDir("symlink-inside");
  try {
    fs.mkdirSync(path.join(dir, "assets"));
    fs.symlinkSync(path.join(dir, "assets"), path.join(dir, "link"), "dir");
    writeFile(dir, "index.html", NAV_HTML);
    writeFile(dir, "tailclass.config.json", JSON.stringify({ outputCss: "link/generated.css" }));

    applyAutoClasses(dir);
    assert.equal(fs.existsSync(path.join(dir, "assets", "generated.css")), true);

    const rev = revertProject(dir, { clean: true });
    assert.equal(rev.totalReverted, 2);
    assert.equal(rev.cleanedFiles.length, 2);
    assert.deepEqual(rev.cleanupSkipped, []);
    assert.equal(fs.existsSync(path.join(dir, "assets", "generated.css")), false);
    assert.equal(fs.existsSync(path.join(dir, "link")), true, "the symlink itself is kept");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the low-level resolver never follows a symlink for writes", { skip: SKIP_SYMLINKS }, () => {
  const dir = tempDir("symlink-low-level");
  try {
    const victim = writeFile(dir, "victim.css", "KEEP\n");
    fs.symlinkSync(victim, path.join(dir, "out.css"), "file");

    assert.throws(() => resolveWritablePath(dir, "out.css", "outputCss"), /symlink/);
    assert.throws(
      () => writeResolvedFile(dir, path.join(dir, "out.css"), "outputCss", {}, "evil"),
      /symlink/
    );
    assert.equal(read(victim), "KEEP\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("revert --clean deletes the stylesheet and manifest TailClass generated", () => {
  const dir = tempDir("clean-owned");
  try {
    writeFile(dir, "index.html", NAV_HTML);
    applyAutoClasses(dir);
    assert.equal(fs.existsSync(path.join(dir, "tailclass.css")), true);
    assert.equal(fs.existsSync(path.join(dir, ".tailclass-manifest.json")), true);

    const rev = revertProject(dir, { clean: true });
    assert.equal(rev.totalReverted, 2);
    assert.equal(rev.cleanedFiles.length, 2);
    assert.deepEqual(rev.cleanupSkipped, []);
    assert.equal(fs.existsSync(path.join(dir, "tailclass.css")), false);
    assert.equal(fs.existsSync(path.join(dir, ".tailclass-manifest.json")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("revert --clean leaves a foreign stylesheet untouched, even with --force", () => {
  const dir = tempDir("clean-foreign-css");
  try {
    writeFile(dir, "index.html", '<div class="tc-card p-1">a</div>\n');
    writeFile(
      dir,
      ".tailclass-manifest.json",
      JSON.stringify({ version: "1.0.2", mappings: { "tc-card": "flex p-4 m-2" } })
    );
    writeFile(dir, "tailclass.config.json", JSON.stringify({ outputCss: "important.css" }));
    writeFile(dir, "important.css", "/* my own stylesheet */\nbody { color: red; }\n");

    const rev = revertProject(dir, { clean: true, force: true });
    assert.equal(rev.totalReverted, 1);
    assert.equal(read(path.join(dir, "important.css")), "/* my own stylesheet */\nbody { color: red; }\n");
    assert.ok(rev.cleanupSkipped.some((note) => note.includes("does not look like TailClass output")));
    assert.equal(rev.cleanedFiles.length, 1, "the owned manifest is still removed");
    assert.equal(fs.existsSync(path.join(dir, ".tailclass-manifest.json")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("revert --clean leaves a foreign manifest untouched", () => {
  const dir = tempDir("clean-foreign-manifest");
  try {
    writeFile(dir, "index.html", NAV_HTML);
    applyAutoClasses(dir);
    // A JSON file from another tool that happens to have a `mappings` key.
    const foreign = writeFile(
      dir,
      ".tailclass-manifest.json",
      JSON.stringify({ name: "my-app", version: "1.0.0", mappings: { a: "b" } })
    );

    const rev = revertProject(dir, { clean: true });
    assert.ok(rev.cleanupSkipped.some((note) => note.includes("does not look like TailClass output")));
    assert.equal(read(foreign), JSON.stringify({ name: "my-app", version: "1.0.0", mappings: { a: "b" } }));
    assert.equal(fs.existsSync(path.join(dir, "tailclass.css")), false, "owned CSS is removed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("revert --clean removes a markerless (--no-comments) stylesheet it can match to its manifest", () => {
  const dir = tempDir("clean-no-comments");
  try {
    writeFile(dir, "index.html", NAV_HTML);
    writeFile(dir, "tailclass.config.json", JSON.stringify({ comments: false }));
    applyAutoClasses(dir);
    assert.equal(read(path.join(dir, "tailclass.css")).includes("Generated by TailClass"), false);

    const rev = revertProject(dir, { clean: true });
    assert.deepEqual(rev.cleanupSkipped, []);
    assert.equal(rev.cleanedFiles.length, 2);
    assert.equal(fs.existsSync(path.join(dir, "tailclass.css")), false);
    assert.equal(fs.existsSync(path.join(dir, ".tailclass-manifest.json")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CSS that is not TailClass output is never deleted by --clean", () => {
  const dir = tempDir("clean-apply-css");
  try {
    writeFile(dir, "index.html", NAV_HTML);
    applyAutoClasses(dir);
    // Point the config at a hand-written @apply stylesheet from another tool.
    writeFile(dir, "own.css", ".my-card {\n  @apply p-4 rounded;\n}\n");
    writeFile(dir, "tailclass.config.json", JSON.stringify({ outputCss: "own.css" }));

    const rev = revertProject(dir, { clean: true });
    assert.equal(read(path.join(dir, "own.css")), ".my-card {\n  @apply p-4 rounded;\n}\n");
    assert.ok(rev.cleanupSkipped.length > 0);
    // The stylesheet recorded in the manifest is still cleaned up.
    assert.equal(fs.existsSync(path.join(dir, "tailclass.css")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("revert --clean never deletes a scanned source file", () => {
  const dir = tempDir("clean-source");
  try {
    writeFile(dir, "index.html", NAV_HTML);
    applyAutoClasses(dir);
    const sourceBefore = read(path.join(dir, "index.html"));
    // A hostile config redirects the stylesheet path at a source file.
    writeFile(dir, "tailclass.config.json", JSON.stringify({ outputCss: "index.html" }));

    const rev = revertProject(dir, { clean: true });
    assert.equal(read(path.join(dir, "index.html")), sourceBefore, "source file survives");
    assert.ok(
      rev.cleanupSkipped.some((note) => note.includes("does not look like TailClass output")),
      "the redirected stylesheet path is reported as skipped"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI revert --clean reports skipped files instead of deleting them", () => {
  const dir = tempDir("clean-cli");
  try {
    writeFile(dir, "index.html", NAV_HTML);
    assert.equal(execCli(["apply", dir]).code, 0);

    writeFile(dir, "important.css", "body { color: red; }\n");
    writeFile(dir, "tailclass.config.json", JSON.stringify({ outputCss: "important.css" }));

    const res = execCli(["revert", dir, "--clean", "--json"]);
    assert.equal(res.code, 0);
    assert.equal(read(path.join(dir, "important.css")), "body { color: red; }\n");
    const json = JSON.parse(res.out);
    assert.ok(json.cleanupSkipped.length > 0);
    assert.match(res.err, /does not look like TailClass output/);
    assert.equal(fs.existsSync(path.join(dir, ".tailclass-manifest.json")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit CLI output paths outside the root are still honoured", () => {
  const dir = tempDir("cli-outside");
  try {
    const site = path.join(dir, "site");
    fs.mkdirSync(site);
    writeFile(site, "index.html", NAV_HTML);
    const explicit = path.join(dir, "explicit.css");

    const applied = applyAutoClasses(site, { outputCss: explicit });
    assert.equal(applied.outputCssPath, explicit);
    assert.match(read(explicit), /Generated by TailClass/);
    assert.match(read(path.join(site, "index.html")), /class="navbar/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

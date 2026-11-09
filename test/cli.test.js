"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Writable } = require("node:stream");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const { runCli } = require("../src/cli");
const { VERSION } = require("../src/version");

function execCli(args) {
  let out = "";
  let err = "";
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  const stderr = new Writable({
    write(chunk, _enc, cb) {
      err += chunk.toString();
      cb();
    },
  });

  const code = runCli(args, { stdout, stderr, color: false });
  return { code, out, err };
}

test("package.json, src/version.js and the CLI agree on the version", () => {
  const pkg = require("../package.json");
  assert.equal(VERSION, pkg.version);
  assert.equal(require("../src").VERSION, pkg.version);
});

test("CLI --version, --help, and unknown flag handling", () => {
  const ver = execCli(["--version"]);
  assert.equal(ver.code, 0);
  // Keep version assertions version-agnostic so a release bump never breaks the suite.
  assert.equal(ver.out.trim(), `TailClass v${VERSION}`);

  const help = execCli(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.out, /USAGE/);

  const bad = execCli(["--nonexistent-flag"]);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /Unknown option/);
});

test("CLI end-to-end workflow: init -> scan -> list -> apply -> revert", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tailclass-cli-test-"));
  try {
    fs.writeFileSync(
      path.join(dir, "a.html"),
      '<button class="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-white">Save</button>\n'
    );
    fs.writeFileSync(
      path.join(dir, "b.html"),
      '<button class="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-white">Submit</button>\n'
    );

    const initRes = execCli(["init", dir]);
    assert.equal(initRes.code, 0);
    assert.ok(fs.existsSync(path.join(dir, "tailclass.config.json")));

    const scanRes = execCli(["scan", dir, "--json"]);
    assert.equal(scanRes.code, 0);
    const scanJson = JSON.parse(scanRes.out);
    assert.equal(scanJson.patterns.length, 1);
    assert.equal(scanJson.patterns[0].autoName, "btn-primary");

    const listRes = execCli(["list", dir]);
    assert.equal(listRes.code, 0);
    assert.ok(fs.existsSync(path.join(dir, "tailclass.map.json")));

    const applyRes = execCli(["apply", dir, "--prefix", "tc-"]);
    assert.equal(applyRes.code, 0);
    assert.match(fs.readFileSync(path.join(dir, "a.html"), "utf8"), /class="tc-btn-primary"/);

    const revRes = execCli(["revert", dir, "--clean"]);
    assert.equal(revRes.code, 0);
    assert.ok(!fs.existsSync(path.join(dir, "tailclass.css")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ESM entrypoint exports full API surface", async () => {
  const esmUrl = pathToFileURL(path.resolve(__dirname, "../src/index.mjs")).href;
  const mod = await import(esmUrl);
  assert.equal(mod.NAME, "TailClass");
  assert.equal(typeof mod.applyAutoClasses, "function");
  assert.equal(typeof mod.generateClassList, "function");
  assert.equal(typeof mod.default.scanProject, "function");
});

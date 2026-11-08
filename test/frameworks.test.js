"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { applyAutoClasses } = require("../src");

test("Multi-framework torture suite: TSX generics & URLs, Vue SFC, Svelte, Astro, comments, and <textarea> safety", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tailclass-frameworks-"));

  const sharedBtn =
    "inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500";
  const sharedCard = "rounded-xl border border-slate-200 bg-white p-6 shadow-sm";

  const tsxFile = `
    // Commented-out helper MUST NOT be counted or rewritten:
    // const dead = cn("${sharedCard}");
    /* const dead2 = clsx("${sharedBtn}"); */

    export function DataPanel<T extends Record<string, unknown>>({ items }: { items: T[] }) {
      const docsUrl = "https://infinitode.netlify.app"; const inlineEl = <button onClick={() => items.length > 0} className="${sharedBtn}">Action</button>;
      return (
        <section title="${sharedCard}" data-raw="${sharedBtn}">
          {/* JSX comment with <div className="${sharedCard}">ignored</div> */}
          <DataCard<T>
            className={\`\${items.length ? "ring-2" : ""} ${sharedCard}\`}
          />
          <p>${sharedCard}</p>
          {inlineEl}
        </section>
      );
    }
  `;

  const vueFile = `
<template>
  <div
    class="
      rounded-xl border border-slate-200
      bg-white p-6 shadow-sm
    "
  >
    <button :class="['${sharedBtn}', isSaving && 'opacity-50']">Save Vue</button>
    <textarea name="snippet"><div class="${sharedCard}">Literal RCDATA inside textarea must NEVER change!</div></textarea>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const isSaving = ref(false);
</script>

<style scoped>
/* <div class="${sharedCard}"> inside style block must NEVER change */
.custom { color: #5d17eb; }
</style>
  `;

  const astroFile = `---
const title = "Infinitode Astro";
---
<html>
  <body>
    <!-- <div class="${sharedCard}">HTML comment ignored</div> -->
    <article class="${sharedCard}">
      <h1>{title}</h1>
      <a href="/go" class="${sharedBtn}">Launch</a>
    </article>
  </body>
</html>
  `;

  try {
    fs.writeFileSync(path.join(dir, "DataPanel.tsx"), tsxFile, "utf8");
    fs.writeFileSync(path.join(dir, "Editor.vue"), vueFile, "utf8");
    fs.writeFileSync(path.join(dir, "index.astro"), astroFile, "utf8");

    const res = applyAutoClasses(dir);
    assert.equal(res.totalFilesModified, 3);

    const outTsx = fs.readFileSync(path.join(dir, "DataPanel.tsx"), "utf8");
    const outVue = fs.readFileSync(path.join(dir, "Editor.vue"), "utf8");
    const outAstro = fs.readFileSync(path.join(dir, "index.astro"), "utf8");

    // 1. Real class attributes WERE cleanly rewritten across TSX, Vue, and Astro (inheriting `data-card` from `<DataCard<T>>`!):
    assert.match(outTsx, /const docsUrl = "https:\/\/infinitode\.netlify\.app"; const inlineEl = <button onClick=\{\(\) => items\.length > 0\} className="btn-primary">/);
    assert.match(outTsx, /className=\{`\$\{items\.length \? "ring-2" : ""\} data-card`\}/);
    assert.match(outVue, /<div\n    class="data-card"\n  >/);
    assert.match(outVue, /:class="\['btn-primary', isSaving && 'opacity-50'\]"/);
    assert.match(outAstro, /<article class="data-card">/);
    assert.match(outAstro, /<a href="\/go" class="btn-primary">Launch<\/a>/);

    // 2. Non-class attributes, text nodes, comments, <style>, and <textarea> were NEVER touched:
    assert.ok(outTsx.includes(`// const dead = cn("${sharedCard}");`), "Line comment was mutated!");
    assert.ok(outTsx.includes(`/* const dead2 = clsx("${sharedBtn}"); */`), "Block comment was mutated!");
    assert.ok(outTsx.includes(`title="${sharedCard}"`), "title attribute was mutated!");
    assert.ok(outTsx.includes(`data-raw="${sharedBtn}"`), "data-* attribute was mutated!");
    assert.ok(outTsx.includes(`<p>${sharedCard}</p>`), "Paragraph text content was mutated!");
    assert.ok(
      outVue.includes(`<textarea name="snippet"><div class="${sharedCard}">Literal RCDATA inside textarea must NEVER change!</div></textarea>`),
      "<textarea> RCDATA content was mutated!"
    );
    assert.ok(
      outVue.includes(`/* <div class="${sharedCard}"> inside style block must NEVER change */`),
      "<style> content was mutated!"
    );
    assert.ok(
      outAstro.includes(`<!-- <div class="${sharedCard}">HTML comment ignored</div> -->`),
      "HTML comment was mutated!"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

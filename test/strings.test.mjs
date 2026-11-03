// Every string the page shows comes from the language files, in every language: a missing key would show its name
// (or, worse, English) instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LANGS } from "../scripts/build.mjs";
import { IDS } from "../src/probe.mjs";

const read = f => readFile(new URL("../" + f, import.meta.url), "utf8");
const all = (s, re) => [...s.matchAll(re)].map(m => m[1]);

test("every key the page uses exists in every language", async () => {
  const [app, page, build, probe] = await Promise.all(["src/app.js", "src/page.html", "scripts/build.mjs", "src/probe.mjs"].map(read));
  const keys = new Set([
    ...all(app, /\bt\("(\w+)"/g), ...all(build, /\bT\("(\w+)"/g),
    ...all(page, /data-i="(\w+)"/g), ...all(page, /\{\{a:(\w+)\}\}/g),
    // keys built from a test id, an IPv6 kind, or named by the verdict
    ...["system", "light", "dark"].map(x => "th_" + x),
    ...IDS.flatMap(x => ["t_" + x, "d_" + x]), ...["native", "6to4", "teredo"].map(x => "k_" + x),
    ...all(probe, /"((?:v|p)_\w+)"/g),
  ].filter(k => !k.endsWith("_")));
  assert.ok(keys.size > 50, "found " + keys.size + " keys");
  for (const [lang] of LANGS) {
    const d = (await import(`../src/i18n/${lang}.mjs`)).default;
    const missing = [...keys].filter(k => !(k in d));
    assert.deepEqual(missing, [], `${lang} lacks ${missing.join(", ")}`);
  }
});

test("every language has every string, with the same placeholders", async () => {
  const en = (await import("../src/i18n/en.mjs")).default;
  const vars = s => (s.match(/\{\w+\}/g) || []).sort().filter((x, i, a) => a.indexOf(x) === i).join();
  for (const [lang] of LANGS) {
    const d = (await import(`../src/i18n/${lang}.mjs`)).default;
    for (const k of Object.keys(en)) assert.ok(k in d, `${lang}: ${k}`);
    assert.equal(d.docs.length, en.docs.length, lang + ": help entries");
    for (const k of Object.keys(en)) if (typeof en[k] === "string") assert.equal(vars(d[k]), vars(en[k]), `${lang}: ${k} placeholders`);
  }
});

test("no English fallback in the page script or the build", async () => {
  const [app, build] = await Promise.all(["src/app.js", "scripts/build.mjs"].map(read));
  // TW is the shared Taiwan line from 1ms-shell tool-contract §5, written there with "|| TW.en"; its table has all 10 languages
  for (const [name, s] of [["src/app.js", app], ["scripts/build.mjs", build]]) {
    assert.ok(!/\|\|\s*(?!TW\.)\w+(\.name)?\.en\b|\?\?\s*en\[/.test(s), name + " falls back to English");
  }
});

test("lists come from $$, never $ (which returns one element)", async () => {
  const app = await read("src/app.js");
  const bad = app.split("\n").filter(l => /(^|[^$])\$\([^)]*\)\.(forEach|map|filter)\(/.test(l));
  assert.deepEqual(bad, []);
});

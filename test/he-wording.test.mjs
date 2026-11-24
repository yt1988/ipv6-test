// The slow page's "IPv6 doesn't answer: how long does the browser wait" block is a demonstration of the browser's own
// fallback timer, not a reading of the visitor's line: this site drops IPv6 on purpose, so every browser that tries
// reports the same quarter second, and a proxy or VPN reports nothing at all (measured 2026-11-24: curl 186–202 ms on
// a clean path, 0–3 ms behind a fake-IP tunnel, and nothing for a visitor whose IPv6 dies before it reaches us). The
// words have to say that, and the number is not graded as if it were the network's — that is what this keeps from
// coming back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LANGS } from "../scripts/build.mjs";

const read = f => readFile(new URL("../" + f, import.meta.url), "utf8");

test("the fallback demo is labelled as a demo and its number is not graded", async () => {
  const [app, page] = await Promise.all(["src/app.js", "src/page.html"].map(read));
  assert.match(page, /id="he"[\s\S]{0,400}data-i="he_note"/, "the note that explains the number is on the page");
  assert.doesNotMatch(app, /HE_TONE|he_t1|he_warn|he_bad/, "no tone tiers for the demo's number");
  for (const [lang] of LANGS) {
    const d = (await import(`../src/i18n/${lang}.mjs`)).default;
    for (const k of ["he_k", "he_note", "he_direct", "he_direct_h", "he_no6"]) assert.ok(d[k], `${lang} lacks ${k}`);
    assert.ok(d.he_note.length > 40, `${lang}: the note says why the number is not the line`);
    for (const k of ["he_t1", "he_warn", "he_bad"]) assert.equal(d[k], undefined, `${lang} still grades the demo (${k})`);
  }
  const zh = (await import("../src/i18n/zh-CN.mjs")).default, en = (await import("../src/i18n/en.mjs")).default;
  assert.match(zh.he_k, /演示/, "the heading says it is a demonstration");
  assert.match(en.he_k, /demo/i, "the heading says it is a demonstration");
});

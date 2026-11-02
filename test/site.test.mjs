// The built pages keep the 1ms.dog tool contract (1ms-shell docs/tool-contract.md) and draw every test's row up front.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LANGS } from "../scripts/build.mjs";
import { TESTS } from "../src/probe.mjs";

const SITE = "https://ipv6.1ms.dog";
const page = slug => readFile(new URL(`../public/${slug ? slug + "/" : ""}index.html`, import.meta.url), "utf8");
const one = (h, re) => (re.exec(h) || [])[1];

test("every language page keeps the shell contract", async () => {
  for (const [lang, slug] of LANGS) {
    const h = await page(slug);
    assert.match(h, new RegExp(`<html lang="${lang}"`), lang);
    assert.match(h, /<head>\r?\n<meta charset="utf-8">\r?\n<script>/, lang + ": charset first, then the pre-paint script");
    assert.match(h, /id="helpBtn"[^>]*aria-haspopup="dialog"/, lang + ": help button");
    assert.match(h, /<div class="scrim" id="help" hidden>/, lang + ": help dialog hidden by default");
    assert.match(h, /class="logo-light" src="\/assets\/logo-light.svg" width="90" height="36"/);
    assert.ok(!/\{\{[\w:]+\}\}/.test(h), lang + ": unfilled placeholder");
    assert.ok(h.length < 60000, lang + ": page is " + h.length + " bytes");
    assert.equal((h.match(/<script>/g) || []).length, 1, lang + ": the only inline script is the pre-paint one");
    assert.equal((h.match(/<div data-ms-more><\/div>/g) || []).length, 1, lang + ": one place for the shell's tool list");
    assert.ok(h.indexOf("data-ms-more") < h.indexOf('class="scrim"'), lang + ": tool list before the dialogs");
    const order = ['id="lang"', 'id="helpBtn"', 'class="icon-btn gh"', 'id="theme"'].map(s => h.indexOf(s));
    assert.deepEqual([...order].sort((a, b) => a - b), order, lang + ": header button order");
    assert.equal((h.match(/<li class="tr wait" data-t="/g) || []).length, TESTS.length, lang + ": every test's row");
    // SEO
    assert.equal(one(h, /<link rel="canonical" href="(.*?)">/), SITE + "/" + (slug ? slug + "/" : ""), lang + ": canonical");
    for (const [l, s] of LANGS) assert.ok(h.includes(`hreflang="${l}" href="${SITE}/${s ? s + "/" : ""}"`), lang + ": alternate " + l);
    assert.ok(h.includes('hreflang="x-default"'), lang + ": x-default");
    assert.ok(h.includes(`og:image" content="${SITE}/og/${lang.toLowerCase()}.png"`), lang + ": og:image");
    assert.equal((h.match(/<h1>/g) || []).length, 1, lang + ": one h1");
    const ld = JSON.parse(one(h, /<script type="application\/ld\+json">(.*?)<\/script>/));
    assert.deepEqual(ld["@graph"].map(x => x["@type"]), ["WebApplication", "FAQPage"], lang + ": structured data");
  }
});

test("the sitemap lists every page in every language", async () => {
  const sm = await readFile(new URL("../public/sitemap.xml", import.meta.url), "utf8");
  assert.equal((sm.match(/<loc>/g) || []).length, LANGS.length * 2);
  for (const [, slug] of LANGS) assert.ok(sm.includes(`<loc>${SITE}/${slug ? slug + "/" : ""}ipv6-slow/</loc>`), slug + ": slow page");
});

test("the slow-IPv6 page is its own page: title, canonical, h1 and the article", async () => {
  for (const [lang, slug] of LANGS) {
    const h = await page((slug ? slug + "/" : "") + "ipv6-slow");
    const home = await page(slug);
    const dir = (slug ? slug + "/" : "") + "ipv6-slow/";
    assert.notEqual(one(h, /<title>(.*?)<\/title>/), one(home, /<title>(.*?)<\/title>/), lang + ": own title");
    assert.equal(one(h, /<link rel="canonical" href="(.*?)">/), SITE + "/" + dir, lang + ": canonical");
    for (const [l, s] of LANGS) assert.ok(h.includes(`hreflang="${l}" href="${SITE}/${s ? s + "/" : ""}ipv6-slow/"`), lang + ": alternate " + l);
    assert.equal((h.match(/<h1>/g) || []).length, 1, lang + ": one h1");
    assert.match(h, /<article class="art card"><h2>/, lang + ": the article");
    assert.ok(!h.includes(`class="cmp-more"`), lang + ": no link to itself");
    assert.ok(home.includes(`<p class="cmp-more"><a href="/${dir}">`), lang + ": the test links to it");
    assert.equal((h.match(/<div class="cr wait" data-p="/g) || []).length, 4, lang + ": every comparison row");
  }
});

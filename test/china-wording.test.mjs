// The China view speaks of destinations — mainland China and the rest of the world — never of "home" and "abroad".
// Those are relative to where the visitor is, and the page is read from everywhere: the line once read "Mainland
// China: works at home and abroad", which mixed the measurement point with the visitor's own country. Every language
// has its own pair of words for that mistake, and this keeps them out of the China-view strings (the rest of the page
// uses "domestic" where it really means the visitor's country, e.g. the domestic DNS resolvers in the FAQ).
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS } from "../scripts/build.mjs";

const HOME_ABROAD = {
  "zh-CN": /国内|国外/,
  "zh-TW": /國內|國外/,
  en: /\babroad\b|\bat home\b|\bhome and\b/i,
  ja: /海外/,
  ko: /해외/,
  es: /extranjer|en casa/i,
  fr: /étranger|à l’intérieur/i,
  de: /Ausland|Zuhause|Inland/i,
  pt: /exterior/i,
  ru: /за рубежом|на родине/i,
};

test("the China view names its destinations, not the visitor's home", async () => {
  for (const [lang] of LANGS) {
    const d = (await import(`../src/i18n/${lang}.mjs`)).default;
    const keys = Object.keys(d).filter(k => k.startsWith("cn_") || k === "h_cn" || k === "none6cn");
    assert.ok(keys.length >= 20, `${lang}: only ${keys.length} China-view strings found`);
    const bad = keys.filter(k => HOME_ABROAD[lang].test(d[k])).map(k => `${k}: ${d[k]}`);
    assert.deepEqual(bad, [], `${lang} says home/abroad:\n${bad.join("\n")}`);
    assert.match(d.cn_state, /\{v\}/, `${lang}: the line keeps its {v} placeholder`);
    assert.match(d.cn_state, /IPv6/, `${lang}: the line says it is about IPv6`);
  }
});

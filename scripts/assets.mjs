#!/usr/bin/env node
// Renders the link-preview images with resvg (dev dependency), 1200 × 630: public/og/<lang>.png for each language.
// Run when the headline, the subtitle or the test names change, and commit the output. Uses system fonts for the
// text (Windows: Segoe UI, Microsoft YaHei, Microsoft JhengHei, Yu Gothic UI, Malgun Gothic, Consolas), as the
// other 1ms.dog tools' scripts do.
// Usage: node scripts/assets.mjs
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import { TESTS } from "../src/probe.mjs";

const pub = new URL("../public/", import.meta.url), src = new URL("../src/", import.meta.url);
const HOST = new URL(process.env.SITE_URL || "https://ipv6.1ms.dog").host;
const FONTS = { "zh-CN": "Microsoft YaHei", "zh-TW": "Microsoft JhengHei", ja: "Yu Gothic UI", ko: "Malgun Gothic" };
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const b64 = async f => Buffer.from(await readFile(new URL(f, pub))).toString("base64");
const render = svg => new Resvg(svg, { fitTo: { mode: "width", value: 1200 }, font: { loadSystemFonts: true, defaultFontFamily: "Segoe UI" } }).render().asPng();

async function card(lang, d) {
  const ff = `${FONTS[lang] ? `'${FONTS[lang]}', ` : ""}'Segoe UI', 'Microsoft YaHei', sans-serif`;
  const logo = await b64("assets/logo-dark.svg");
  // headline and subtitle fit the left column (500 px): wrapped by estimated width, wide characters counting double
  const wide = ch => /[　-鿿가-힯＀-￯]/.test(ch), est = (t, px) => [...t].reduce((a, ch) => a + (wide(ch) ? 1 : .56) * px, 0);
  const wrap = (text, px) => {
    const out = [];
    let cur = "";
    for (const word of text.split(/(?<=[ ，、？?,：:])/)) {
      for (const piece of est(word, px) > 500 ? [...word] : [word]) {
        if (cur && est(cur + piece, px) > 500) { out.push(cur.trim()); cur = ""; }
        cur += piece;
      }
    }
    return [...out, cur.trim()];
  };
  let size = 58, lines;
  for (; (lines = wrap(d.h1, size)).length > 2 && size > 40; size -= 4);
  const subs = wrap(d.og_sub, 26).slice(0, 2);
  const top = 214 - (subs.length - 1) * 18 + (lines.length > 1 ? 0 : 26);
  const head = lines.map((l, i) => `<text x="72" y="${top + i * (size + 12)}" font-size="${size}" font-weight="700" fill="#ededed">${esc(l)}</text>`).join("");
  const subY = top + (lines.length - 1) * (size + 12) + 58;
  const subText = subs.map((l, i) => `<text x="72" y="${subY + i * 36}" font-size="26" fill="#a0a0a0">${esc(l)}</text>`).join("");
  const barY = subY + (subs.length - 1) * 36 + 42;
  // the picture: a 10/10 ring as the page draws it, and the tests with their marks
  const C = 2 * Math.PI * 62;
  const ring = `<circle cx="736" cy="330" r="62" fill="none" stroke="#2a2a2a" stroke-width="12"/>` +
    `<circle cx="736" cy="330" r="62" fill="none" stroke="#3ecf8e" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)} 400" transform="rotate(-90 736 330)"/>` +
    `<text x="736" y="346" font-size="48" font-weight="700" font-family="Consolas, monospace" fill="#3ecf8e" text-anchor="middle">10</text>` +
    `<text x="736" y="376" font-size="17" font-family="Consolas, monospace" fill="#a0a0a0" text-anchor="middle">/ 10</text>`;
  const rows = TESTS.map((x, i) => {
    const y = 214 + i * 50, name = d["t_" + x.id];
    return `<circle cx="846" cy="${y - 7}" r="12" fill="#3ecf8e" fill-opacity=".18"/><path d="M840 ${y - 7}l4 4 8-9" fill="none" stroke="#3ecf8e" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<text x="870" y="${y}" font-size="21" fill="#ededed">${esc(est(name, 21) > 280 ? [...name].slice(0, 23).join("") + "…" : name)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="${ff}">
<rect width="1200" height="630" fill="#1c1c1c"/>
<rect x="620" y="160" width="548" height="340" rx="20" fill="#232323" stroke="#363636"/>
<image x="72" y="56" width="180" height="72" href="data:image/svg+xml;base64,${logo}"/>
${head}
${subText}
<rect x="72" y="${barY}" width="120" height="6" rx="3" fill="#2dd4bf"/>
${ring}
${rows}
<text x="72" y="574" font-size="26" font-weight="600" fill="#2dd4bf">${HOST}</text>
<text x="1128" y="574" font-size="22" fill="#a0a0a0" text-anchor="end">IPv4 · IPv6 · MTU · DNS · NAT64</text>
</svg>`;
}

await mkdir(new URL("og/", pub), { recursive: true });
for (const f of (await readdir(new URL("i18n/", src))).filter(f => f.endsWith(".mjs"))) {
  const lang = f.slice(0, -4), d = (await import(new URL("i18n/" + f, src).href)).default;
  const png = render(await card(lang, d));
  await writeFile(new URL(`og/${lang.toLowerCase()}.png`, pub), png);
  console.log(`og/${lang.toLowerCase()}.png ${Math.round(png.length / 1024)} KB`);
}

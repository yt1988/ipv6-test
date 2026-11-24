// Visitor-visible text names the measurement endpoints by their role — "this site's IPv4-only endpoint in Tokyo",
// "this site's server in Shanghai" — never by their internal hostnames. Which names the servers answer on is an
// operational detail: a page or a README that lists them tells anyone what to probe, and the address is in the code
// that calls them (src/app.js) and in the operations notes. This scans what a visitor can read: the language files,
// the built pages, both READMEs and llms.txt. (The bundles under public/assets/ hold the real addresses by design.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const BANNED = /(?<![\w.-])(?:v4\.ipv6\.1ms\.dog|v6\.ipv6\.1ms\.dog|he\.ipv6\.1ms\.dog|[\w-]+\.dog\.1msapp\.com)(?![\w.-])/i;

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

test("no internal measurement hostname in anything a visitor reads", async () => {
  const files = [
    ...(await walk(new URL("src/i18n/", ROOT))),
    ...(await walk(new URL("public/", ROOT))).filter(u => u.pathname.endsWith(".html")),
    new URL("public/llms.txt", ROOT),
    new URL("README.md", ROOT),
    new URL("README.zh-CN.md", ROOT),
  ];
  assert.ok(files.length > 20, "found " + files.length + " files");
  const bad = [];
  for (const f of files) {
    const text = await readFile(f, "utf8");
    const m = BANNED.exec(text);
    if (m) bad.push(f.pathname.replace(/.*\/ipv6-test\//, "") + ": " + m[0]);
  }
  assert.deepEqual(bad, [], "internal hostnames in visitor-visible text:\n" + bad.join("\n"));
});

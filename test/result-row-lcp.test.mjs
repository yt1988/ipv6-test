// The address rows must ship empty (#147, 一.3). On phones the visitor's address is the largest paint on 41% of the
// tool's page loads, and its record is written in the same frame as the script fills the row: the number is the
// answer's arrival, not a slow first paint. An empty row is also what the traffic report reads as a result row
// (`filledByScript()`, shell 2026-11-23). A placeholder with text would neither be reliable — the address arrives
// inside its own `<code>` and is recorded again, measured 2 of 3 runs — nor honest: the first-screen paint counted
// for the result would be something that is not it (docs/design.md, "The result row as the largest paint").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../src/page.html", import.meta.url), "utf8");

test("both address rows are empty in the served HTML, with only the skeleton bar", () => {
  for (const id of ["ip6", "ip4"]) {
    const m = new RegExp(`<span[^>]*\\sid="${id}"[^>]*>([\\s\\S]*?)</span>`).exec(html);
    assert.ok(m, `#${id} must be in the served HTML`);
    const text = m[1].replace(/<[^>]*>/g, "").trim();
    assert.equal(text, "", `#${id} must not paint a placeholder text before its test answers`);
    assert.match(m[1], /class="skl"/, `#${id} keeps its height with the skeleton bar`);
  }
});

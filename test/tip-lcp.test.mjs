// The tooltip bubble must not be a largest-contentful-paint candidate (#146, 一.5: 13% of desktop loads had it as the
// largest paint, p75 14,700 ms). Chromium records a text at its FIRST paint and never again, and a box that is not
// painted (empty, opacity 0, display:none, visibility:hidden, content-visibility:hidden, outside the viewport) has no
// first paint until it is shown — so its first paint is the reveal, mapped to the whole bubble, and it becomes the
// largest element on the page. Measured on the built page, pointer onto the score box 1.2 s after navigation, 6 runs:
// bubble created when first shown 6/6, bubble in the page from load but empty or transparent 6/6, hidden with
// visibility/content-visibility 6/6; in the HTML and painted at load shrunk to nothing 0/6, the h1 then the largest
// paint as before (docs/design.md, "Page speed"). Building it from a script is not enough: the scripts run after the
// first frame, so a pointer already on the score box then gets the reveal as the bubble's first paint (1/6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, css, html] = await Promise.all(
  ["../src/app.js", "../src/style.css", "../src/page.html"].map(f => readFile(new URL(f, import.meta.url), "utf8")));
const code = app.slice(app.indexOf("tooltips (data-why)"), app.indexOf("copy an address"));
const rule = css.match(/^\.tip\.pre \{[^}]*\}$/m)?.[0] || "";

test("the bubble is in the served HTML, with its text, before the scripts", () => {
  assert.match(html, /<div class="tip pre" id="tip"[^>]*>\{\{a:score_tip\}\}<\/div>/, "the bubble must be server-rendered");
  assert.ok(html.indexOf('id="tip"') < html.indexOf('<script src="/assets/{{js}}"'), "it must paint with the first frame");
});

test("its first paint is at zero size, and showing it only drops that state", () => {
  // Painted, not hidden: opacity must be 1 and no display/visibility/content-visibility, or it has no first paint.
  assert.ok(rule, ".tip.pre must exist");
  assert.match(rule, /transform: scale\(0\)/, "the first paint must be mapped to no area");
  assert.match(rule, /opacity: 1/, "it must be painted at load");
  assert.doesNotMatch(rule, /visibility|content-visibility|display/, "hidden is not painted, so it has no first paint");
  // the script may only use the element and leave that state; it must not create it
  assert.match(code, /getElementById\("tip"\)/, "app.js must use the served element");
  assert.doesNotMatch(code, /createElement\("div"\)|appendChild\(Object\.assign/, "app.js must not build the bubble");
  const show = code.slice(code.indexOf("function showTip"), code.indexOf("document.addEventListener(\"mouseover\""));
  assert.match(show, /classList\.remove\("pre"\)/, "showTip must release it from the zero-size state");
});

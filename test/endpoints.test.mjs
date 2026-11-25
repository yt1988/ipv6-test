// Which server answers is the deployment's, never the repository's (tool-contract §2): the shell that serves the page
// writes it into <meta name="ms-ipv6" content="4=…;6=…;he=…">. CI, a local build and a self-hosted copy have no meta,
// and that is the path these tests pin: no path-MTU line, "unavailable" for the fallback demo, never an error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { endpoints } from "../src/egress.js";

const doc = (metas = {}) => ({
  querySelector: sel => {
    const name = /name="([^"]+)"/.exec(sel)?.[1];
    return name && metas[name] != null ? { getAttribute: () => metas[name] } : null;
  },
});

test("no injected meta: no endpoints, and this page says so instead of failing", async () => {
  assert.deepEqual(endpoints("ms-ipv6", doc()), {});
  assert.deepEqual(endpoints("ms-ipv6", undefined), {});
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app, /endpoints\("ms-ipv6"\)/, "the page reads the server from the injected meta");
  assert.match(app, /!API\[6\] \|\| !HE/, "a missing Happy Eyeballs endpoint is reported, not fetch()ed");
  // the server's addresses live in the deployment, not here
  assert.doesNotMatch(app, /(?:^|[^\w.-])(?:v4|v6|he)\.ipv6\.1ms\.dog/, "no measurement hostname in the page script");
  const assets = await readdir(new URL("../public/assets/", import.meta.url));
  for (const f of assets.filter(f => /^app\..*\.js$/.test(f))) {
    assert.doesNotMatch(await readFile(new URL("../public/assets/" + f, import.meta.url), "utf8"), /(?:^|[^\w.-])(?:v4|v6|he)\.ipv6\.1ms\.dog/);
  }
});

test("ms-ipv6 is read as key=value pairs; a key left out is that reading unavailable", () => {
  const full = doc({ "ms-ipv6": "4=https://v4.example:8445;6=https://v6.example:8445;he=https://he.example:8446" });
  assert.deepEqual(endpoints("ms-ipv6", full), {
    4: "https://v4.example:8445", 6: "https://v6.example:8445", he: "https://he.example:8446",
  });
  assert.deepEqual(endpoints("ms-ipv6", doc({ "ms-ipv6": "6=https://v6.example:8445" })), { 6: "https://v6.example:8445" });
});

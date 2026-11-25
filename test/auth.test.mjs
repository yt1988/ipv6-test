// The page token (docs/tool-contract.md, "端点鉴权"): requests to our own endpoints carry the shell's token, a 401
// renews it once at /_ms/token and retries once, and a page without the meta sends nothing. These are the rules that
// keep a stale token from turning a measurement into a 401, and keep a renewal loop from ever happening.
import { test } from "node:test";
import assert from "node:assert/strict";
import { authFetch, readToken } from "../src/auth.js";

function fakeDoc(metas = {}) {
  const m = { ...metas };
  return {
    querySelector(sel) {
      const name = /name="([^"]+)"/.exec(sel)?.[1];
      if (!name || m[name] === undefined) return null;
      return { getAttribute: () => m[name], setAttribute: (_, v) => { m[name] = v; } };
    },
    value: name => m[name],
  };
}

const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, headers: init.headers || {} });
    for (const [match, handler] of routes) if (url.startsWith(match)) return handler(url, init, calls);
    return res(404, {});
  };
  f.calls = calls;
  return f;
}

const OURS = "https://v4.example:8445";
const isOurs = url => url.startsWith(OURS);

test("our endpoints carry the page token, other hosts do not", async () => {
  const doc = fakeDoc({ "ms-auth": "v1.1.n.ipv6.sig" });
  const f = fakeFetch([["https://", () => res(200, { ok: 1 })]]);
  const af = authFetch({ fetch: f, doc, isOurs });
  await af(OURS + "/mss");
  await af("https://public.example/trace");
  assert.equal(f.calls[0].headers.Authorization, "Bearer v1.1.n.ipv6.sig");
  assert.equal(f.calls[1].headers.Authorization, undefined);
  assert.equal(readToken(doc), "v1.1.n.ipv6.sig");
});

test("a 401 renews the token once, updates the meta and retries with the fresh one", async () => {
  const doc = fakeDoc({ "ms-auth": "v1.old.n.ipv6.sig" });
  let n = 0;
  const f = fakeFetch([
    ["/_ms/token", () => res(200, { token: "v1.new.n.ipv6.sig" })],
    [OURS, () => (n++ === 0 ? res(401, { error: "bad_token" }) : res(200, { seen: true }))],
  ]);
  const af = authFetch({ fetch: f, doc, isOurs });
  const out = await af(OURS + "/mss");
  assert.equal(out.status, 200);
  assert.equal(f.calls.filter(c => c.url.startsWith(OURS)).length, 2);
  assert.equal(f.calls.filter(c => c.url === "/_ms/token").length, 1);
  assert.equal(f.calls.at(-1).headers.Authorization, "Bearer v1.new.n.ipv6.sig");
  assert.equal(doc.value("ms-auth"), "v1.new.n.ipv6.sig");
});

test("only one retry: a second 401 is handed back to the caller", async () => {
  const doc = fakeDoc({ "ms-auth": "v1.old.n.ipv6.sig" });
  const f = fakeFetch([
    ["/_ms/token", () => res(200, { token: "v1.new.n.ipv6.sig" })],
    [OURS, () => res(401, { error: "bad_token" })],
  ]);
  const af = authFetch({ fetch: f, doc, isOurs });
  const out = await af(OURS + "/seen?ip=x");
  assert.equal(out.status, 401);
  assert.equal(f.calls.filter(c => c.url.startsWith(OURS)).length, 2);
  assert.equal(f.calls.filter(c => c.url === "/_ms/token").length, 1);
});

test("no meta: no header, and no renewal even on a 401", async () => {
  const doc = fakeDoc({});
  const f = fakeFetch([[OURS, () => res(401, { error: "no_token" })]]);
  const af = authFetch({ fetch: f, doc, isOurs });
  const out = await af(OURS + "/mss");
  assert.equal(out.status, 401);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].headers.Authorization, undefined);
});

test("a shell with no secret answers an empty token: no retry, the 401 stands", async () => {
  const doc = fakeDoc({ "ms-auth": "v1.old.n.ipv6.sig" });
  const f = fakeFetch([
    ["/_ms/token", () => res(200, { token: "" })],
    [OURS, () => res(401, { error: "bad_token" })],
  ]);
  const af = authFetch({ fetch: f, doc, isOurs });
  const out = await af(OURS + "/mss");
  assert.equal(out.status, 401);
  assert.equal(f.calls.filter(c => c.url.startsWith(OURS)).length, 1);
  assert.equal(f.calls.filter(c => c.url === "/_ms/token").length, 1);
});

test("requests that 401 together share one renewal", async () => {
  const doc = fakeDoc({ "ms-auth": "v1.old.n.ipv6.sig" });
  let seen = 0;
  const f = fakeFetch([
    ["/_ms/token", async () => { await new Promise(r => setTimeout(r, 5)); return res(200, { token: "v1.new.n.ipv6.sig" }); }],
    [OURS, (_u, init) => (init.headers.Authorization === "Bearer v1.new.n.ipv6.sig" ? res(200, {}) : (seen++, res(401, {})))],
  ]);
  const af = authFetch({ fetch: f, doc, isOurs });
  const [a, b] = await Promise.all([af(OURS + "/mss"), af(OURS + "/mss")]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(f.calls.filter(c => c.url === "/_ms/token").length, 1);
  assert.equal(seen, 2); // each request saw its own 401 before the shared renewal
});

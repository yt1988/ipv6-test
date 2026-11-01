// Reading the answers, the score and the verdict, and shared links.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTS, IDS, readAnswer, kind6, famOf, score, verdict, SLOW } from "../src/probe.mjs";
import { encode, decode, sharePath } from "../src/share.mjs";

const ok = (fam, ms = 50, extra = {}) => ({ ok: true, fam, ms, rtt: ms / 2, ip: fam === 6 ? "2408:8207::1" : fam === 4 ? "114.254.73.157" : "", ...extra });
const no = { ok: false, err: "fail" };
const all = { v4: ok(4), v6: ok(6), ds: ok(6), big: ok(6), lit6: ok(6), lit4: ok(4) };

test("answers are read the way each host writes them", () => {
  assert.deepEqual(readAnswer("text", "2408:8207:265b::5ab3\n"), { ip: "2408:8207:265b::5ab3" });
  assert.equal(readAnswer("text", "<html>"), null);
  assert.deepEqual(readAnswer("trace", "fl=1\nip=1.2.3.4\nloc=CN\ncolo=LAX\n"), { ip: "1.2.3.4", cc: "CN", colo: "LAX" });
  assert.deepEqual(readAnswer("radar", '{"asn":4808,"country":"CN","ip_address":"114.254.73.157"}'), { ip: "114.254.73.157", asn: 4808, cc: "CN" });
  assert.equal(readAnswer("radar", "nope"), null);
  assert.equal(famOf("1.2.3.4"), 4); assert.equal(famOf("::1"), 6); assert.equal(famOf("x"), 0);
});

test("IPv6 kinds", () => {
  assert.equal(kind6("2408:8207::1"), "native");
  assert.equal(kind6("2002:c000:204::1"), "6to4");
  assert.equal(kind6("2001:0:4136:e378::1"), "teredo");
  assert.equal(kind6("2001:db8::1"), "native");
  assert.equal(kind6("1.2.3.4"), "");
});

test("the score", () => {
  assert.equal(score(all), 10);
  assert.equal(score({ ...all, v6: no, lit6: no, big: no }), 0, "no IPv6");
  assert.equal(score({ ...all, ds: ok(4) }), 9, "browser picks IPv4");
  assert.equal(score({ ...all, big: no }), 8, "MTU");
  assert.equal(score({ ...all, ds: ok(6, SLOW + 1) }), 8, "dual stack waits");
  assert.equal(score({ ...all, v6: ok(6, SLOW + 1) }), 9, "slow IPv6");
  assert.equal(score({ ...all, v6: no }), 6, "DNS hides AAAA");
  assert.equal(score({}), 0, "nothing in yet");
});

test("the verdict", () => {
  assert.deepEqual(verdict(all), { score: 10, head: "v_ready", probs: [] });
  assert.equal(verdict({ v4: ok(4), ds: ok(4), lit4: ok(4), v6: no, lit6: no, big: no }).head, "v_none");
  assert.equal(verdict({ ...all, v6: no }).head, "v_nodns");
  assert.equal(verdict({ ...all, v6: no }).probs[0], "p_nodns");
  assert.equal(verdict({ ...all, lit4: no }).head, "v_nat64");
  assert.equal(verdict({ ...all, v4: no, lit4: no }).head, "v_only6");
  assert.equal(verdict(Object.fromEntries(IDS.map(id => [id, no]))).head, "v_offline");
  assert.equal(verdict({ ...all, big: no }).head, "v_partly");
  assert.ok(verdict({ ...all, big: no }).probs.includes("p_mtu"));
  assert.ok(verdict({ ...all, v6: ok(6, 50, { ip: "2002::1" }) }).probs.includes("p_tunnel"));
});

test("every test asks more than one host, over https", () => {
  for (const t of TESTS) {
    assert.ok(t.hosts.length >= 2, t.id);
    for (const h of t.hosts) assert.ok(h.url.startsWith("https://") || h.url.startsWith("/cdn-cgi/"), h.url);
  }
});

test("a shared result survives the link, without the addresses", () => {
  const code = encode({ ts: 1793500000000, cc: "CN", r: { ...all, big: no, gone: ok(6) } });
  assert.match(code, /^1~[0-9a-z]+~CN~/);
  assert.match(code, /^[0-9A-Za-z~._-]+$/, "path-safe");
  assert.ok(!code.includes("2408") && !code.includes("114"), "no address in it");
  const back = decode(code, new Set(IDS));
  assert.equal(back.ts, 1793500000000);
  assert.equal(back.cc, "CN");
  assert.equal(back.r.big.ok, false);
  assert.equal(back.r.v6.kind, "native");
  assert.equal(back.r.v6.ms, 50);
  assert.equal(back.r.v6.rtt, 25);
  assert.ok(!("gone" in back.r), "unknown tests skipped");
  assert.equal(verdict(back.r).score, verdict({ ...all, big: no }).score, "same score");
  assert.equal(decode("2~x~-~v6_6_1__n", new Set(IDS)), null, "a later format");
  assert.equal(decode("1~x~-~v6_9_1__n", new Set(IDS)), null, "garbage");
  assert.deepEqual(sharePath("/zh-cn/r/" + code), { slug: "zh-cn", code });
  assert.deepEqual(sharePath("/r/" + code), { slug: "", code });
  assert.equal(sharePath("/zh-cn/"), null);
});

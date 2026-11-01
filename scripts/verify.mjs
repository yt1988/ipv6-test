#!/usr/bin/env node
// Checks every test host in src/probe.mjs from where it runs: a test only means something if its hosts are what it
// says they are.
//   - IPv4-only hosts have A records and no AAAA, IPv6-only ones the reverse, dual-stack ones both
//   - hosts the page reads answer with Access-Control-Allow-Origin and a body it can read
//   - no-cors hosts answer at all
// Records are looked up over DNS over HTTPS (AliDNS, then Google), so a local proxy's fake-ip DNS doesn't skew them.
// Requests go through node:https rather than fetch: Node compares an IPv6 literal with the certificate as written
// (2606:4700:4700::1111) while certificates list it in full (2606:4700:4700:0:0:0:0:1111), so this compares the full form.
// Usage: node scripts/verify.mjs      exit 1 when a host fails
import { request } from "node:https";
import { checkServerIdentity } from "node:tls";
import { TESTS, readAnswer } from "../src/probe.mjs";

const full6 = ip => { const [a, b = ""] = ip.split("::"), l = a ? a.split(":") : [], r = b ? b.split(":") : []; return [...l, ...Array(8 - l.length - r.length).fill("0"), ...r].map(x => x.replace(/^0+(?=.)/, "")).join(":"); };
const check = (host, cert) => host.includes(":")
  ? (cert.subjectaltname || "").split(", ").includes("IP Address:" + full6(host)) ? undefined : new Error(host + " is not in the certificate")
  : checkServerIdentity(host, cert);
const get = (url, headers = {}) => new Promise((res, rej) => {
  const u = new URL(url);
  const req = request({ host: u.hostname.replace(/^\[|\]$/g, ""), path: u.pathname + u.search, headers: { "user-agent": "ipv6-test verify", ...headers }, timeout: 10000, checkServerIdentity: check }, r => {
    let body = ""; r.setEncoding("utf8"); r.on("data", c => { body += c; }); r.on("end", () => res({ status: r.statusCode, headers: r.headers, body }));
  });
  req.on("timeout", () => req.destroy(new Error("timeout"))); req.on("error", rej); req.end();
});

async function records(host, type) {
  for (const doh of ["https://dns.alidns.com/resolve", "https://dns.google/resolve"]) {
    try {
      const j = JSON.parse((await get(`${doh}?name=${host}&type=${type}`)).body);
      return (j.Answer || []).some(a => a.type === (type === "A" ? 1 : 28));
    } catch (e) {}
  }
  return null;
}

let bad = 0;
const say = (okay, what, why = "") => { if (!okay) bad++; console.log(`${okay ? "ok  " : "FAIL"} ${what}${why ? "  " + why : ""}`); };

for (const t of TESTS) {
  for (const h of t.hosts) {
    if (h.url.startsWith("/")) { console.log(`skip ${t.id} ${h.url} (this site's own)`); continue; }
    const host = new URL(h.url).hostname, literal = host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host);
    const what = `${t.id.padEnd(4)} ${host}`;
    if (!literal) {
      const a = await records(host, "A"), aaaa = await records(host, "AAAA");
      const want = t.fam === 4 ? a && !aaaa : t.fam === 6 ? aaaa && !a : a && aaaa;
      if (!want) { say(false, what, `A ${a}, AAAA ${aaaa}`); continue; }
    }
    try {
      const res = await get(h.url, { origin: "https://ipv6.1ms.dog" });
      if (!h.read) { say(res.status > 0, what, `answers ${res.status} (no-cors)`); continue; }
      const cors = res.headers["access-control-allow-origin"], got = res.status === 200 && readAnswer(h.read, res.body);
      say(!!(cors && got), what, !cors ? "no CORS header" : !got ? `unreadable (${res.status})` : got.ip);
    } catch (e) {
      say(false, what, e.code || e.message);
    }
  }
}
process.exitCode = bad ? 1 : 0;

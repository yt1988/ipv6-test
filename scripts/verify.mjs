#!/usr/bin/env node
// Checks every test host in src/probe.mjs from where it runs: a test only means something if its hosts are what it
// says they are.
//   - IPv4-only hosts have A records and no AAAA, IPv6-only ones the reverse, dual-stack ones both (the IPv4 against
//     IPv6 pairs too)
//   - hosts the page reads answer with Access-Control-Allow-Origin and a body it can read
//   - no-cors hosts answer at all
// Records are looked up over DNS over HTTPS (AliDNS, then Google), so a local proxy's fake-ip DNS doesn't skew them.
// Requests go through node:https rather than fetch: Node compares an IPv6 literal with the certificate as written
// (2606:4700:4700::1111) while certificates list it in full (2606:4700:4700:0:0:0:0:1111), so this compares the full form.
// Usage: node scripts/verify.mjs [--require-v6]      exit 1 when a host fails
// A machine without IPv6 can't check the IPv6 half. GitHub's hosted runners have none, so there those checks are
// skipped and counted as skipped, never as failures; the A/AAAA records are still looked up, so a host that gains or
// loses an address family is still caught. --require-v6 makes "no IPv6 here" a failure: use it where the IPv6 checks
// must run (a dual-stack machine).
import { request } from "node:https";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { checkServerIdentity } from "node:tls";
import { TESTS, SIDES, readAnswer, kind6 } from "../src/probe.mjs";

const full6 = ip => { const [a, b = ""] = ip.split("::"), l = a ? a.split(":") : [], r = b ? b.split(":") : []; return [...l, ...Array(8 - l.length - r.length).fill("0"), ...r].map(x => x.replace(/^0+(?=.)/, "")).join(":"); };
const check = (host, cert) => host.includes(":")
  ? (cert.subjectaltname || "").split(", ").includes("IP Address:" + full6(host)) ? undefined : new Error(host + " is not in the certificate")
  : checkServerIdentity(host, cert);
const get = (url, headers = {}, family) => new Promise((res, rej) => {
  const u = new URL(url);
  const req = request({ host: u.hostname.replace(/^\[|\]$/g, ""), path: u.pathname + u.search, family, headers: { "user-agent": "ipv6-test verify", ...headers }, timeout: 10000, checkServerIdentity: check }, r => {
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

// A machine can only check the IPv6 hosts if IPv6 gets through: a global unicast address (2000::/3, not a tunnel)
// and one answer from a v6 host on another network. A stale address, or a route that carries nothing, would
// otherwise turn every IPv6 check into a red herring.
const global6 = () => Object.values(networkInterfaces()).flat().some(i =>
  (i.family === "IPv6" || i.family === 6) && !i.internal && /^[23]/.test(i.address) && kind6(i.address) === "native");
const reach = host => new Promise(res => {
  const s = connect({ host, port: 443, timeout: 5000 });
  const done = okay => { s.destroy(); res(okay); };
  s.once("connect", () => done(true)); s.once("timeout", () => done(false)); s.once("error", () => done(false));
});
const no6 = !global6() ? "this machine has no global IPv6 address"
  : !(await Promise.all(["2606:4700:4700::1111", "2001:4860:4860::8888", "ipv6.ddnspod.com"].map(reach))).some(Boolean)
    ? "Cloudflare, Google and DNSPod all failed over IPv6 from this machine" : "";
const v6 = !no6, requireV6 = process.argv.includes("--require-v6");

let ok4 = 0, bad4 = 0, ok6 = 0, bad6 = 0, skip6 = 0;
const say = (okay, what, why = "", six = false) => {
  okay ? six ? ok6++ : ok4++ : six ? bad6++ : bad4++;
  console.log(`${okay ? "ok  " : "FAIL"} ${what}${why ? "  " + why : ""}`);
};

for (const t of [...TESTS, ...SIDES]) {
  for (const h of t.hosts) {
    if (h.url.startsWith("/")) { console.log(`skip ${t.id} ${h.url} (this site's own)`); continue; }
    const host = new URL(h.url).hostname, literal = host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host);
    // six: this host's own request needs an IPv6 route (a v6-only name or an IPv6 literal). A dual-stack name is
    // checked over IPv4 when this machine has no IPv6, and its AAAA record is still looked up.
    const six = t.fam === 6 || host.startsWith("["), what = `${t.id.padEnd(4)} ${host}`;
    if (!literal) {
      const a = await records(host, "A"), aaaa = await records(host, "AAAA");
      const want = t.fam === 4 ? a && !aaaa : t.fam === 6 ? aaaa && !a : a && aaaa;
      if (!want) { say(false, what, `A ${a}, AAAA ${aaaa}`, six); continue; }
    }
    if (six && !v6) { skip6++; console.log(`skip ${what} (IPv6: ${no6})`); continue; }
    try {
      const res = await get(h.url, { origin: "https://ipv6.1ms.dog" }, v6 ? undefined : 4);
      if (!h.read) { say(res.status > 0, what, `answers ${res.status} (no-cors)`, six); continue; }
      const cors = res.headers["access-control-allow-origin"], got = res.status === 200 && readAnswer(h.read, res.body);
      say(!!(cors && got), what, !cors ? "no CORS header" : !got ? `unreadable (${res.status})` : got.ip || "answers " + res.status, six);
    } catch (e) {
      say(false, what, e.code || e.message, six);
    }
  }
}

console.log(`\nv4 and dual-stack: ${ok4} ok, ${bad4} failed`);
if (v6) console.log(`v6: ${ok6} ok, ${bad6} failed`);
else console.log(`v6: not checked — ${no6}; ${skip6} IPv6 ${skip6 === 1 ? "check" : "checks"} skipped, not failed`);
if (requireV6 && !v6) { bad6++; console.log("FAIL --require-v6: this run needs IPv6"); }
process.exitCode = bad4 + bad6 ? 1 : 0;

// The tests, how they run in the browser, and how the results become a score.
//
// Each test asks a few hosts at once and takes the first that answers: one host may be blocked or slow from a network
// where another works (DNSPod answers in mainland China, icanhazip and Cloudflare everywhere else). A test passes when
// any of them answers within TIMEOUT.
//
//   v4    hosts with only an IPv4 address (A record): can you reach the IPv4 internet, and from which address
//   v6    hosts with only an IPv6 address (AAAA record): can you reach the IPv6 internet; needs your DNS to give AAAA
//   ds    hosts with both: which one your browser picks, and whether it is slow to (a broken IPv6 makes it wait)
//   big   an IPv6-only host asked with a 3.5 KB URL on a new connection: full-size packets both ways (the request, and
//         the server's TLS certificate); a broken path MTU loses them, and pages hang while small requests work
//   lit6  an IPv6 address with no name: IPv6 works without DNS (passes when v6 fails only if DNS hides AAAA)
//   lit4  an IPv4 address with no name: fails on IPv6-only networks with NAT64, where v4 still passes through DNS64
//
// Hosts that send CORS headers are read (the address they saw); the rest are fetched no-cors, which only says that a
// connection was made. scripts/verify.mjs checks that each host is what its test needs.

export const TIMEOUT = 10000;   // ms; test-ipv6.com allows 15 s, but a page that takes 10 s is already broken
export const SLOW = 3000;       // ms for the first answer, connection included: slower than this counts against IPv6

const PAD = "x".repeat(3500);

// read: how to get the address out of the answer ("text": the body is the address; "trace": Cloudflare's key=value
// lines; "radar": Cloudflare Radar's JSON, with the network's ASN and country; null: no-cors, nothing to read)
export const TESTS = [
  { id: "v4", fam: 4, hosts: [
    { url: "https://ipv4.ddnspod.com/", read: "text" },
    { url: "https://ipv4.icanhazip.com/", read: "text" },
    { url: "https://ipv4-check-perf.radar.cloudflare.com/", read: "radar" },
  ] },
  { id: "v6", fam: 6, hosts: [
    { url: "https://ipv6.ddnspod.com/", read: "text" },
    { url: "https://ipv6.icanhazip.com/", read: "text" },
    { url: "https://ipv6-check-perf.radar.cloudflare.com/", read: "radar" },
  ] },
  // this site's own trace first: on Cloudflare, every site is reachable over both
  { id: "ds", fam: 0, hosts: [
    { url: "/cdn-cgi/trace", read: "trace" },
    { url: "https://icanhazip.com/", read: "text" },
    { url: "https://api64.ipify.org/", read: "text" },
  ] },
  { id: "big", fam: 6, hosts: [
    { url: "https://[2606:4700:4700::1001]/cdn-cgi/trace?pad=" + PAD, read: "trace" },
    { url: "https://api6.ipify.org/?pad=" + PAD, read: "text" },
  ] },
  { id: "lit6", fam: 6, hosts: [
    { url: "https://[2606:4700:4700::1111]/cdn-cgi/trace", read: "trace" },
    // not AliDNS [2400:3200::1]: its certificate doesn't list its IPv6 addresses, so browsers refuse it
    { url: "https://[2606:4700:4700::64]/cdn-cgi/trace", read: "trace" },
  ] },
  { id: "lit4", fam: 4, hosts: [
    { url: "https://1.0.0.1/cdn-cgi/trace", read: "trace" },
    { url: "https://223.5.5.5/resolve?name=1ms.dog&type=1", read: null },
  ] },
];
export const IDS = TESTS.map(t => t.id);

// every host a test asks, for the CSP and the docs (IPv6 literals can't be named in a CSP: see the build)
export const ORIGINS = [...new Set(TESTS.flatMap(t => t.hosts.map(h => h.url)).filter(u => u.startsWith("https://")).map(u => new URL(u).origin))];

// ---------- addresses ----------

export const famOf = ip => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip || "") ? 4 : /^[0-9a-f:.]+$/i.test(ip || "") && ip.includes(":") ? 6 : 0;

// the address out of an answer body
export function readAnswer(read, body) {
  if (read === "text") { const ip = String(body).trim(); return famOf(ip) ? { ip } : null; }
  if (read === "trace") {
    const kv = Object.fromEntries(String(body).split("\n").map(l => l.split("=")).filter(p => p.length === 2));
    return famOf(kv.ip) ? { ip: kv.ip, cc: /^[A-Z]{2}$/.test(kv.loc || "") ? kv.loc : "", colo: kv.colo || "" } : null;
  }
  if (read === "radar") {
    try {
      const j = JSON.parse(body);
      return famOf(j.ip_address) ? { ip: j.ip_address, asn: j.asn || 0, cc: /^[A-Z]{2}$/.test(j.country || "") ? j.country : "" } : null;
    } catch (e) { return null; }
  }
  return null;
}

// What kind of IPv6 address: native, or one of the old tunnels that are slow and often broken
export function kind6(ip) {
  if (famOf(ip) !== 6) return "";
  const first = ip.toLowerCase().split(":");
  if (first[0] === "2002") return "6to4";
  if (first[0] === "2001" && (first[1] === "0" || first[1] === "0000" || first[1] === "")) return "teredo";
  return "native";
}

// ---------- running ----------

const now = () => performance.now();

// One host: ms to the answer and what it said. Throws on failure or timeout.
async function ask(h, signal) {
  const t0 = now();
  const res = await fetch(h.url, { mode: h.read ? "cors" : "no-cors", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal });
  if (h.read && !res.ok) throw new Error("http " + res.status);
  const body = h.read ? await res.text() : "";
  const ms = now() - t0;
  const got = h.read ? readAnswer(h.read, body) : {};
  if (!got) throw new Error("unreadable");
  return { ms, ...got };
}

// A test: the first host to answer. Its connection is warm now, so three more requests to it time the round trip
// (the smallest of the three); the first answer included DNS, TCP and TLS.
// → { ok, ms, rtt, host, ip, fam, asn, cc } or { ok: false, err: "timeout" | "fail" }
export async function runTest(test, { signal, rtt = true } = {}) {
  const ctl = new AbortController(), stop = () => ctl.abort();
  signal && signal.addEventListener("abort", stop);
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const won = await Promise.any(test.hosts.map(h => ask(h, ctl.signal).then(r => ({ h, r }))));
    clearTimeout(timer);
    ctl.abort();   // the others lose
    const { h, r } = won, out = { ok: true, ms: r.ms, host: new URL(h.url, location.href).host, ip: r.ip || "", fam: famOf(r.ip), asn: r.asn || 0, cc: r.cc || "" };
    if (rtt && h.read) {
      const times = [];
      for (let i = 0; i < 3 && !(signal && signal.aborted); i++) {
        try { times.push((await ask(h, signal)).ms); } catch (e) { break; }
      }
      if (times.length) out.rtt = Math.min(...times);
    }
    return out;
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, err: signal && signal.aborted ? "abort" : ctl.signal.aborted ? "timeout" : "fail" };
  } finally {
    signal && signal.removeEventListener("abort", stop);
  }
}

// ---------- the score ----------

// What the score counts, out of 10 (test-ipv6.com's idea: how ready this network is for IPv6-only sites, and whether
// IPv6 breaks anything):
//   4  IPv6-only sites work                      2  large packets get through over IPv6
//   1  IPv6 works without DNS (an address)       2  dual-stack sites open without waiting
//   1  the browser picks IPv6 on dual-stack sites
// −1 when IPv6's first answer took longer than SLOW. No IPv6 at all is 0.
export const POINTS = { v6: 4, lit6: 1, big: 2, ds: 2, prefer: 1 };

// r: { [id]: result } (results not in yet count as failed)
export function score(r) {
  const ok = id => !!(r[id] && r[id].ok);
  if (!ok("v6") && !ok("lit6")) return 0;
  let s = 0;
  if (ok("v6")) s += POINTS.v6;
  if (ok("lit6")) s += POINTS.lit6;
  if (ok("big")) s += POINTS.big;
  if (ok("ds") && r.ds.ms <= SLOW) s += POINTS.ds;
  if (ok("ds") && r.ds.fam === 6) s += POINTS.prefer;
  if ((ok("v6") && r.v6.ms > SLOW) || (ok("big") && r.big.ms > SLOW)) s -= 1;
  return Math.max(0, Math.min(10, s));
}

// The verdict: one key for the headline, and the problems in the order they matter (keys of the page's strings)
export function verdict(r) {
  const ok = id => !!(r[id] && r[id].ok);
  const s = score(r), probs = [];
  let head;
  if (!ok("v4") && !ok("v6") && !ok("ds") && !ok("lit4") && !ok("lit6")) head = "v_offline";
  else if (!ok("v6") && !ok("lit6")) head = "v_none";
  else if (!ok("v6")) head = "v_nodns";
  else if (!ok("v4") && !ok("lit4")) head = "v_only6";
  // IPv4-only sites work through their name but not by address: DNS64 made up an IPv6 address and NAT64 carried it
  else if (!ok("lit4")) head = "v_nat64";
  else head = s >= 9 ? "v_ready" : "v_partly";

  if (ok("v6") || ok("lit6")) {
    if (!ok("v6")) probs.push("p_nodns");
    if (!ok("big")) probs.push("p_mtu");
    if (ok("ds") && r.ds.ms > SLOW) probs.push("p_slowds");
    if (ok("ds") && r.ds.fam === 4) probs.push("p_prefer4");
    if (ok("v6") && r.v6.ms > SLOW) probs.push("p_slow6");
    const k = r.v6 && (r.v6.kind || kind6(r.v6.ip));
    if (k === "6to4" || k === "teredo") probs.push("p_tunnel");
    if (!ok("lit6")) probs.push("p_lit6");
  }
  if (!ok("v4") && ok("lit4")) probs.push("p_v4dns");
  return { score: s, head, probs };
}

// the tier a score is drawn in: t1 green … t5 red, as the other 1ms.dog tools draw times
export const tierOf = s => s >= 9 ? "t1" : s >= 7 ? "t2" : s >= 5 ? "t3" : s >= 1 ? "t4" : "t5";

// A result in a link: /r/<code> (or /<lang>/r/<code>). The Worker reads the code to put the score in the link's
// preview title; the page reads it to show the result. No address goes in it, no network, and the country only when
// the visitor ticks the box.
//
// Format 1:  1~<time, base 36 seconds>~<country or ->~<test>.<test>…
//   test:    <id>_<family>_<first answer>_<round trip>_<IPv6 kind>
//            family: 4 or 6, which one the answer came over; empty: no answer
//            times in tenths of a millisecond, base 36, empty when none
//            IPv6 kind: n native, 6 6to4, t Teredo, empty when not IPv6
// Tests are named by id, so a link keeps working when tests are added: ids the reader doesn't know are skipped. A
// later format gets a new first number; old links keep theirs.

import { kind6 } from "./probe.mjs";

export const FORMAT = 1;
const n36 = v => v == null ? "" : Math.max(0, Math.round(v * 10)).toString(36);
const p36 = s => s === "" || s == null ? null : /^[0-9a-z]+$/.test(s) ? parseInt(s, 36) / 10 : NaN;
const K = { native: "n", "6to4": "6", teredo: "t" }, KR = { n: "native", 6: "6to4", t: "teredo" };

// { ts, cc, r: { [id]: result } } → code
export function encode({ ts, cc, r }) {
  const body = Object.entries(r).map(([id, x]) => x && x.ok
    ? [id, x.fam || "0", n36(x.ms), n36(x.rtt), K[kind6(x.ip)] || ""].join("_")
    : [id, "", "", "", ""].join("_"));
  return [FORMAT, Math.round(ts / 1000).toString(36), /^[A-Z]{2}$/.test(cc || "") ? cc : "-", body.join(".")].join("~");
}

// code → { ts, cc, r } with only the ids in `known`, or null when it isn't a result this page can read. A test read
// back has no address: `kind` stands in for what the address said.
export function decode(code, known) {
  if (typeof code !== "string" || code.length > 2000) return null;
  const [v, ts, cc, body] = code.split("~");
  if (v !== "1" || !/^[0-9a-z]+$/.test(ts || "") || !body) return null;
  const r = {};
  for (const part of body.split(".")) {
    const [id, fam, ms, rtt, k] = part.split("_");
    if (!known.has(id) || id in r) continue;
    if (fam === "" || fam === undefined) { r[id] = { ok: false, err: "fail" }; continue; }
    if (!/^[046]$/.test(fam) || (k && !KR[k])) return null;
    const x = { ok: true, fam: +fam, ms: p36(ms), rtt: p36(rtt), kind: KR[k] || "", ip: "" };
    if (Number.isNaN(x.ms) || Number.isNaN(x.rtt) || x.ms == null) return null;
    if (x.rtt == null) delete x.rtt;
    r[id] = x;
  }
  return Object.keys(r).length ? { ts: parseInt(ts, 36) * 1000, cc: /^[A-Z]{2}$/.test(cc) ? cc : "", r } : null;
}

// /r/<code> or /<lang folder>/r/<code> → { slug, code }, or null
export function sharePath(pathname) {
  const m = /^\/(?:([a-z]{2}(?:-[a-z]{2})?)\/)?r\/([0-9A-Za-z~._-]+)\/?$/.exec(pathname);
  return m ? { slug: m[1] || "", code: decodeURIComponent(m[2]) } : null;
}


// IPv6 Test page. Every test's row is in the HTML from the start; the tests (src/probe.mjs) run at once and fill
// their rows as they answer, and the hero follows: the score and the verdict so far, the two addresses as soon as
// they are known. IPv4 against IPv6 runs alongside, one row per network. Strings: window.L1MS.
import { TESTS, IDS, SIDES, PAIRS, SLOW, runTest, network, sameIp, verdict, compare, kind6, tierOf } from "./probe.mjs";
import { encode as encodeShare, decode as decodeShare, sharePath } from "./share.mjs";

(function () {
  "use strict";
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const D = JSON.parse($("#data").textContent);
  // The slow page tests IPv4 against IPv6 and nothing else, its finding in the hero, and links to the whole test on the
  // home page (1ms-shell tool-contract: a subpage tests only its own thing); its share link and card carry only that
  const ONLY = D.page === "slow";
  const L = window.L1MS || {};
  const t = (k, v) => { let s = L[k] ?? k; if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]); return s; };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const K = { theme: "ipv6test:theme", lang: "ipv6test:lang" };

  /* ---------- framed by the Connection Checkup (1ms-shell docs/checkup.md) ---------- */
  // ?embed=checkup, the shell's <meta name="check"> and that page framing us: the results only (style.css), progress,
  // size and the result sent up to it. Anything else, an ordinary page, so the shell's data-ms-embed goes.
  const CHECK = (() => {
    const m = $('meta[name="check"]');
    if (!m || window.parent === window || new URLSearchParams(location.search).get("embed") !== "checkup") return "";
    try { const o = new URL(m.content).origin; return new URL(document.referrer).origin === o ? o : ""; } catch (e) { return ""; }
  })();
  if (!CHECK) document.documentElement.removeAttribute("data-ms-embed");
  const post = msg => { if (CHECK) window.parent.postMessage({ ms: "checkup", v: 1, tool: "ipv6", ...msg }, CHECK); };

  /* ---------- theme and language (synced across the 1ms.dog tools) ---------- */
  const thBtn = $("#theme"), TH = ["system", "light", "dark"];
  const applyTheme = th => {
    if (th === "light" || th === "dark") document.documentElement.setAttribute("data-theme", th); else document.documentElement.removeAttribute("data-theme");
    thBtn.dataset.th = th; thBtn.title = t("th_" + th); thBtn.setAttribute("aria-label", t("th_" + th));
  };
  applyTheme(TH.includes(store.get(K.theme)) ? store.get(K.theme) : "system");
  thBtn.onclick = () => { const n = TH[(TH.indexOf(thBtn.dataset.th) + 1) % 3]; store.set(K.theme, n); applyTheme(n); };
  $("#lang").onchange = e => { const l = e.target.value; store.set(K.lang, l); location.href = D.paths[l] + location.search; };

  /* ---------- dialogs ---------- */
  function openDlg(id) { $("#" + id).hidden = false; document.documentElement.style.overflow = "hidden"; $("#" + id + " [data-close]").focus(); }
  function closeDlg() { $$(".scrim").forEach(s => { s.hidden = true; }); document.documentElement.style.overflow = ""; }
  $$("[data-close]").forEach(b => { b.onclick = closeDlg; });
  $$(".scrim").forEach(s => s.addEventListener("click", e => { if (e.target === s) closeDlg(); }));
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeDlg(); });
  // help: one answer at a time; a picker with previous / next on phones
  let helpIdx = 0;
  const helpN = $$("#helpNav [data-hq]").length;
  $("#helpSel").innerHTML = $$("#helpNav [data-hq]").map((b, i) => `<option value="${i}">${i + 1} / ${helpN} · ${esc(b.textContent)}</option>`).join("");
  function showHelp(i) {
    helpIdx = Math.max(0, Math.min(helpN - 1, i));
    $$("#helpNav [data-hq]").forEach(b => b.setAttribute("aria-selected", +b.dataset.hq === helpIdx));
    $$("#helpC [data-hqb]").forEach(a => { a.hidden = +a.dataset.hqb !== helpIdx; });
    $("#helpSel").value = helpIdx;
    $$("[data-hstep]").forEach(b => { b.disabled = helpIdx + +b.dataset.hstep < 0 || helpIdx + +b.dataset.hstep >= helpN; });
    $("#helpC").scrollTop = 0;
  }
  $("#helpBtn").onclick = () => { showHelp(helpIdx); openDlg("help"); };
  $$("#helpNav [data-hq]").forEach(b => { b.onclick = () => showHelp(+b.dataset.hq); });
  $("#helpSel").onchange = e => showHelp(+e.target.value);
  $$("[data-hstep]").forEach(b => { b.onclick = () => showHelp(helpIdx + +b.dataset.hstep); });

  /* ---------- tooltips (data-why) ---------- */
  let tipEl;
  function showTip(el) {
    if (!tipEl) { tipEl = document.body.appendChild(Object.assign(document.createElement("div"), { className: "tip" })); addEventListener("scroll", () => tipEl.classList.remove("on"), { passive: true }); }
    tipEl.textContent = el.dataset.why;
    const b = el.getBoundingClientRect(), w = tipEl.offsetWidth;
    tipEl.style.left = Math.max(8, Math.min(innerWidth - w - 8, b.left + b.width / 2 - w / 2)) + "px";
    tipEl.style.top = b.bottom + 6 + "px"; tipEl.classList.add("on");
  }
  document.addEventListener("mouseover", e => { const el = e.target.closest && e.target.closest("[data-why]"); if (el) showTip(el); else if (tipEl) tipEl.classList.remove("on"); });
  document.addEventListener("focusin", e => { const el = e.target.closest && e.target.closest("[data-why]"); if (el) showTip(el); });
  document.addEventListener("focusout", () => tipEl && tipEl.classList.remove("on"));

  // copy an address: click it
  document.addEventListener("click", e => {
    const c = e.target.closest && e.target.closest("code");
    if (!c || !navigator.clipboard) return;
    navigator.clipboard.writeText(c.textContent).then(() => { c.classList.add("copied"); c.dataset.why = t("copied"); showTip(c); setTimeout(() => { c.classList.remove("copied"); delete c.dataset.why; tipEl && tipEl.classList.remove("on"); }, 1200); }, () => {});
  });

  /* ---------- other 1ms.dog tools, with the addresses found here (on 1ms.dog only: the shell's <meta>) ---------- */
  // every link to another tool ends with the external-link mark (1ms-shell docs/tool-contract.md, section 4)
  const EXT = '<svg class="ext" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 10v3.5H2.5V4H6"/></svg>';
  const tool = n => { const m = document.querySelector(`meta[name="${n}"]`); return m ? m.content.replace(/\/+$/, "") + D.home : null; };
  const IPQS = tool("ipqs"), EGRESS = tool("egress"), ASN = tool("asn"), WHO = tool("who"), SPEED = tool("speed"), FULL = tool("check"), DNS = tool("dns");
  // the Connection Checkup runs this test among the others; not inside its own report
  if (!ONLY) {
    if (FULL && !CHECK) { $("#checkLink").href = FULL; $("#checkLink").hidden = false; }
    if (EGRESS) { $("#egressLink").href = EGRESS; $("#egressLink").hidden = false; }
    if (WHO) $("#whoLink").href = WHO;
    if (SPEED) $("#speedLink").href = SPEED;
  }
  // Under the addresses, once the test is over: Who Are You when IPv4 and IPv6 leave from different networks (often a
  // proxy or VPN that carries only one of them, so the other leaks), the speed test when IPv6 works
  function links(final) {
    const v4 = R.v4, v6 = R.v6, split = !SHOWN && v4 && v6 && v4.ok && v6.ok && v4.asn && v6.asn && v4.asn !== v6.asn;
    $("#whoLink").hidden = !(WHO && final && split);
    $("#speedLink").hidden = !(SPEED && final && v6 && v6.ok && !split);
    // whether your DNS resolvers can work over IPv6 is the DNS test's to find out (its own authoritative servers)
    if (DNS) { $("#dnsLink").href = DNS; $("#dnsLink").hidden = !(final && !SHOWN); }
  }

  /* ---------- numbers ---------- */
  const fmtMs = ms => ms < 10 ? ms.toFixed(1) : String(Math.round(ms));
  const timeOf = ms => ms >= 1000 ? t("r_s", { s: (ms / 1000).toFixed(1) }) : t("r_ms", { ms: fmtMs(ms) });
  // region names as the visitor's language gives them, except Taiwan, written the same in every tool (1ms-shell tool-contract §5)
  const TW = { "zh-CN": "中国台湾", "zh-TW": "中國台灣", en: "Taiwan, China", ja: "中国台湾", ko: "중국 대만", es: "Taiwán, China", fr: "Taïwan, Chine", de: "Taiwan, China", pt: "Taiwan, China", ru: "Тайвань, Китай" };
  const regionName = (cc, lang) => cc === "TW" ? TW[lang] : new Intl.DisplayNames([lang], { type: "region" }).of(cc);
  const country = cc => { try { return regionName(cc, D.lang); } catch (e) { return cc; } };

  /* ---------- the rows and the hero ---------- */
  const ROW = Object.fromEntries($$(".tr[data-t]").map(r => [r.dataset.t, r]));
  let R = {};          // results so far, by test id
  let C = {};          // IPv4 against IPv6 so far, by side id (cf4, cf6, …)
  let SHOWN = false;   // showing a shared result: no addresses
  let MTU = {};        // the 1ms.dog server's view of the path, by family (pathMtu): not in shared results

  // a row: its state (ok, warn, bad, waiting) and its value; v6 tests only warn when there is no IPv6 at all
  function fillRow(id) {
    fillTest(id);
    if (id === "big") fillMtu();
  }
  function fillTest(id) {
    const row = ROW[id], x = R[id], b = row.querySelector(".tv b"), s = row.querySelector(".tv span");
    const noV6 = R.v6 && !R.v6.ok && R.lit6 && !R.lit6.ok;
    let st = "wait", main = "…", sub = "";
    if (x && x.ok) {
      const slow = x.ms > SLOW;
      st = slow ? "warn" : "ok";
      main = (slow ? t("r_slow") + " · " : "") + timeOf(x.rtt != null ? x.rtt : x.ms);
      if (id === "ds") {
        main = (x.fam === 6 ? "IPv6" : "IPv4") + " · " + timeOf(x.rtt != null ? x.rtt : x.ms);
        sub = t("r_picked", { fam: x.fam === 6 ? "IPv6" : "IPv4" });
        if (x.fam === 4 && R.v6 && R.v6.ok) st = "warn";
      } else if (x.host) sub = t("r_from", { host: x.host });
    } else if (x) {
      st = TESTS.find(z => z.id === id).fam === 6 && noV6 ? "warn" : "bad";
      main = t(x.err === "timeout" ? "r_timeout" : "r_fail");
    }
    row.className = "tr " + st;
    b.textContent = main; s.textContent = sub || " ";
  }

  /* ---------- the path, from the 1ms.dog server (server/ in this repo, on the 1ms.dog VPS in Tokyo) ---------- */
  // What the browser can't see: the MSS each family's SYN offered, the path MTU, and whether full-size packets vanish
  // with no Packet Too Big coming back (a PMTU black hole: the TLS handshake to the server never finishes). A family
  // that can't get through is asked about over the other one, by the address the tests above found.
  const API = { 4: "https://v4.ipv6.1ms.dog:8445", 6: "https://v6.ipv6.1ms.dog:8445" }, HE = "https://he.ipv6.1ms.dog:8446";
  function getJSON(url, ms, signal) {
    const c = new AbortController(), stop = () => c.abort(), tm = setTimeout(stop, ms);
    signal.addEventListener("abort", stop);
    return fetch(url, { cache: "no-store", credentials: "omit", signal: c.signal }).then(r => r.ok ? r.json() : null).catch(() => null)
      .finally(() => { clearTimeout(tm); signal.removeEventListener("abort", stop); });
  }
  async function pathMtu(signal) {
    const ip = { 4: R.v4 && R.v4.ok && R.v4.ip, 6: R.v6 && R.v6.ok && R.v6.ip };
    await Promise.all([6, 4].map(async fam => {
      if (!ip[fam]) return;
      let r = await getJSON(API[fam] + "/mss", 7000, signal);
      const o = fam === 6 ? 4 : 6;
      if (!r && ip[o]) r = await getJSON(API[o] + "/seen?ip=" + encodeURIComponent(ip[fam]), 5000, signal);
      if (!signal.aborted && r && r.seen && r.mtu) MTU[fam] = r;
    }));
  }
  // the large-packet row's second line: each family's path MTU; a black hole turns the row red and says so
  function fillMtu() {
    const row = ROW.big, s = row.querySelector(".tv span"), b = row.querySelector(".tv b");
    const fams = [6, 4].filter(f => MTU[f]);
    if (!fams.length) { s.removeAttribute("data-why"); return; }
    const hole = fams.find(f => MTU[f].stalled);
    if (hole) {
      row.className = "tr bad"; b.textContent = t("r_hole");
      s.textContent = t("mtu_hole", { fam: hole, mtu: MTU[hole].mtu });
    } else s.textContent = t("mtu_line", { list: fams.map(f => `IPv${f} ${MTU[f].mtu}` + (MTU[f].ptb ? " " + t("mtu_ptb") : "")).join(" · ") });
    s.dataset.why = t("mtu_why", { list: fams.map(f => `IPv${f} MSS ${MTU[f].mss}`).join(" · ") });
  }

  // How long the browser makes you wait when IPv6 is broken (the slow page): he.ipv6.1ms.dog has both addresses and the
  // server drops every IPv6 SYN to it, so the browser falls back to IPv4; the server times its first IPv6 SYN to its
  // IPv4 one. The token ties the two: its /mss over IPv6 says which /64 the IPv6 SYNs come from.
  const HE_TONE = ms => ms <= 400 ? "t1" : ms <= 1000 ? "warn" : "bad";
  async function heWait(signal) {
    const tok = Array.from(crypto.getRandomValues(new Uint8Array(12)), x => (x % 36).toString(36)).join("");
    $("#heV").textContent = "…"; $("#heV").className = ""; $("#heH").textContent = "";
    const v6 = await getJSON(API[6] + "/mss?t=" + tok, 6000, signal);
    const r = v6 && await getJSON(HE + "/he?t=" + tok, 15000, signal);
    if (signal.aborted) return;
    let k = "he_fail", ms = 0;
    if (!v6) k = ["c_no6", "c_none"].includes(compare(C).key) ? "he_no6" : "he_fail";
    else if (r && r.fam === 4 && r.v6) { k = r.tries ? "he_wait" : "he_direct"; ms = r.wait; }
    $("#heV").textContent = t(k === "he_wait" ? "he_ms" : k, { ms: fmtMs(ms) });
    $("#heV").className = k === "he_wait" ? HE_TONE(ms) : "";
    $("#heH").textContent = k === "he_wait" ? t("he_" + HE_TONE(ms)) : k === "he_direct" ? t("he_direct_h") : "";
  }

  // The address goes up the moment its test answers (its network and country follow when looked up, on the line under
  // it, which keeps its height meanwhile); written again only when it changes, so the same address isn't a new paint
  const ipHTML = ip => `<code>${esc(ip)}</code>`;
  const setHTML = (el, html) => { if (el.innerHTML !== html) el.innerHTML = html; };

  // an address line in the hero: the address, then what kind it is, its network, country and round trip
  function fillAddr(fam) {
    const x = fam === 6 ? R.v6 : R.v4, ip = $("#ip" + fam), m = $("#m" + fam);
    if (SHOWN) {
      // a shared result has no address: what the test said about it instead
      ip.innerHTML = x && x.ok ? `<span class="no">${esc(t("r_ok"))}</span>` : x ? `<span class="no">${esc(t(fam === 6 ? "none6" : "none4"))}</span>` : "";
    } else if (!x) { ip.innerHTML = '<i class="skl"></i>'; m.innerHTML = "&nbsp;"; return; }
    else setHTML(ip, x.ok && x.ip ? ipHTML(x.ip) : `<span class="no">${esc(t(fam === 6 ? "none6" : "none4"))}</span>`);
    const bits = [];
    if (x && x.ok) {
      const k = fam === 6 ? x.kind || kind6(x.ip) : "";
      const tag = k ? `<span class="tag${k === "native" ? "" : " bad"}">${esc(t("k_" + k))}</span>` : "";
      // its network on ASN Lookup: a value made into a link, so a dotted underline and a title, not the external-link mark
      if (x.asn) bits.push(ASN ? `<a class="q0" href="${esc(ASN + "AS" + x.asn)}" title="${esc(t("asn_t"))}" target="_blank" rel="noopener">AS${x.asn}</a>` : "AS" + x.asn);
      if (x.cc) bits.push(esc(country(x.cc)));
      if (x.rtt != null) bits.push(esc(t("m_rtt", { ms: fmtMs(x.rtt) })));
      // how clean the address is, on IP Quality Test
      const q = IPQS && !SHOWN && x.ip ? ` <a class="q" href="${esc(IPQS + "?ip=" + encodeURIComponent(x.ip))}" target="_blank" rel="noopener">${esc(t("ipqs_link"))}${EXT}</a>` : "";
      m.innerHTML = `<span class="m-i">${tag + bits.join(" · ")}</span>` + q;
    } else m.innerHTML = "&nbsp;";
  }

  // The hero: the score and verdict as the tests come in (a test not in yet counts as failed, so the score only rises)
  function hero(final) {
    const v = verdict(R), box = $("#scoreBox");
    box.classList.toggle("wait", !final);
    $("#score").textContent = final || Object.keys(R).length ? v.score : "–";
    box.style.color = `var(--${tierOf(v.score)})`;
    $("#ring").style.opacity = v.score ? 1 : 0;   // a round cap draws a dot at 0
    $("#ring").style.strokeDasharray = `${(v.score / 10 * 2 * Math.PI * 52).toFixed(1)} 400`;   // r = 52 in the SVG
    if (!final) return;
    $("#verdict").textContent = t(v.head);
    $("#verdict").className = "verdict " + tierOf(v.score);
    const p = v.probs.length ? v.probs.map(k => t(k)).join(" ") : t(v.head === "v_none" ? "ok_v4" : v.head === "v_offline" ? "off_hint" : "ok_all");
    $("#probs").textContent = p;
    $("#probs").title = p;
  }

  // IPv4 against IPv6: each network's two round trips with bars on one scale, the difference, and once every side is
  // in, what they say together
  const CROW = Object.fromEntries($$(".cr[data-p]").map(r => [r.dataset.p, r]));
  const DIF = { c_same: "same", c_6fast: "fast", c_6slow: "slow", c_6much: "much" }, HEAD = { c_6fast: "t1", c_6slow: "warn", c_6much: "bad" };
  function fillCmp() {
    // a link shared before the comparison existed has none: no block rather than rows that never fill
    $(".cmp").hidden = SHOWN && !Object.keys(C).length;
    const max = Math.max(1, ...Object.values(C).filter(x => x.ok && x.rtt != null).map(x => x.rtt));
    for (const p of PAIRS) {
      const row = CROW[p.id], a = C[p.id + 4], b = C[p.id + 6];
      row.classList.toggle("wait", !a && !b);
      for (const [fam, x] of [[4, a], [6, b]]) {
        const cell = row.querySelector(`.cv[data-f="${fam}"]`), ok = x && x.ok && x.rtt != null;
        cell.classList.toggle("bad", !!x && !ok);
        cell.querySelector("b").textContent = !x ? "…" : ok ? timeOf(x.rtt) : "—";
        cell.title = x && !ok ? t(x.err === "timeout" ? "r_timeout" : "r_fail") : "";
        cell.querySelector(".cb i").style.transform = `scaleX(${ok ? Math.max(.02, x.rtt / max) : 0})`;
      }
      const d = row.querySelector(".cd"), both = a && b && a.ok && b.ok && a.rtt != null && b.rtt != null;
      const one = both && compare({ [p.id + 4]: a, [p.id + 6]: b }), diff = both ? b.rtt - a.rtt : 0;
      d.className = "cd" + (both ? " " + DIF[one.key] : "");
      d.querySelector("b").textContent = !a || !b ? "…" : !both ? "—" : (diff > 0 ? "+" : diff < 0 ? "−" : "±") + timeOf(Math.abs(diff));
    }
    // what they say together: under the table on the home page, as the hero's verdict on the slow page
    const all = SIDES.every(x => C[x.id]), c = compare(C), head = $(ONLY ? "#verdict" : "#cmpHead");
    head.textContent = all ? t(c.key, { ms: c.n ? fmtMs(Math.abs(c.diff)) : "" }) : t("c_wait");
    head.className = (ONLY ? "verdict " + (all ? TONE[c.key] : "") : all ? HEAD[c.key] || "" : "").trim();
    $(ONLY ? "#probs" : "#cmpHint").textContent = all ? t("ch_" + c.key.slice(2)) : " ";
  }
  // the slow page's verdict colours (the hero's tiers)
  const TONE = { c_same: "t1", c_6fast: "t1", c_6slow: "warn", c_6much: "bad", c_no6: "warn", c_none: "bad" };

  let total = ONLY ? SIDES.length : TESTS.length + SIDES.length, done = 0, t0 = 0;
  function progress() {
    $("#prog i").style.transform = `scaleX(${done / total})`;
    $("#progTxt").textContent = t("progress", { n: done, of: total });
    post({ type: "progress", done, total, text: $("#progTxt").textContent });
  }

  // where the visitor is (Cloudflare's own trace on this site), for the share card when they tick "show my country"
  let CC = "";

  // Who this connection is, from the shell (1ms-shell /_ms/me: what Cloudflare knows of it, asked of no one else): the
  // network and country of whichever address the page came over, so Radar is asked only for the other one. null on a
  // copy without the shell (a 404) or when it fails.
  const me = () => fetch("/_ms/me", { cache: "no-store", credentials: "omit" }).then(r => r.ok ? r.json() : null).catch(() => null);

  // Inside the checkup, every outside host failing means the test couldn't run (an ad blocker stops them all at once, or
  // a firewall): it says so as soon as the last one fails, and sends no result after. This site's own trace doesn't count.
  const OUTSIDE = [...TESTS.filter(x => x.id !== "ds"), ...SIDES].map(x => x.id);
  let FAILED = false;
  function blocked() {
    if (!CHECK || FAILED || !OUTSIDE.every(id => { const x = R[id] || C[id]; return x && !x.ok; })) return;
    FAILED = true;
    post({ type: "error", text: t("e_blocked") });
  }

  /* ---------- the test ---------- */
  let RUN = null, LAST = null, RECV = null;
  async function start() {
    // a shared result gives way to the visitor's own test, on the language's page; this tool has no compare mode,
    // so the banner goes with it rather than sit above a result that is now the visitor's own
    if (RECV) { RECV.then(r => r && r.remove()); RECV = null; history.replaceState(null, "", D.paths[D.lang]); }
    if (RUN) RUN.abort();
    const ctl = RUN = new AbortController();
    R = {}; C = {}; MTU = {}; SHOWN = false; LAST = null; FAILED = false; done = 0; t0 = performance.now();
    if (ONLY) $("#he").hidden = !!CHECK;
    const ME = ONLY ? null : me();
    $("#shareBtn").hidden = true; $("#rerun").disabled = true; $("#prog").classList.remove("end");
    $("#verdict").textContent = t("v_wait"); $("#verdict").className = "verdict"; $("#probs").innerHTML = "&nbsp;";
    if (!ONLY) { IDS.forEach(fillRow); fillAddr(6); fillAddr(4); links(false); hero(false); }
    fillCmp(); progress();
    // each network's two sides at the same moment, so they meet the same conditions
    const sides = SIDES.map(async side => {
      const x = await runTest(side, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      C[side.id] = x;
      if (ONLY && !CC && x.ok && x.cc) CC = x.cc;   // the slow page has no other test to say where the visitor is
      done++; progress(); fillCmp(); blocked();
    });
    await Promise.all([...sides, ...(ONLY ? [] : TESTS).map(async test => {
      const x = await runTest(test, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      if ((test.id === "v4" || test.id === "v6") && x.ok && x.ip) setHTML($("#ip" + test.fam), ipHTML(x.ip));
      if ((test.id === "v4" || test.id === "v6") && x.ok && !x.asn) {
        const m = await ME;
        const n = m && m.asn && sameIp(m.ip, x.ip) ? { asn: m.asn, cc: m.country || "" } : await network(test.fam, x.ip, ctl.signal);
        if (ctl.signal.aborted) return;
        if (n) { x.asn = n.asn; x.cc = x.cc || n.cc; }
      }
      R[test.id] = x;
      if (test.id === "ds" && x.ok && x.cc) CC = x.cc;
      if (!CC && x.ok && x.cc) CC = x.cc;
      done++; progress(); blocked();
      IDS.forEach(fillRow);
      if (test.id === "v4" || test.id === "v6") { fillAddr(test.fam); }
      hero(false);
    })]);
    if (ctl.signal.aborted) return;
    if (!ONLY) { hero(true); links(true); }
    // the 1ms.dog server's view, once the tests are in (it needs their addresses, and has the line to itself); the
    // Happy Eyeballs wait not inside the checkup, the path MTU there too (its facts carry it)
    if (ONLY) { if (!CHECK) await heWait(ctl.signal); }
    else {
      await pathMtu(ctl.signal);
      if (ctl.signal.aborted) return;
      // an IPv6 black hole is the large-packet test failing, seen from the other side: it counts as that in the score
      // (and its hint is p_mtu's); one on IPv4 is outside this test's score, so only said
      if (MTU[6] && MTU[6].stalled && R.big && R.big.ok) { R.big = { ok: false, err: "fail" }; hero(true); }
      fillRow("big");
      const p = $("#probs");
      if (MTU[4] && MTU[4].stalled) { p.textContent = (verdict(R).probs.length ? p.textContent + " " : "") + t("p_hole", { fam: 4 }); p.title = p.textContent; }
    }
    if (ctl.signal.aborted) return;
    RUN = null;
    $("#prog").classList.add("end");
    $("#progTxt").textContent = t("done", { s: ((performance.now() - t0) / 1000).toFixed(1) });
    $("#rerun").disabled = false;
    LAST = { ts: Date.now(), cc: CC, r: { ...R, ...C } };
    $("#shareBtn").hidden = false;
    if (CHECK && !FAILED && !ONLY) post(checkupResult(LAST));
  }

  // The result for the checkup's report: the hero's verdict, a few numbers, the problems worst first, and the facts its
  // cross-tool rules read. The score on its 0 to 100 scale; no grade, this test has none. The link leaves out the country,
  // as the share dialog does until the visitor ticks it.
  const FBAD = new Set(["p_nodns", "p_mtu"]), FORDER = { bad: 0, warn: 1, ok: 2 };
  function checkupResult(S) {
    const v = verdict(R), c = compare(C), ok = id => !!(R[id] && R[id].ok);
    const has6 = ok("v6") || ok("lit6"), k = ok("v6") ? R.v6.kind || kind6(R.v6.ip) : null;
    const stats = [
      { label: "IPv6", value: k ? t("k_" + k) : t(has6 ? "r_ok" : "none6") },
      { label: t("t_ds"), value: ok("ds") ? "IPv" + R.ds.fam : t(R.ds && R.ds.err === "timeout" ? "r_timeout" : "r_fail") },
      c.n && { label: "IPv6 − IPv4", value: (c.diff > 0 ? "+" : c.diff < 0 ? "−" : "±") + timeOf(Math.abs(c.diff)) },
      { label: t("h_tests"), value: `${IDS.filter(ok).length} / ${IDS.length}` },
    ].filter(Boolean);
    const findings = v.probs.map(p => ({ level: FBAD.has(p) ? "bad" : "warn", text: t(p) }));
    if (c.key === "c_6much" || c.key === "c_6slow") findings.push({ level: c.key === "c_6much" ? "bad" : "warn", text: t(c.key, { ms: fmtMs(Math.abs(c.diff)) }) });
    if (v.head === "v_offline") findings.push({ level: "bad", text: t("off_hint") });
    else if (v.head === "v_none") findings.push({ level: "warn", text: t("ok_v4") });
    else if (!findings.length) findings.push({ level: "ok", text: t("ok_all") });
    findings.sort((a, b) => FORDER[a.level] - FORDER[b.level]);
    // slower: IPv6 noticeably behind IPv4 in the comparison, or holding pages up (dual-stack sites wait for it, it answers late)
    const facts = { score: v.score * 10, v6: has6 };
    // the 1ms.dog server's path MTU (1ms-shell docs/checkup.md): the largest packet each family carries, and whether
    // either has a black hole; a key left out when it wasn't measured
    const fits = f => MTU[f] && !MTU[f].stalled && MTU[f].mtu >= 1280 && MTU[f].mtu <= 1500 ? MTU[f].mtu : 0;
    if (fits(4)) facts.mtu = fits(4);
    if (fits(6)) facts.mtu6 = fits(6);
    if (MTU[4] || MTU[6]) facts.blackhole = !!((MTU[4] && MTU[4].stalled) || (MTU[6] && MTU[6].stalled));
    if (has6) {
      facts.native = k ? k === "native" : null;
      facts.slower = c.key === "c_6much" || v.probs.includes("p_slowds") || v.probs.includes("p_slow6");
    }
    return { type: "result", lang: D.lang, path: D.home + "r/" + encodeShare({ ...S, cc: "" }), grade: null, score: v.score * 10,
      headline: t(v.head), stats, findings: findings.slice(0, 4), facts };
  }

  /* ---------- a shared result ---------- */
  // Opening /r/<code> shows that result as the test would have drawn it, and doesn't test until the visitor asks
  function showShared(S) {
    R = Object.fromEntries(IDS.filter(id => id in S.r).map(id => [id, S.r[id]]));
    C = Object.fromEntries(SIDES.filter(x => x.id in S.r).map(x => [x.id, S.r[x.id]]));
    SHOWN = true;
    if (!ONLY) { IDS.forEach(fillRow); fillAddr(6); fillAddr(4); hero(true); links(true); }
    else $("#he").hidden = true;   // not part of a shared result
    fillCmp();
    // the shared banner (1ms-shell assets/share/): whose result this is, and the visitor's own test
    RECV = import("/assets/share/share.js?v=8").then(m => m.received({ lang: D.lang, ts: S.ts, at: $(".hero"), test: start })).catch(() => null);
    $("#prog").classList.add("end"); $("#progTxt").innerHTML = "&nbsp;";
    $("#rerun").disabled = false;
    LAST = S; $("#shareBtn").hidden = false;
  }

  /* ---------- share: the 1ms.dog share dialog (1ms-shell assets/share/, copied verbatim to /assets/share/) ---------- */
  $("#shareBtn").onclick = async () => {
    if (!LAST) return;
    const { share } = await import("/assets/share/share.js?v=8");
    if (ONLY) {
      // the slow page's result: IPv4 against IPv6 alone, its link on this page
      const S = { ...LAST, r: Object.fromEntries(SIDES.filter(z => z.id in LAST.r).map(z => [z.id, LAST.r[z.id]])) };
      const c = compare(S.r), said = t(c.key, { ms: c.n ? fmtMs(Math.abs(c.diff)) : "" }), here = location.origin + D.paths[D.lang];
      share({
        lang: D.lang, name: t("app_name"), file: "ipv6-slow",
        show: ["country"], never: ["ip"], canShow: !!S.cc,
        link: show => here + "r/" + encodeShare({ ...S, cc: show ? S.cc : "" }),
        home: here,
        text: () => t("slow_share_text", { verdict: said }),
        height: (x, kit) => slowLayout(x, kit, said).height, draw: (x, kit) => drawSlow(x, kit, S, c, said),
        foot: show => [show && S.cc && country(S.cc)],
        ts: S.ts,
      }).open();
      return;
    }
    const S = LAST, res = verdict(S.r);
    share({
      lang: D.lang, name: t("app_name"), file: "ipv6-test",
      show: ["country"], never: ["ip"], canShow: !!S.cc,
      link: show => location.origin + D.home + "r/" + encodeShare({ ...S, cc: show ? S.cc : "" }),
      home: location.origin + D.home,
      text: () => t("share_text", { s: res.score }),
      height: (x, kit) => 680 + cardLayout(x, kit, S, res).grow, draw: (x, kit) => drawCard(x, kit, S, res),
      foot: show => [t("card_sub"), show && S.cc && country(S.cc)],
      ts: S.ts,
    }).open();
  };

  // Where the card's words go, so nothing is cut to "…" (1ms-shell tool-contract, "Share card"): the verdict at the
  // largest size from 44px down to 34px that holds it, else on two lines; the IPv4-against-IPv6 sentence beside its
  // label when it fits there, else on its own lines under it. grow: how much taller than 680 that makes the card.
  function cardLayout(x, kit, S, res) {
    const { W, P, F, fit, wrap } = kit, tx = P + 260, tw = W - P - tx;
    const size = fit(x, t(res.head), tw, 44, 34, 750);
    const head = x.measureText(t(res.head)).width <= tw ? [t(res.head)] : wrap(x, t(res.head), tw, 2);
    const lh = Math.round(size * 1.2), down = (head.length - 1) * lh;
    let cmp = null;
    if (SIDES.some(z => z.id in S.r)) {
      const c = compare(S.r), text = t(c.key, { ms: c.n ? fmtMs(Math.abs(c.diff)) : "" });
      x.font = `600 23px ${F}`; const lw = x.measureText(t("h_cmp")).width + 16;
      x.font = `650 23px ${F}`;
      cmp = { c, lw, lines: x.measureText(text).width <= tw - lw ? [text] : wrap(x, text, tw, 2) };
      cmp.under = cmp.lines.length > 1 || x.measureText(text).width > tw - lw;
    }
    return { tx, tw, size, head, lh, down, cmp, grow: down + (cmp && cmp.under ? cmp.lines.length * 32 : 0) };
  }

  // The middle of the card: the score in its ring, the verdict, every test with its mark; never an address
  function drawCard(x, kit, S, res) {
    const { F, M, v, clip } = kit;
    const L = cardLayout(x, kit, S, res), { tx, tw, down } = L;
    const C = { fg: v("fg"), muted: v("muted"), soft: v("soft"), bad: v("bad"), warn: v("warn"), t1: v("t1"), t2: v("t2"), t3: v("t3"), t4: v("t4"), t5: v("t5") };
    const col = C[tierOf(res.score)];
    x.textBaseline = "alphabetic";
    // the score in its ring, and the verdict beside it
    const cx = kit.P + 110, cy = 376 + down / 2, rr = 96;
    x.lineWidth = 16; x.lineCap = "round";
    x.strokeStyle = C.soft; x.beginPath(); x.arc(cx, cy, rr, 0, Math.PI * 2); x.stroke();
    if (res.score) { x.strokeStyle = col; x.beginPath(); x.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * res.score / 10); x.stroke(); }
    x.textAlign = "center";
    x.fillStyle = col; x.font = `700 80px ${M}`; x.fillText(String(res.score), cx, cy + 18);
    x.fillStyle = C.muted; x.font = `500 24px ${M}`; x.fillText("/ 10", cx, cy + 54);
    x.textAlign = "left";
    x.fillStyle = C.muted; x.font = `600 24px ${F}`; x.fillText(t("score_k"), tx, kit.top + 100);
    x.fillStyle = C.fg; x.font = `750 ${L.size}px ${F}`;
    L.head.forEach((line, i) => x.fillText(line, tx, kit.top + 156 + i * L.lh));
    // the tests in two columns, each with its mark
    TESTS.forEach((test, i) => {
      const r = S.r[test.id], col2 = i % 2, row = Math.floor(i / 2), ax = tx + col2 * (tw / 2), ay = kit.top + 208 + down + row * 44;
      const ok = r && r.ok, warn = ok && (r.ms > SLOW || (test.id === "ds" && r.fam === 4 && S.r.v6 && S.r.v6.ok));
      x.fillStyle = ok ? (warn ? C.warn : C.t1) : C.bad;
      x.font = `700 23px ${F}`; x.fillText(ok ? (warn ? "!" : "✓") : "✕", ax, ay);
      x.fillStyle = C.fg; x.font = `500 23px ${F}`;
      x.fillText(clip(x, t("t_" + test.id) + (test.id === "ds" && ok ? " · IPv" + r.fam : ""), tw / 2 - 44), ax + 32, ay);
    });
    // IPv4 against IPv6, when the result has it (links from before it don't)
    if (L.cmp) {
      const { c, lw, lines, under } = L.cmp, cy2 = kit.top + 352 + down;
      x.fillStyle = C.muted; x.font = `600 23px ${F}`; x.fillText(t("h_cmp"), tx, cy2);
      x.fillStyle = c.key === "c_6much" ? C.bad : c.key === "c_6slow" ? C.warn : c.key === "c_6fast" ? C.t1 : C.fg;
      x.font = `650 23px ${F}`;
      lines.forEach((line, i) => under ? x.fillText(line, tx, cy2 + 32 * (i + 1)) : x.fillText(line, tx + lw, cy2));
    }
  }

  // The slow page's card: the question, what the comparison found (44px down to 34px, two lines if need be), then each
  // network's two round trips and the difference, as on the page. height: the card's, from the verdict's lines.
  function slowLayout(x, kit, said) {
    const { W, P, top, fit, wrap } = kit, w = W - P * 2;
    const size = fit(x, said, w, 44, 34, 750);
    const lines = x.measureText(said).width <= w ? [said] : wrap(x, said, w, 2), lh = Math.round(size * 1.2);
    const y = top + 150 + (lines.length - 1) * lh + 76;   // the table's header line
    return { w, size, lines, lh, y, height: y + PAIRS.length * 52 + 104 };
  }
  function drawSlow(x, kit, S, c, said) {
    const { P, F, M, v } = kit, L = slowLayout(x, kit, said);
    const col = { t1: v("t1"), warn: v("warn"), bad: v("bad") }, fg = v("fg"), muted = v("muted");
    x.textBaseline = "alphabetic"; x.textAlign = "left";
    x.fillStyle = muted; x.font = `600 24px ${F}`; x.fillText(t("h_cmp"), P, kit.top + 90);
    x.fillStyle = col[TONE[c.key]] || fg; x.font = `750 ${L.size}px ${F}`;
    L.lines.forEach((line, i) => x.fillText(line, P, kit.top + 150 + i * L.lh));
    // the table: network, IPv4, IPv6, difference (right-aligned numbers)
    const cols = [P + 430, P + 680, P + L.w];
    x.fillStyle = muted; x.font = `600 22px ${F}`; x.fillText(t("c_net"), P, L.y);
    x.textAlign = "right"; ["IPv4", "IPv6", t("c_dif")].forEach((h, i) => x.fillText(h, cols[i], L.y));
    PAIRS.forEach((p, i) => {
      const a = S.r[p.id + 4], b = S.r[p.id + 6], y = L.y + 52 * (i + 1);
      const okA = a && a.ok && a.rtt != null, okB = b && b.ok && b.rtt != null;
      x.textAlign = "left"; x.fillStyle = fg; x.font = `600 26px ${F}`; x.fillText(p.name, P, y);
      x.textAlign = "right"; x.font = `500 26px ${M}`;
      x.fillStyle = okA ? fg : muted; x.fillText(!a ? "…" : okA ? timeOf(a.rtt) : "—", cols[0], y);
      x.fillStyle = okB ? fg : muted; x.fillText(!b ? "…" : okB ? timeOf(b.rtt) : "—", cols[1], y);
      if (okA && okB) {
        const d = b.rtt - a.rtt, k = compare({ [p.id + 4]: a, [p.id + 6]: b }).key;
        x.fillStyle = col[TONE[k]] && k !== "c_same" ? col[TONE[k]] : fg;
        x.fillText((d > 0 ? "+" : d < 0 ? "−" : "±") + timeOf(Math.abs(d)), cols[2], y);
      } else { x.fillStyle = muted; x.fillText("—", cols[2], y); }
    });
    x.textAlign = "left";
  }

  $("#rerun").onclick = start;
  const SP = sharePath(location.pathname), SHARED = SP && decodeShare(SP.code, new Set([...IDS, ...SIDES.map(x => x.id)]));
  // the checkup sizes its frame to the page
  if (CHECK && window.ResizeObserver) {
    let h = 0;
    new ResizeObserver(() => { const n = Math.ceil($(".app").getBoundingClientRect().height); if (n !== h) post({ type: "size", height: h = n }); }).observe($(".app"));
  }
  if (SHARED && !CHECK) showShared(SHARED); else start();
})();

// IPv6 Test page. Every test's row is in the HTML from the start; the tests (src/probe.mjs) run at once and fill
// their rows as they answer, and the hero follows: the score and the verdict so far, the two addresses as soon as
// they are known. IPv4 against IPv6 runs alongside, one row per network. Strings: window.L1MS.
import { TESTS, IDS, SIDES, PAIRS, SLOW, runTest, network, sameIp, verdict, compare, kind6, tierOf } from "./probe.mjs";
import { encode as encodeShare, decode as decodeShare, sharePath } from "./share.mjs";

(function () {
  "use strict";
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const D = JSON.parse($("#data").textContent);
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
  const IPQS = tool("ipqs"), EGRESS = tool("egress"), ASN = tool("asn"), WHO = tool("who"), SPEED = tool("speed"), FULL = tool("check");
  // the Connection Checkup runs this test among the others; not inside its own report
  if (FULL && !CHECK) { $("#checkLink").href = FULL; $("#checkLink").hidden = false; }
  if (EGRESS) { $("#egressLink").href = EGRESS; $("#egressLink").hidden = false; }
  if (WHO) $("#whoLink").href = WHO;
  if (SPEED) $("#speedLink").href = SPEED;
  // Under the addresses, once the test is over: Who Are You when IPv4 and IPv6 leave from different networks (often a
  // proxy or VPN that carries only one of them, so the other leaks), the speed test when IPv6 works
  function links(final) {
    const v4 = R.v4, v6 = R.v6, split = !SHOWN && v4 && v6 && v4.ok && v6.ok && v4.asn && v6.asn && v4.asn !== v6.asn;
    $("#whoLink").hidden = !(WHO && final && split);
    $("#speedLink").hidden = !(SPEED && final && v6 && v6.ok && !split);
  }

  /* ---------- numbers ---------- */
  const fmtMs = ms => ms < 10 ? ms.toFixed(1) : String(Math.round(ms));
  const timeOf = ms => ms >= 1000 ? t("r_s", { s: (ms / 1000).toFixed(1) }) : t("r_ms", { ms: fmtMs(ms) });
  const country = cc => { try { return new Intl.DisplayNames([D.lang], { type: "region" }).of(cc); } catch (e) { return cc; } };

  /* ---------- the rows and the hero ---------- */
  const ROW = Object.fromEntries($$(".tr[data-t]").map(r => [r.dataset.t, r]));
  let R = {};          // results so far, by test id
  let C = {};          // IPv4 against IPv6 so far, by side id (cf4, cf6, …)
  let SHOWN = false;   // showing a shared result: no addresses

  // a row: its state (ok, warn, bad, waiting) and its value; v6 tests only warn when there is no IPv6 at all
  function fillRow(id) {
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

  // an address line in the hero: the address, then what kind it is, its network, country and round trip
  function fillAddr(fam) {
    const x = fam === 6 ? R.v6 : R.v4, ip = $("#ip" + fam), m = $("#m" + fam);
    if (SHOWN) {
      // a shared result has no address: what the test said about it instead
      ip.innerHTML = x && x.ok ? `<span class="no">${esc(t("r_ok"))}</span>` : x ? `<span class="no">${esc(t(fam === 6 ? "none6" : "none4"))}</span>` : "";
    } else if (!x) { ip.innerHTML = '<i class="skl"></i>'; m.innerHTML = "&nbsp;"; return; }
    else ip.innerHTML = x.ok && x.ip ? `<code>${esc(x.ip)}</code>` : `<span class="no">${esc(t(fam === 6 ? "none6" : "none4"))}</span>`;
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
    const all = SIDES.every(x => C[x.id]), c = compare(C), head = $("#cmpHead");
    head.textContent = all ? t(c.key, { ms: c.n ? fmtMs(Math.abs(c.diff)) : "" }) : t("c_wait");
    head.className = all ? HEAD[c.key] || "" : "";
    $("#cmpHint").textContent = all ? t("ch_" + c.key.slice(2)) : " ";
  }

  let total = TESTS.length + SIDES.length, done = 0, t0 = 0;
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
    R = {}; C = {}; SHOWN = false; LAST = null; FAILED = false; done = 0; t0 = performance.now();
    const ME = me();
    $("#shareBtn").hidden = true; $("#rerun").disabled = true; $("#prog").classList.remove("end");
    $("#verdict").textContent = t("v_wait"); $("#verdict").className = "verdict"; $("#probs").innerHTML = "&nbsp;";
    IDS.forEach(fillRow); fillAddr(6); fillAddr(4); links(false); hero(false); fillCmp(); progress();
    // each network's two sides at the same moment, so they meet the same conditions
    const sides = SIDES.map(async side => {
      const x = await runTest(side, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      C[side.id] = x;
      done++; progress(); fillCmp(); blocked();
    });
    await Promise.all([...sides, ...TESTS.map(async test => {
      const x = await runTest(test, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
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
    RUN = null;
    hero(true); links(true);
    $("#prog").classList.add("end");
    $("#progTxt").textContent = t("done", { s: ((performance.now() - t0) / 1000).toFixed(1) });
    $("#rerun").disabled = false;
    LAST = { ts: Date.now(), cc: CC, r: { ...R, ...C } };
    $("#shareBtn").hidden = false;
    if (CHECK && !FAILED) post(checkupResult(LAST));
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
    IDS.forEach(fillRow); fillAddr(6); fillAddr(4); hero(true); links(true); fillCmp();
    // the shared banner (1ms-shell assets/share/): whose result this is, and the visitor's own test
    RECV = import("/assets/share/share.js?v=4").then(m => m.received({ lang: D.lang, ts: S.ts, at: $(".hero"), test: start })).catch(() => null);
    $("#prog").classList.add("end"); $("#progTxt").innerHTML = "&nbsp;";
    $("#rerun").disabled = false;
    LAST = S; $("#shareBtn").hidden = false;
  }

  /* ---------- share: the 1ms.dog share dialog (1ms-shell assets/share/, copied verbatim to /assets/share/) ---------- */
  $("#shareBtn").onclick = async () => {
    if (!LAST) return;
    const S = LAST, res = verdict(S.r);
    const { share } = await import("/assets/share/share.js?v=4");
    share({
      lang: D.lang, name: t("app_name"), file: "ipv6-test",
      show: ["country"], never: ["ip"], canShow: !!S.cc,
      link: show => location.origin + D.home + "r/" + encodeShare({ ...S, cc: show ? S.cc : "" }),
      home: location.origin + D.home,
      text: () => t("share_text", { s: res.score }),
      height: 680, draw: (x, kit) => drawCard(x, kit, S, res),
      foot: show => [t("card_sub"), show && S.cc && country(S.cc)],
      ts: S.ts,
    }).open();
  };

  // The middle of the card: the score in its ring, the verdict, every test with its mark; never an address
  function drawCard(x, kit, S, res) {
    const { W, P, F, M, v, clip } = kit;
    const C = { fg: v("fg"), muted: v("muted"), soft: v("soft"), bad: v("bad"), warn: v("warn"), t1: v("t1"), t2: v("t2"), t3: v("t3"), t4: v("t4"), t5: v("t5") };
    const col = C[tierOf(res.score)];
    x.textBaseline = "alphabetic";
    // the score in its ring, and the verdict beside it
    const cx = P + 110, cy = 376, rr = 96;
    x.lineWidth = 16; x.lineCap = "round";
    x.strokeStyle = C.soft; x.beginPath(); x.arc(cx, cy, rr, 0, Math.PI * 2); x.stroke();
    if (res.score) { x.strokeStyle = col; x.beginPath(); x.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * res.score / 10); x.stroke(); }
    x.textAlign = "center";
    x.fillStyle = col; x.font = `700 80px ${M}`; x.fillText(String(res.score), cx, cy + 18);
    x.fillStyle = C.muted; x.font = `500 24px ${M}`; x.fillText("/ 10", cx, cy + 54);
    x.textAlign = "left";
    const tx = P + 260, tw = W - P - tx;
    x.fillStyle = C.muted; x.font = `600 24px ${F}`; x.fillText(t("score_k"), tx, kit.top + 100);
    x.fillStyle = C.fg; x.font = `750 44px ${F}`; x.fillText(clip(x, t(res.head), tw), tx, kit.top + 156);
    // the tests in two columns, each with its mark
    TESTS.forEach((test, i) => {
      const r = S.r[test.id], col2 = i % 2, row = Math.floor(i / 2), ax = tx + col2 * (tw / 2), ay = kit.top + 208 + row * 44;
      const ok = r && r.ok, warn = ok && (r.ms > SLOW || (test.id === "ds" && r.fam === 4 && S.r.v6 && S.r.v6.ok));
      x.fillStyle = ok ? (warn ? C.warn : C.t1) : C.bad;
      x.font = `700 23px ${F}`; x.fillText(ok ? (warn ? "!" : "✓") : "✕", ax, ay);
      x.fillStyle = C.fg; x.font = `500 23px ${F}`;
      x.fillText(clip(x, t("t_" + test.id) + (test.id === "ds" && ok ? " · IPv" + r.fam : ""), tw / 2 - 44), ax + 32, ay);
    });
    // IPv4 against IPv6, when the result has it (links from before it don't)
    const c = compare(S.r);
    if (SIDES.some(z => z.id in S.r)) {
      const cy2 = kit.top + 352;
      x.fillStyle = C.muted; x.font = `600 23px ${F}`; x.fillText(t("h_cmp"), tx, cy2);
      const lw = x.measureText(t("h_cmp")).width + 16;
      x.fillStyle = c.key === "c_6much" ? C.bad : c.key === "c_6slow" ? C.warn : c.key === "c_6fast" ? C.t1 : C.fg;
      x.font = `650 23px ${F}`; x.fillText(clip(x, t(c.key, { ms: c.n ? fmtMs(Math.abs(c.diff)) : "" }), tw - lw), tx + lw, cy2);
    }
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

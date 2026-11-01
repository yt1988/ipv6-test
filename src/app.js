// IPv6 Test page. Every test's row is in the HTML from the start; the tests (src/probe.mjs) run at once and fill
// their rows as they answer, and the hero follows: the score and the verdict so far, the two addresses as soon as
// they are known. Strings: window.L1MS.
import { TESTS, IDS, SLOW, runTest, network, verdict, kind6, tierOf } from "./probe.mjs";
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
  const tool = n => { const m = document.querySelector(`meta[name="${n}"]`); return m ? m.content.replace(/\/+$/, "") + D.home : null; };
  const IPQS = tool("ipqs"), EGRESS = tool("egress"), ASN = tool("asn"), WHO = tool("who"), SPEED = tool("speed");
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
      // its network on ASN Lookup
      if (x.asn) bits.push(ASN ? `<a class="q0" href="${esc(ASN + "AS" + x.asn)}" target="_blank" rel="noopener">AS${x.asn}</a>` : "AS" + x.asn);
      if (x.cc) bits.push(esc(country(x.cc)));
      if (x.rtt != null) bits.push(esc(t("m_rtt", { ms: fmtMs(x.rtt) })));
      // how clean the address is, on IP Quality Test
      const q = IPQS && !SHOWN && x.ip ? ` <a class="q" href="${esc(IPQS + "?ip=" + encodeURIComponent(x.ip))}" target="_blank" rel="noopener">${esc(t("ipqs_link"))} ↗</a>` : "";
      m.innerHTML = (tag + bits.join(" · ") + q) || "&nbsp;";
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

  let total = TESTS.length, done = 0, t0 = 0;
  function progress() {
    $("#prog i").style.transform = `scaleX(${done / total})`;
    $("#progTxt").textContent = t("progress", { n: done, of: total });
  }

  // where the visitor is (Cloudflare's own trace on this site), for the share card when they tick "show my country"
  let CC = "";

  /* ---------- the test ---------- */
  let RUN = null, LAST = null;
  async function start() {
    // a shared result gives way to the visitor's own test, on the language's page
    if (!$("#shared").hidden) { $("#shared").hidden = true; history.replaceState(null, "", D.paths[D.lang]); }
    if (RUN) RUN.abort();
    const ctl = RUN = new AbortController();
    R = {}; SHOWN = false; LAST = null; done = 0; t0 = performance.now();
    $("#shareBtn").disabled = true; $("#rerun").disabled = true; $("#prog").classList.remove("end");
    $("#verdict").textContent = t("v_wait"); $("#verdict").className = "verdict"; $("#probs").innerHTML = "&nbsp;";
    IDS.forEach(fillRow); fillAddr(6); fillAddr(4); links(false); hero(false); progress();
    await Promise.all(TESTS.map(async test => {
      const x = await runTest(test, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      if ((test.id === "v4" || test.id === "v6") && x.ok && !x.asn) {
        const n = await network(test.fam, x.ip, ctl.signal);
        if (ctl.signal.aborted) return;
        if (n) { x.asn = n.asn; x.cc = x.cc || n.cc; }
      }
      R[test.id] = x;
      if (test.id === "ds" && x.ok && x.cc) CC = x.cc;
      if (!CC && x.ok && x.cc) CC = x.cc;
      done++; progress();
      IDS.forEach(fillRow);
      if (test.id === "v4" || test.id === "v6") { fillAddr(test.fam); }
      hero(false);
    }));
    if (ctl.signal.aborted) return;
    RUN = null;
    hero(true); links(true);
    $("#prog").classList.add("end");
    $("#progTxt").textContent = t("done", { s: ((performance.now() - t0) / 1000).toFixed(1) });
    $("#rerun").disabled = false;
    LAST = { ts: Date.now(), cc: CC, r: R };
    $("#shareBtn").disabled = false;
  }

  /* ---------- a shared result ---------- */
  // Opening /r/<code> shows that result as the test would have drawn it, and doesn't test until the visitor asks
  function showShared(S) {
    R = S.r; SHOWN = true;
    IDS.forEach(fillRow); fillAddr(6); fillAddr(4); hero(true); links(true);
    $("#sharedTxt").textContent = t("shared_on", { where: S.cc ? t("shared_where", { where: country(S.cc) }) : "", date: new Date(S.ts).toLocaleString(D.lang, { dateStyle: "medium", timeStyle: "short" }) });
    $("#shared").hidden = false;
    $("#prog").classList.add("end"); $("#progTxt").innerHTML = "&nbsp;";
    $("#rerun").disabled = false;
    LAST = S; $("#shareBtn").disabled = false;
  }

  /* ---------- share: a link that carries the result, an image drawn here, the system share sheet ---------- */
  const shareLink = () => location.origin + D.home + "r/" + encodeShare({ ...LAST, cc: $("#shareCc").checked ? LAST.cc : "" });
  let shortFor = null;
  async function shortLink(long) {
    const meta = document.querySelector('meta[name="shortener"]');          // present on 1ms.dog; absent when self-hosted
    if (!meta) return long;
    if (shortFor && shortFor[0] === long) return shortFor[1];
    try {
      const r = await fetch(meta.content, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: long }), signal: AbortSignal.timeout(5000) });
      const j = await r.json(); if (j.url) { shortFor = [long, j.url]; return j.url; }
    } catch (e) {}
    return long;
  }
  let shareBlob = null, shareRun = 0;
  async function prepareShare() {
    const run = ++shareRun, long = shareLink();
    $("#shareUrl").value = long; $("#shareImg").removeAttribute("src"); shareBlob = null;
    loadQR().catch(() => {});
    const url = await shortLink(long);
    if (run !== shareRun) return;
    $("#shareUrl").value = url;
    // the QR code carries the short link; a long one would be too dense to scan, so then it points at the page
    const c = await drawCard(url.length <= 300 ? url : location.origin + D.home).catch(() => null);
    if (!c || run !== shareRun) return;
    $("#shareImg").src = c.toDataURL("image/png"); c.toBlob(b => { shareBlob = b; }, "image/png");
  }
  $("#shareBtn").onclick = () => {
    if (!LAST) return;
    $("#shareCc").disabled = !LAST.cc;
    if (!LAST.cc) $("#shareCc").checked = false;
    $("#nativeShare").hidden = !navigator.share;
    openDlg("shareDlg");
    prepareShare();
  };
  $("#shareCc").onchange = prepareShare;
  let qrP = null;
  const loadQR = () => qrP ||= new Promise((res, rej) => {
    const el = document.createElement("script"); el.src = QR_JS;
    el.onload = () => res(self.QR1MS); el.onerror = () => { qrP = null; rej(); };
    document.head.appendChild(el);
  });
  const flash = (btn, k) => { const o = btn.textContent; btn.textContent = t(k); setTimeout(() => { btn.textContent = o; }, 1500); };
  $("#copyLink").onclick = async e => { try { await navigator.clipboard.writeText($("#shareUrl").value); flash(e.target, "copied"); } catch (x) { $("#shareUrl").select(); } };
  $("#copyImg").onclick = async e => { try { await navigator.clipboard.write([new ClipboardItem({ "image/png": shareBlob })]); flash(e.target, "copied"); } catch (x) {} };
  $("#dlImg").onclick = () => { const a = document.createElement("a"); a.href = $("#shareImg").src; a.download = "ipv6-test.png"; a.click(); };
  $("#nativeShare").onclick = async () => {
    const text = t("share_text", { s: verdict(LAST.r).score });
    const file = shareBlob && new File([shareBlob], "ipv6-test.png", { type: "image/png" });
    try { await navigator.share(file && navigator.canShare && navigator.canShare({ files: [file] }) ? { text, url: $("#shareUrl").value, files: [file] } : { text, url: $("#shareUrl").value }); } catch (e) {}
  };

  // The card: brand, the score in its ring, the verdict, every test with its mark, a QR code for the link; in the
  // page's own theme. No address; the country only when the visitor ticked it.
  const img = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  function clip(x, s, w) { if (x.measureText(s).width <= w) return s; while (s && x.measureText(s + "…").width > w) s = s.slice(0, -1); return s + "…"; }
  function roundRect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
  async function drawCard(link) {
    const W = 1200, H = 630, P = 56, cc = $("#shareCc").checked ? LAST.cc : "";
    const F = "Geist, 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans', 'Malgun Gothic', sans-serif", M = "'Geist Mono', Consolas, monospace";
    const css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue("--" + n).trim(), dark = css.colorScheme === "dark";
    const C = { bg: v("bg"), panel: v("panel"), line: v("line"), fg: v("fg"), muted: v("muted"), soft: v("soft"), bad: v("bad"), warn: v("warn"), t1: v("t1"), t2: v("t2"), t3: v("t3"), t4: v("t4"), t5: v("t5") };
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d");
    x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
    const res = verdict(LAST.r), col = C[tierOf(res.score)];
    const logo = await img(dark ? "/assets/logo-dark.svg" : "/assets/logo-light.svg");
    x.drawImage(logo, P, 40, 150, 60);
    x.textBaseline = "alphabetic";
    x.fillStyle = C.muted; x.font = `600 24px ${F}`; x.fillText(t("app_name") + "  ·  " + location.host, P + 170, 80);
    // the QR code, top right
    const QS = 150;
    const qr = link && await loadQR().then(Q => { const q = Q(0, "M"); q.addData(link); q.make(); return q; }).catch(() => null);
    if (qr) {
      const n = qr.getModuleCount(), s = (QS - 16) / n, qx = W - P - QS, qy = 36;
      x.fillStyle = "#fff"; roundRect(x, qx, qy, QS, QS, 12); x.fill();
      x.fillStyle = "#111";
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (qr.isDark(i, j)) x.fillRect(qx + 8 + j * s, qy + 8 + i * s, s + .3, s + .3);
    }
    // the score in its ring, and the verdict beside it
    const cx = P + 110, cy = 300, rr = 96;
    x.lineWidth = 16; x.lineCap = "round";
    x.strokeStyle = C.soft; x.beginPath(); x.arc(cx, cy, rr, 0, Math.PI * 2); x.stroke();
    if (res.score) { x.strokeStyle = col; x.beginPath(); x.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * res.score / 10); x.stroke(); }
    x.textAlign = "center";
    x.fillStyle = col; x.font = `700 80px ${M}`; x.fillText(String(res.score), cx, cy + 18);
    x.fillStyle = C.muted; x.font = `500 24px ${M}`; x.fillText("/ 10", cx, cy + 54);
    x.textAlign = "left";
    const tx = P + 260, tw = W - P - tx;
    x.fillStyle = C.muted; x.font = `600 24px ${F}`; x.fillText(t("score_k"), tx, 228);
    x.fillStyle = C.fg; x.font = `750 44px ${F}`; x.fillText(clip(x, t(res.head), tw), tx, 284);
    // the tests in two columns, each with its mark
    x.font = `500 23px ${F}`;
    TESTS.forEach((test, i) => {
      const r = LAST.r[test.id], col2 = i % 2, row = Math.floor(i / 2), ax = tx + col2 * (tw / 2), ay = 336 + row * 44;
      const ok = r && r.ok, warn = ok && (r.ms > SLOW || (test.id === "ds" && r.fam === 4 && LAST.r.v6 && LAST.r.v6.ok));
      x.fillStyle = ok ? (warn ? C.warn : C.t1) : C.bad;
      x.font = `700 23px ${F}`; x.fillText(ok ? (warn ? "!" : "✓") : "✕", ax, ay);
      x.fillStyle = C.fg; x.font = `500 23px ${F}`;
      x.fillText(clip(x, t("t_" + test.id) + (test.id === "ds" && ok ? " · IPv" + r.fam : ""), tw / 2 - 44), ax + 32, ay);
    });
    // what was tested, when, and where (only if ticked)
    x.fillStyle = C.line; x.fillRect(P, H - 82, W - P * 2, 2);
    x.fillStyle = C.muted; x.font = `400 20px ${F}`;
    const foot = [t("card_sub"), new Date(LAST.ts).toLocaleDateString(D.lang), cc && country(cc)].filter(Boolean).join("  ·  ");
    x.fillText(clip(x, foot, W - P * 2), P, H - 40);
    return c;
  }

  $("#rerun").onclick = start;
  $("#testMine").onclick = start;
  const SP = sharePath(location.pathname), SHARED = SP && decodeShare(SP.code, new Set(IDS));
  if (SHARED) showShared(SHARED); else start();
})();

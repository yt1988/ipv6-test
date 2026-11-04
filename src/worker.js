// The IPv6 Test Worker. Files in ./public are served before it runs, so it only sees paths that are not files:
//   /r/<code>, /<lang>/r/<code>   a shared result: that language's page with the score and the verdict in its title
//                         (what chat apps show as the link's preview), not indexed; under ipv6-slow/, that page's
//                         result, IPv4 against IPv6 alone, with what the comparison found as its title; the page reads the code and
//                         shows the result (src/share.mjs); a code it can not read (garbled, cut short, a format it
//                         does not know) is a 404, so search engines drop the dead link
//   anything else         a bare 404; 1ms-shell puts the shared 1ms.dog 404 page in front of it

import { IDS, SIDES, verdict, compare } from "./probe.mjs";
import { decode, sharePath } from "./share.mjs";
import en from "./i18n/en.mjs";
import zhCN from "./i18n/zh-CN.mjs";
import zhTW from "./i18n/zh-TW.mjs";
import ja from "./i18n/ja.mjs";
import ko from "./i18n/ko.mjs";
import es from "./i18n/es.mjs";
import fr from "./i18n/fr.mjs";
import de from "./i18n/de.mjs";
import pt from "./i18n/pt.mjs";
import ru from "./i18n/ru.mjs";

// each language's strings by its folder ("" is English, at the root)
const STR = { "": en, "zh-cn": zhCN, "zh-tw": zhTW, ja, ko, es, fr, de, pt, ru };
const KNOWN = new Set([...IDS, ...SIDES.map(x => x.id)]);
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => k in v ? v[k] : m);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed\n", { status: 405 });

    const sp = sharePath(url.pathname), r = sp && sp.slug in STR && decode(sp.code, KNOWN);
    if (r && env.ASSETS) return shared(req, env, url, sp, r);

    return new Response(req.method === "HEAD" ? null : "Not found\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" },
    });
  },
};

// A shared result: the language's page as it is, with the title, description and their Open Graph and Twitter copies
// giving the score (the slow page's: what IPv4 against IPv6 found). r: the result the code holds.
async function shared(req, env, url, { slug, page: pg }, r) {
  const home = "/" + (slug ? slug + "/" : "") + (pg === "slow" ? "ipv6-slow/" : "");
  const S = STR[slug], v = verdict(r.r);
  // IPv4 against IPv6 leads the description when the link has it (links from before it do not)
  const c = compare(r.r), ms = c.n ? (Math.abs(c.diff) < 10 ? Math.abs(c.diff).toFixed(1) : String(Math.round(Math.abs(c.diff)))) : "";
  const title = pg === "slow" ? fill(S[c.key], { ms }) + " · " + S.app_name : fill(S.share_title, { s: v.score, verdict: S[v.head] });
  const desc = pg === "slow" ? S.slow_og : SIDES.some(x => x.id in r.r) ? fill(S[c.key], { ms }) + " · " + S.share_desc : S.share_desc;
  const page = await env.ASSETS.fetch(new Request(new URL(home, url), { headers: req.headers }));
  if (!page.ok) return page;
  const attr = (val, name = "content") => ({ element: e => e.setAttribute(name, val) });
  const out = new HTMLRewriter()
    .on("title", { element: e => e.setInnerContent(title) })
    .on('meta[name="description"]', attr(desc))
    .on('meta[property="og:title"]', attr(title)).on('meta[name="twitter:title"]', attr(title))
    .on('meta[property="og:description"]', attr(desc)).on('meta[name="twitter:description"]', attr(desc))
    .on('meta[property="og:url"]', attr(url.origin + url.pathname))
    .on('meta[name="robots"]', attr("noindex, follow"))
    .transform(page);
  const h = new Headers(out.headers);
  h.delete("etag");
  h.set("cache-control", "public, max-age=3600");
  h.set("x-robots-tag", "noindex");
  return new Response(req.method === "HEAD" ? null : out.body, { status: 200, headers: h });
}

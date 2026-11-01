# IPv6 Test

**English** · [简体中文](README.zh-CN.md)

Does your network support IPv6? [IPv6 Test](https://ipv6.1ms.dog/) runs six checks in your browser, shows your IPv4 and IPv6 addresses, and scores your network out of 10, after test-ipv6.com's idea.

**Use it:** https://ipv6.1ms.dog/

## What it tests

| Test | How | What it tells |
|---|---|---|
| **IPv4-only site** | hosts with only an A record | IPv4 works, and from which address |
| **IPv6-only site** | hosts with only an AAAA record | IPv6 works; needs DNS that returns AAAA |
| **Dual-stack site** | this site's own `/cdn-cgi/trace` (every site on Cloudflare has both) | which protocol the browser picks; over 3 s means it waited for IPv6 to time out |
| **Large packets over IPv6** | a 3.5 KB request to an IPv6-only host on a new connection | full-size packets get through both ways (the request, and the server's TLS certificate); fails when the path MTU is broken |
| **IPv6 address, no DNS** | `https://[2606:4700:4700::1111]/cdn-cgi/trace` | IPv6 without DNS; when IPv6-only sites fail and this passes, DNS is hiding AAAA |
| **IPv4 address, no DNS** | `https://1.0.0.1/cdn-cgi/trace`, `https://223.5.5.5/` | fails on IPv6-only networks with NAT64, where IPv4-only sites still open through DNS64 |

Each test asks two or three providers at once (DNSPod, icanhazip, Cloudflare, Cloudflare Radar, ipify) and takes the first answer: DNSPod answers in mainland China, icanhazip and Cloudflare elsewhere, so one being blocked or slow doesn't fail a test. The first answer includes DNS, TCP and TLS; three more requests on the same connection give the round trip (the smallest).

### The score

| Points | When |
|---|---|
| 4 | IPv6-only sites work |
| 2 | large packets get through over IPv6 |
| 2 | dual-stack sites open within 3 s |
| 1 | an IPv6 address works without DNS |
| 1 | the browser picks IPv6 on dual-stack sites |
| −1 | IPv6's first answer took over 3 s |

No IPv6 at all is 0. The verdict and the problems it names (DNS filtering AAAA, MTU, 6to4/Teredo tunnels, NAT64…) are in `verdict()` in `src/probe.mjs`.

### Sharing

A result can be shared as an image (drawn in the browser on a canvas) and a link, `/r/<code>`. The link carries only which tests passed, their times and the IPv6 kind, never an address; the country only when the visitor ticks it. The Worker reads the link and puts the score in the page title, so chat apps show the result in the preview.

## Files

```
src/probe.mjs       the tests, their hosts, how they run in the browser, the score and the verdict
src/share.mjs       the shared link's format
src/app.js          the page script
src/worker.js       shared links, /r/<code>: the score in the title
src/i18n/*.mjs      10 languages
scripts/build.mjs   builds public/ (pages, assets, CSP)
scripts/assets.mjs  renders the preview images, public/og/*.png
scripts/verify.mjs  checks every test host: A/AAAA records, CORS, the answer
```

## Run and deploy

```bash
npm install
npm run build      # builds public/
npm test           # public/ up to date, contract, strings, unit tests
npm run verify     # checks every test host from your network
npm run dev        # http://localhost:8797
npx wrangler deploy
```

The site is static files on a Cloudflare Worker: files are served without running a script, and those requests aren't billed. `src/worker.js` only handles shared links. `wrangler.toml` binds no domain: on 1ms.dog the site's shell routes `ipv6.1ms.dog` to it. To host it yourself, bind your domain to the Worker in the Cloudflare dashboard (it must be proxied by Cloudflare: the dual-stack test reads the site's own `/cdn-cgi/trace`) and build with `SITE_URL=https://your.domain npm run build`.

The CSP's `connect-src` is `https:` rather than a list of hosts: the no-DNS test asks addresses like `[2606:4700:4700::1111]`, and a CSP has no syntax for an IPv6 literal.

## License

MIT

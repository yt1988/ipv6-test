# AGENTS.md

For people and AI agents (Claude Code, Codex, Cursor and others) working in this repository: how to build, run,
test and deploy it, your own copy included. 1ms.dog's operations notes (how ipv6.1ms.dog itself is deployed and
run) are in the private repository 1ms-shell.

## What this is

An IPv6 readiness test that runs in the browser:

- **Six checks, scored out of 10** (after test-ipv6.com's idea): IPv4-only and IPv6-only sites, a dual-stack site,
  large packets over IPv6, and IPv6 and IPv4 addresses without DNS. Each asks two or three public hosts at once
  (DNSPod, icanhazip, Cloudflare, Cloudflare Radar, ipify) and takes the first answer. The tests, their hosts, the
  score and the verdict are in `src/probe.mjs`.
- **IPv4 against IPv6**: the same four networks over each, side by side; on its own page too (`/ipv6-slow/`), which
  tests only that.
- **A small server of its own** (`server/`, one Go process, optional): the path MTU the visitor's connection carries
  and whether it has a PMTU black hole (home page), and how long the browser waits for a broken IPv6 before it falls
  back to IPv4 (Happy Eyeballs, `/ipv6-slow/`). A copy without it shows no path-MTU line, and "couldn't measure" for
  the wait.
- 10 languages, shared results in links (`/<lang>/r/<code>`, never an address), an embed mode for a checkup page.

The page is static files on a Cloudflare Worker (`src/worker.js` only answers `/r/<code>` and 404s). What each file
does is listed in [README.md](README.md#files); the reasons behind the design, and what was measured to settle
them, are in [docs/design.md](docs/design.md).

## Run it locally

```bash
npm ci
npm run build    # writes public/ from src/ (pages in 10 languages, assets, CSP, sitemap)
npm run dev      # wrangler, http://localhost:8797/zh-cn/
```

The tests reach the real hosts from your network, so what you see is your own connection. To look at a full result
without testing, open a shared link (`/zh-cn/r/<code>`, from the share dialog of an earlier run).

## Test by what you changed

| Change | Run |
|---|---|
| Anything | `npm test`: `public/` is up to date with `src/` (rebuild first), every string in all 10 languages with the same placeholders, the unit tests (score, verdict, shared links, the Worker). CI runs it on every push |
| Strings, layout, styles | the above, plus the page at 375 px wide in zh-CN, ru, de and fr (the longest): nothing cut off, no sideways scroll |
| The share card | open it in en, de, ru and fr with the longest real result; `window.__msShareClips` must stay empty (the share component logs every word it had to cut) |
| The tests' hosts (`src/probe.mjs`) | `npm run verify`: every host's A/AAAA records, CORS and answer (also weekly in GitHub Actions). A host that gains or loses an address family breaks a test silently. GitHub's runners have no IPv6, so the IPv6 checks are skipped there and the summary says so; run `node scripts/verify.mjs --require-v6` on a dual-stack machine to check them, which also fails if that machine has lost IPv6 |
| `server/` | `go vet ./... && go test ./...` and a build (below; CI does all three), then the checks under "Run the server" |

Don't change how a test measures to make the page look faster (preconnecting to the test hosts, starting them
before the page is ready): the times are the result. See docs/design.md, "Page speed".

## Deploy the page

`npx wrangler deploy` uploads `public/` and the Worker. With Cloudflare Workers Builds connected to the repository,
a push to `main` deploys (`npm ci && npm test`, then `npx wrangler deploy`; nothing ships when `public/` is stale or
a test fails), so commit `public/` together with `src/`.

`wrangler.toml` binds no domain: bind yours to the Worker in the dashboard and build with
`SITE_URL=https://<your-domain> npm run build`. The domain must be proxied by Cloudflare: the dual-stack test reads
the site's own `/cdn-cgi/trace`.

## Run the server

One static Go binary under systemd on any Linux VPS with a public IPv4 and IPv6 (Linux only: it reads `TCP_SAVED_SYN`
and `TCP_INFO`, and opens a packet socket). It writes nothing to disk and keeps no access log; every reading stays in
memory for a minute at most. About 6 MB of memory. What each endpoint does is at the top of `server/main.go`.

1. **Get the binary.** Every change to `server/` merged into `main` is built by GitHub Actions
   (`.github/workflows/server.yml`: linux/amd64, static, no cgo) and published as a Release, tag
   `server-<short commit>`, the newest marked latest, with `he.nft`, the unit and `SHA256SUMS`. Download and check
   (the machine needs no Go):
   ```bash
   base=https://github.com/yt1988/ipv6-test/releases/latest/download
   for f in ipv6-server he.nft 1ms-ipv6.service SHA256SUMS; do curl -fsSLO "$base/$f"; done
   sha256sum -c SHA256SUMS   # every line must say OK
   ```
   A given version: `https://github.com/yt1988/ipv6-test/releases/download/server-<short commit>/<file>`. Or build
   it yourself (Go 1.24 or newer):
   ```bash
   cd server
   CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o ipv6-server .
   ```
   When replacing a running binary, keep the old one (`mv ipv6-server ipv6-server.prev`) so you can switch back.
2. **Three DNS names, pointing straight at the server** (not through a proxy or CDN: the server must see the
   visitor's own TCP connection): `v4.<your-domain>` with only an A record, `v6.<your-domain>` with only an AAAA
   record, `he.<your-domain>` with both.
3. **Point the page at them**: `API` and `HE` in `src/app.js`. The CSP's `connect-src` is `https:`, so no change
   there.
4. **Install**: a system user for it, a directory such as `/opt/<app>/` holding `ipv6-server` (mode 755) and
   `he.nft`, and the unit.
5. **nftables**: `he.nft` is the server's own table; the unit loads it before start (`nft -f`) and deletes it on
   stop, and nothing else on the machine is touched. It drops every IPv6 SYN to the Happy Eyeballs port. If your
   host firewall keeps a policy of drop, it must accept the two ports (8445 and 8446/tcp by default, `-mtu` and
   `-he` flags) and **ICMP and ICMPv6**: without Packet Too Big coming in, every visitor with a path MTU under 1500
   looks like a black hole. A cloud firewall in front often has separate IPv4 and IPv6 lists, and may filter ICMP
   by default; open both.
6. **Certificates** for the three names (certbot or any ACME client). The service reads `<name>.crt` and
   `<name>.key` for `v4`, `v6` and `he` from systemd's credentials directory (`LoadCredential=`), so it needs no
   access to the keys' original place; restart it after each renewal.
7. **The unit**: `server/1ms-ipv6.service` is the one ipv6.1ms.dog runs; copy it, change the paths, the user, the
   certificate directories and the table name (in `he.nft` too), then
   `systemctl daemon-reload && systemctl enable --now <unit>`. It needs `CAP_NET_ADMIN` (its nftables table) and
   `CAP_NET_RAW` (the packet socket) and nothing else.
8. **Check from another machine** (the firewall in front is only crossed from outside):
   ```bash
   curl -4 https://v4.<your-domain>:8445/mss              # {"seen":true,"fam":4,"mss":1460,"mtu":1500,...}
   curl -6 "https://v6.<your-domain>:8445/mss?t=test0001"
   curl "https://he.<your-domain>:8446/he?t=test0001"     # curl falls back after 200 ms: "wait" ≈ 200, "tries" 1
   curl -6 -m 4 https://he.<your-domain>:8446/he          # times out: the drop works
   ```

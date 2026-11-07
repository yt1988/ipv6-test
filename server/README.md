# ipv6-server

The server side of the IPv6 test: it measures what a browser can't see by itself.

- **:8445**, `v4.<your-domain>` (A only) and `v6.<your-domain>` (AAAA only): the MSS the visitor's SYN offered, the
  path MTU, and whether full-size packets get through or vanish without a Packet Too Big (a PMTU black hole).
  The home page's large-packet test shows it.
- **:8446**, `he.<your-domain>` (A and AAAA): every IPv6 SYN to this port is dropped (`he.nft`), so the browser falls
  back to IPv4; the time from its first IPv6 SYN to its IPv4 one is how long it makes you wait when IPv6 is broken
  (Happy Eyeballs). The `/ipv6-slow/` page shows it.

What it does is at the top of [main.go](main.go); why, and what was measured, in
[docs/design.md](../docs/design.md#the-server). Nothing is written to disk and no access log is kept: addresses and
readings stay in memory for a minute at most, to answer the page that asked.

How to build, install and check it on your own server: [AGENTS.md](../AGENTS.md#run-the-server).
[`.github/workflows/server.yml`](../.github/workflows/server.yml) vets, tests and builds it on every change here
(linux/amd64, static, no cgo); merged into `main`, it publishes `ipv6-server`, `he.nft`, `1ms-ipv6.service` and
`SHA256SUMS` as a Release (tag `server-<short commit>`, latest at
`https://github.com/yt1988/ipv6-test/releases/latest/download/ipv6-server`).
`1ms-ipv6.service` and `he.nft` are the files ipv6.1ms.dog runs; change their paths, user, certificate directories
and table name for yours.

# Design notes

Why the test works the way it does, and what was measured to settle it. How to build and run it is in
[AGENTS.md](../AGENTS.md).

## The browser tests

- **Several hosts per test, first answer wins.** One provider can be blocked or slow from a given network (Google
  from mainland China, DNSPod far from it), so every test asks hosts on more than one network at once and takes the
  first that answers; a test fails only when all of them do. `test/lib.test.mjs` checks every test has at least two.
- **The first answer includes DNS, TCP and TLS; the round trip is measured after.** Three more requests on the same
  connection give the round trip (the smallest of them). The first answer's time is what a visitor waits for a page;
  the round trip is what the network costs.
- **Large packets** are a 3.5 KB request to an IPv6-only host on a new connection: the request fills full-size
  packets on the way out, the server's TLS certificate on the way back. A broken path MTU passes small requests and
  loses large ones, which is how pages "hang".
- **The CSP's `connect-src` is `https:`** rather than a list of hosts: the no-DNS tests ask addresses like
  `[2606:4700:4700::1111]`, and a CSP has no syntax for an IPv6 literal.
- **IPv4 against IPv6** runs each network's two sides at the same moment, so they meet the same conditions; the
  verdict is the middle difference over the networks that answered both ways, so one odd network doesn't decide it.
- **A shared link never holds an address**, only which tests passed, their times and the IPv6 kind. A result
  comes from the visitor's own browser; addresses are personal and the link is meant to be posted.

## Checking the hosts

`scripts/verify.mjs` (weekly in GitHub Actions and by hand with `npm run verify`) checks that every host in
`src/probe.mjs` is still what its test needs: A/AAAA records over DNS over HTTPS, CORS, and an answer.

- **The IPv6 checks are skipped where there is no IPv6, and said to be skipped.** A machine without IPv6 can't
  check IPv6 hosts, and GitHub's hosted runners have none: before this, every v6 line was `ENETUNREACH` and the
  whole run was red for a reason that had nothing to do with the hosts (issue #104, 6). The script looks for a
  global unicast address (2000::/3, not 6to4 or Teredo) on the machine and one answer over IPv6 from Cloudflare,
  Google or DNSPod; without both, the IPv6 checks are skipped and counted as skipped, never as failures, and the
  summary says why. The v4 and dual-stack checks still run, and **every host's A/AAAA records are still looked up**,
  so a host that gains or loses an address family is still caught where it can be seen.
- **`--require-v6` where IPv6 is the point.** On a dual-stack machine it turns "no IPv6 here" into a failure, so a
  machine that was meant to check the IPv6 side can't go green after losing it.

## The server

The browser can't see its own TCP: the MSS its SYN offered, whether a Packet Too Big came back, how long it waited
before giving up on IPv6. The server sees those from the other end.

- **The MSS from the SYN itself**, with `TCP_SAVE_SYN` on the listener and `TCP_SAVED_SYN` per connection: no packet
  capture and no capability for this part. The path MTU is what the MSS implies (plus 40 bytes for IPv4, 60 for
  IPv6), or lower when the kernel's `TCP_INFO.tcpi_pmtu` says a Packet Too Big lowered it on the way.
- **The server's TLS handshake is the large packet.** Its certificate flight goes out in full-size segments, so a
  path that can't carry them stalls the handshake. A black hole is: the handshake never finished, segments were sent
  again and again, still unacknowledged, and no Packet Too Big lowered the path MTU. Linux's `tcp_mtu_probing` must
  stay off on the server, or the kernel would work around the very thing being measured.
- **A family that can't get through is asked about over the other one.** When the IPv6 handshake stalls, the page
  can't read the answer over IPv6, so it asks `/seen` over IPv4 with the IPv6 address the browser tests found. The
  reading holds only numbers about that connection, for a minute.
- **Happy Eyeballs without touching anything but its own port.** `he.` has both an A and an AAAA record, and the
  server's own nftables table drops every IPv6 SYN to that port, so the browser tries IPv6, hears nothing and falls
  back to IPv4. A packet socket sees the dropped SYNs anyway (packet taps run before netfilter's input hook), so
  the wait is the time from the first IPv6 SYN to the IPv4 one, both stamped on arrival at the server. The SYNs are
  matched to the visitor by the /64 its `/mss?t=<token>` came from over IPv6 just before: browsers use temporary
  addresses, but within one /64.
- **One request per connection**, HTTP/1.1 only: each test needs a new connection (a new SYN, a new handshake), and a
  connection reused from an earlier run would read the old one.
- **Nothing on disk, no access log**, every reading in memory for a minute at most: the readings exist to answer the
  page that asked, and the server sees visitors' addresses.

Measured when the server first ran (from a dual-stack VPS in Hong Kong, curl 7.74):

| Check | Result |
|---|---|
| `/mss` over IPv4 / IPv6 | MSS 1460 / 1440, path MTU 1500 both |
| `/he` with curl (falls back after 200 ms by default) | wait 199.1 ms, 1 IPv6 SYN |
| `/he` over IPv6 only | times out: the drop works |
| `/seen` over IPv4 for the same machine's IPv6 address | that connection's reading; an unknown address gives `seen: false` |
| A browser behind a fake-IP proxy (TUN mode) | MTU 1492 both families (the proxy's exit); Happy Eyeballs "went straight to IPv4", since the proxy, not the browser, opens the connection |

Not yet seen in the field: a Packet Too Big actually arriving, and a real black hole.

## Page speed

The home page's largest paint on phones is the visitor's IPv6 address, which exists only once its test answers;
the h1 paints with the first frame (about 1.1–1.3 s on a throttled phone). The rule followed: a result is never
moved, faked or shown early, and how a test measures doesn't change; the only thing that may shrink is the wait
before the measurement starts.

Measured on the live page, Playwright with a Pixel 7 profile, 150 ms RTT, 1.6 Mbps down, 4x CPU, cache off:

| Change | Largest paint, median |
|---|---|
| The address shown as soon as its test answers, not after its network and country are looked up (shipped) | 2248 → 1896 ms (5 and 7 runs) |
| `fetchpriority=high` on the two scripts | 20–40 ms, within noise (9 runs, twice) |
| Preloading the scripts from the head | nothing |
| Dropping the font preload | about 50 ms, but the first frame would show the fallback font and swap: not done |

The tests start about 950–1000 ms after navigation: about 400 ms is the response and the HTML, the rest the
scripts arriving and running. They don't wait for the stylesheet (it arrives first), so inlining the first screen's
styles wouldn't start them sooner. Placeholders sized like the result, or a larger first-screen element, only change
which element the metric counts; preconnecting to the test hosts or starting the tests earlier changes what they
measure. None of these was done.

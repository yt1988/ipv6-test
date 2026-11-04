# 1ms-ipv6

The server side of [ipv6.1ms.dog](https://ipv6.1ms.dog/), on the 1ms.dog VPS (AWS Lightsail Tokyo, dual stack). It
measures what a browser can't see by itself:

- **:8445**, `v4.ipv6.1ms.dog` (A only) and `v6.ipv6.1ms.dog` (AAAA only): the MSS the visitor's SYN offered, the
  path MTU, and whether full-size packets get through or vanish without a Packet Too Big (a PMTU black hole).
  The home page's large-packet test shows it.
- **:8446**, `he.ipv6.1ms.dog` (A and AAAA): every IPv6 SYN to this port is dropped (`he.nft`), so the browser falls
  back to IPv4; the time from its first IPv6 SYN to its IPv4 one is how long it makes you wait when IPv6 is broken
  (Happy Eyeballs). The `/ipv6-slow/` page shows it.

What it does and why is at the top of [main.go](main.go). Nothing is written to disk and no access log is kept:
addresses and readings stay in memory for a minute at most, to answer the page that asked.

Ports, names, the user, the directory and the nftables table are allocated in 1ms-shell `docs/processes.md`
("专用服务器"); this file only says how to build and install it.

## Build

[`.github/workflows/server.yml`](../.github/workflows/server.yml) vets, tests and builds it on every change here
(linux/amd64, static, no cgo) and keeps `ipv6-server`, `he.nft` and `1ms-ipv6.service` as the run's artifact:

```bash
gh run download --repo yt1988/ipv6-test --name ipv6-server --dir dist
```

## Install (over sftp, as root)

| File | To |
|---|---|
| `ipv6-server` | `/opt/1ms/ipv6/ipv6-server` (mode 755) |
| `he.nft` | `/opt/1ms/ipv6/he.nft` |
| `1ms-ipv6.service` | `/etc/systemd/system/1ms-ipv6.service` |

```bash
systemctl daemon-reload && systemctl enable --now 1ms-ipv6
```

## Check

```bash
systemctl is-active 1ms-ipv6 && nft list table inet 1ms_ipv6 && ss -tlnp | grep -E ':844[56]'
```

From outside the machine (the Lightsail firewall is only crossed from outside):

```bash
curl -4 https://v4.ipv6.1ms.dog:8445/mss
curl -6 https://v6.ipv6.1ms.dog:8445/mss?t=testtoken1
curl -4 https://he.ipv6.1ms.dog:8446/he?t=testtoken1
```

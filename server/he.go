package main

// Happy Eyeballs: he.ipv6.1ms.dog has both an A and an AAAA record, and every IPv6 SYN to port 8446 is dropped
// (he.nft). A browser tries IPv6 first, hears nothing back, and after a while tries IPv4 as well. A packet socket sees
// the SYNs before the drop (packet taps come before netfilter), so the wait is the time from the first IPv6 SYN to the
// IPv4 one. The IPv6 SYNs are matched to the visitor by the /64 their /mss on v6.ipv6.1ms.dog came from (the token).
// Kept for 30 seconds, in memory.

import (
	"log"
	"math"
	"net/netip"
	"sync"
	"syscall"
	"time"
)

const synKeep = 30 * time.Second

var (
	synMu sync.Mutex
	syn6  = map[[8]byte][]time.Time{}         // IPv6 SYNs to the port, by the sender's /64
	syn4  = map[netip.AddrPort]time.Time{}    // IPv4 SYNs to the port, by sender address and port
)

func prefix64(ip netip.Addr) (p [8]byte) {
	b := ip.As16()
	copy(p[:], b[:8])
	return
}

// The filter: IPv6 or IPv4, TCP, to the port, SYN without ACK (the packet socket is SOCK_DGRAM: the IP header first)
func synFilter(port uint32) []syscall.SockFilter {
	s := func(code, k int) syscall.SockFilter { return *syscall.LsfStmt(code, k) }
	j := func(code, k, jt, jf int) syscall.SockFilter { return *syscall.LsfJump(code, k, jt, jf) }
	const (
		ldb  = syscall.BPF_LD | syscall.BPF_B | syscall.BPF_ABS
		ldh  = syscall.BPF_LD | syscall.BPF_H | syscall.BPF_ABS
		ldbi = syscall.BPF_LD | syscall.BPF_B | syscall.BPF_IND
		ldhi = syscall.BPF_LD | syscall.BPF_H | syscall.BPF_IND
		jeq  = syscall.BPF_JMP | syscall.BPF_JEQ | syscall.BPF_K
	)
	p := int(port)
	return []syscall.SockFilter{
		/* 0 */ s(ldb, 0),
		/* 1 */ s(syscall.BPF_ALU|syscall.BPF_RSH|syscall.BPF_K, 4),
		/* 2 */ j(jeq, 6, 0, 7), // IPv6, else 10
		/* 3 */ s(ldb, 6), // next header
		/* 4 */ j(jeq, 6, 0, 15),
		/* 5 */ s(ldh, 42), // TCP destination port
		/* 6 */ j(jeq, p, 0, 13),
		/* 7 */ s(ldb, 53), // TCP flags
		/* 8 */ s(syscall.BPF_ALU|syscall.BPF_AND|syscall.BPF_K, 0x12),
		/* 9 */ j(jeq, 2, 9, 10),
		/* 10 */ j(jeq, 4, 0, 9), // IPv4
		/* 11 */ s(ldb, 9), // protocol
		/* 12 */ j(jeq, 6, 0, 7),
		/* 13 */ s(syscall.BPF_LDX|syscall.BPF_B|syscall.BPF_MSH, 0), // X = IP header length
		/* 14 */ s(ldhi, 2),
		/* 15 */ j(jeq, p, 0, 4),
		/* 16 */ s(ldbi, 13),
		/* 17 */ s(syscall.BPF_ALU|syscall.BPF_AND|syscall.BPF_K, 0x12),
		/* 18 */ j(jeq, 2, 0, 1),
		/* 19 */ s(syscall.BPF_RET|syscall.BPF_K, 128),
		/* 20 */ s(syscall.BPF_RET|syscall.BPF_K, 0),
	}
}

func htons(v uint16) uint16 { return v<<8 | v>>8 }

// capture runs for the life of the process; without CAP_NET_RAW it logs once and the readings say "unknown"
func capture(port uint32) {
	fd, err := syscall.Socket(syscall.AF_PACKET, syscall.SOCK_DGRAM, int(htons(syscall.ETH_P_ALL)))
	if err != nil {
		log.Printf("he: packet socket: %v", err)
		return
	}
	if err := syscall.AttachLsf(fd, synFilter(port)); err != nil {
		log.Printf("he: filter: %v", err)
		return
	}
	b := make([]byte, 128)
	for {
		n, from, err := syscall.Recvfrom(fd, b, 0)
		if err != nil {
			if err == syscall.EINTR {
				continue
			}
			log.Printf("he: read: %v", err)
			return
		}
		now := time.Now()
		if ll, ok := from.(*syscall.SockaddrLinklayer); ok && ll.Pkttype == syscall.PACKET_OUTGOING {
			continue
		}
		p := b[:n]
		switch {
		case n >= 40 && p[0]>>4 == 6:
			src, _ := netip.AddrFromSlice(p[8:24])
			k := prefix64(src)
			synMu.Lock()
			if l := syn6[k]; len(l) < 32 {
				syn6[k] = append(l, now)
			}
			synMu.Unlock()
		case n >= 20 && p[0]>>4 == 4:
			ihl := int(p[0]&15) * 4
			if n < ihl+2 {
				continue
			}
			src, _ := netip.AddrFromSlice(p[12:16])
			ap := netip.AddrPortFrom(src, uint16(p[ihl])<<8|uint16(p[ihl+1]))
			synMu.Lock()
			if _, seen := syn4[ap]; !seen { // the first one, not a retransmission
				syn4[ap] = now
			}
			synMu.Unlock()
		}
	}
}

func pruneSYN(now time.Time) {
	synMu.Lock()
	defer synMu.Unlock()
	for k, l := range syn6 {
		if now.Sub(l[len(l)-1]) > synKeep {
			delete(syn6, k)
		}
	}
	for k, t := range syn4 {
		if now.Sub(t) > synKeep {
			delete(syn4, k)
		}
	}
}

// What the browser did, on the IPv4 connection that finally came.
//
//	fam    6 when the request came over IPv6 (the drop is not in place: nothing measured)
//	v6     the token's /mss came over IPv6 (false: no IPv6 to wait for, or the page didn't ask)
//	tries  IPv6 SYNs from the visitor's /64 since then (0: the browser went to IPv4 at once)
//	wait   ms from the first of them to the IPv4 SYN
//	known  false when the IPv4 SYN wasn't seen and the wait is estimated from the handshake's round trip
type heReading struct {
	Fam   int     `json:"fam"`
	V6    bool    `json:"v6"`
	Tries int     `json:"tries"`
	Wait  float64 `json:"wait"`
	Known bool    `json:"known"`
}

func fallback(c *conn, t string) heReading {
	r := heReading{Fam: c.fam}
	if c.fam == 6 {
		return r
	}
	x, ok := getToken(t)
	if !ok {
		return r
	}
	r.V6 = true
	synMu.Lock()
	at, known := syn4[netip.AddrPortFrom(c.ip, c.port)]
	var l []time.Time
	if known {
		l = append(l, syn6[prefix64(x.ip)]...)
	}
	synMu.Unlock()
	if !known { // the SYN arrived one round trip before the handshake ended
		at = c.at.Add(-time.Duration(c.info().Rtt) * time.Microsecond)
		synMu.Lock()
		l = append(l, syn6[prefix64(x.ip)]...)
		synMu.Unlock()
	}
	r.Known = known
	var first time.Time
	for _, s := range l {
		if s.Before(x.at) || s.After(at) {
			continue
		}
		if r.Tries == 0 {
			first = s
		}
		r.Tries++
	}
	if r.Tries > 0 {
		r.Wait = math.Round(float64(at.Sub(first).Microseconds())/100) / 10
	}
	return r
}

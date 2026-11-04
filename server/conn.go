package main

// Connections as the kernel sees them: the SYN the visitor sent (TCP_SAVE_SYN on the listener, read back with
// TCP_SAVED_SYN: no packet capture needed) and TCP_INFO (the path MTU, what is still unacknowledged, retransmissions).
// Linux only.

import (
	"context"
	"encoding/binary"
	"net"
	"net/http"
	"net/netip"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

const (
	tcpSaveSYN  = 27 // TCP_SAVE_SYN
	tcpSavedSYN = 28 // TCP_SAVED_SYN
	keep        = time.Minute
)

type conn struct {
	*net.TCPConn
	ip   netip.Addr
	port uint16
	fam  int
	mss  int       // what the SYN offered; 0 when it could not be read
	at   time.Time // accepted (the handshake's last ACK)
	done atomic.Bool

	mu     sync.Mutex
	closed bool
	snap   syscall.TCPInfo
}

type listener struct {
	*net.TCPListener
	track bool // remembered by address for /seen
}

func listen(addr string, track bool) (net.Listener, error) {
	lc := net.ListenConfig{Control: func(_, _ string, rc syscall.RawConn) error {
		var e error
		if err := rc.Control(func(fd uintptr) { e = syscall.SetsockoptInt(int(fd), syscall.IPPROTO_TCP, tcpSaveSYN, 1) }); err != nil {
			return err
		}
		return e
	}}
	ln, err := lc.Listen(context.Background(), "tcp", addr)
	if err != nil {
		return nil, err
	}
	return &listener{ln.(*net.TCPListener), track}, nil
}

func (l *listener) Accept() (net.Conn, error) {
	tc, err := l.AcceptTCP()
	if err != nil {
		return nil, err
	}
	ap := tc.RemoteAddr().(*net.TCPAddr).AddrPort()
	c := &conn{TCPConn: tc, ip: ap.Addr().Unmap(), port: ap.Port(), at: time.Now()}
	c.fam = 6
	if c.ip.Is4() {
		c.fam = 4
	}
	if rc, err := tc.SyscallConn(); err == nil {
		rc.Control(func(fd uintptr) { c.mss = savedMSS(fd) })
	}
	if l.track {
		mu.Lock()
		byIP[c.ip] = c
		mu.Unlock()
	}
	return c, nil
}

// The MSS option of the saved SYN (its IP header, then TCP's): 0 when there is none or it can't be read
func savedMSS(fd uintptr) int {
	b := make([]byte, 512)
	n := uint32(len(b))
	if _, _, e := syscall.Syscall6(syscall.SYS_GETSOCKOPT, fd, syscall.IPPROTO_TCP, tcpSavedSYN, uintptr(unsafe.Pointer(&b[0])), uintptr(unsafe.Pointer(&n)), 0); e != 0 {
		return 0
	}
	return synMSS(b[:n])
}

func synMSS(b []byte) int {
	if len(b) < 20 {
		return 0
	}
	off := 0
	switch b[0] >> 4 {
	case 4:
		off = int(b[0]&15) * 4
		if b[9] != 6 {
			return 0
		}
	case 6:
		off = 40
		if len(b) < 40 || b[6] != 6 { // no extension headers in a SYN, in practice
			return 0
		}
	default:
		return 0
	}
	if len(b) < off+20 {
		return 0
	}
	t := b[off:]
	end := int(t[12]>>4) * 4
	if end > len(t) {
		end = len(t)
	}
	for i := 20; i < end; {
		switch k := t[i]; k {
		case 0:
			return 0
		case 1:
			i++
		default:
			if i+1 >= end || t[i+1] < 2 {
				return 0
			}
			if k == 2 && t[i+1] == 4 && i+4 <= end {
				return int(binary.BigEndian.Uint16(t[i+2:]))
			}
			i += int(t[i+1])
		}
	}
	return 0
}

func tcpInfo(fd uintptr) (ti syscall.TCPInfo, ok bool) {
	n := uint32(unsafe.Sizeof(ti))
	_, _, e := syscall.Syscall6(syscall.SYS_GETSOCKOPT, fd, syscall.IPPROTO_TCP, syscall.TCP_INFO, uintptr(unsafe.Pointer(&ti)), uintptr(unsafe.Pointer(&n)), 0)
	return ti, e == 0
}

// TCP_INFO now, or as it was when the connection closed
func (c *conn) info() syscall.TCPInfo {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return c.snap
	}
	var ti syscall.TCPInfo
	if rc, err := c.SyscallConn(); err == nil {
		rc.Control(func(fd uintptr) { ti, _ = tcpInfo(fd) })
	}
	return ti
}

func (c *conn) Close() error {
	c.mu.Lock()
	if !c.closed {
		if rc, err := c.SyscallConn(); err == nil {
			rc.Control(func(fd uintptr) { c.snap, _ = tcpInfo(fd) })
		}
		c.closed = true
	}
	c.mu.Unlock()
	return c.TCPConn.Close()
}

// a request was read: the TLS handshake got through
func connState(nc net.Conn, s http.ConnState) {
	if s != http.StateActive {
		return
	}
	if t, ok := nc.(interface{ NetConn() net.Conn }); ok {
		if c, ok := t.NetConn().(*conn); ok {
			c.done.Store(true)
		}
	}
}

// What a connection says about the path to the visitor.
//
//	mss      the MSS the visitor's SYN offered (its link MTU less 40 for IPv4, 60 for IPv6, or what a router clamped it to)
//	mtu      the path MTU: what the MSS implies, or less when a Packet Too Big came back on the way (ptb)
//	stalled  the TLS handshake never finished while full-size segments went out again and again, unacknowledged,
//	         and no Packet Too Big lowered the path MTU: a black hole
type reading struct {
	Seen    bool `json:"seen"`
	Fam     int  `json:"fam"`
	MSS     int  `json:"mss"`
	MTU     int  `json:"mtu"`
	PTB     bool `json:"ptb"`
	Done    bool `json:"done"`
	Stalled bool `json:"stalled"`
	Retrans int  `json:"retrans"`
	Age     int  `json:"age"` // seconds since the connection
}

func (c *conn) reading() reading {
	ti := c.info()
	r := reading{Seen: true, Fam: c.fam, MSS: c.mss, Done: c.done.Load(), Retrans: int(ti.Total_retrans), Age: int(time.Since(c.at).Seconds())}
	hdr := 60
	if c.fam == 4 {
		hdr = 40
	}
	offered := 0
	if c.mss > 0 {
		offered = c.mss + hdr
	}
	r.MTU = offered
	if p := int(ti.Pmtu); p > 0 && offered > 0 && p < offered {
		r.MTU, r.PTB = p, true
	}
	r.Stalled = !r.Done && !r.PTB && ti.Unacked > 0 && ti.Total_retrans > 0
	return r
}

/* ---------- what is remembered, a minute at most ---------- */

type tok struct {
	ip netip.Addr
	at time.Time
}

var (
	mu     sync.Mutex
	byIP   = map[netip.Addr]*conn{}
	tokens = map[string]tok{}
)

func lastFrom(ip netip.Addr) *conn {
	mu.Lock()
	defer mu.Unlock()
	if c := byIP[ip]; c != nil && time.Since(c.at) < keep {
		return c
	}
	return nil
}

func putToken(t string, ip netip.Addr) {
	mu.Lock()
	tokens[t] = tok{ip, time.Now()}
	mu.Unlock()
}

func getToken(t string) (tok, bool) {
	mu.Lock()
	defer mu.Unlock()
	x, ok := tokens[t]
	return x, ok && time.Since(x.at) < keep
}

func prune() {
	for range time.Tick(10 * time.Second) {
		now := time.Now()
		mu.Lock()
		for k, c := range byIP {
			if now.Sub(c.at) > keep {
				delete(byIP, k)
			}
		}
		for k, x := range tokens {
			if now.Sub(x.at) > keep {
				delete(tokens, k)
			}
		}
		mu.Unlock()
		pruneSYN(now)
	}
}

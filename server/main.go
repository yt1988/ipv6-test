// ipv6-server: the server side of the IPv6 test (ipv6.1ms.dog runs one; AGENTS.md says how to run your own).
//
//	:8445  v4.ipv6.1ms.dog (A only) and v6.ipv6.1ms.dog (AAAA only)
//	       GET /mss?t=<token>  this connection: the MSS the visitor's SYN offered, the path MTU the kernel holds for the
//	                           visitor (lower than the MSS implies when a Packet Too Big came back); a v6 connection's
//	                           address is kept under the token for /he, a minute at most
//	       GET /seen?ip=<addr> the last connection from that address in the last minute: a TLS handshake that never
//	                           finished, with full-size segments sent again and again and no Packet Too Big, is a PMTU
//	                           black hole (the page asks this over the other family, since that one can't get through)
//	:8446  he.ipv6.1ms.dog (both A and AAAA); the table inet msdog_ipv6 (he.nft) drops every IPv6 SYN to this port, so a
//	       browser tries IPv6, hears nothing, and falls back to IPv4 (Happy Eyeballs)
//	       GET /he?t=<token>   how long the browser waited: from its first IPv6 SYN (seen on a packet socket before the
//	                           drop, matched by the /64 the token's /mss came from) to its IPv4 SYN
//
// Nothing is written to disk and nothing is logged but startup and errors. Every answer is JSON with CORS for any
// origin (numbers about the asker's own connection, no cookies) and is not cached; every connection closes after one
// request, so each test starts a new one.
package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"flag"
	"log"
	"net"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	mtuAddr := flag.String("mtu", ":8445", "MTU/MSS listener")
	heAddr := flag.String("he", ":8446", "Happy Eyeballs listener")
	creds := flag.String("creds", os.Getenv("CREDENTIALS_DIRECTORY"), "directory with <name>.crt and <name>.key for v4, v6 and he")
	flag.Parse()
	log.SetFlags(0)

	var certs []tls.Certificate
	for _, n := range []string{"v4", "v6", "he"} {
		c, err := tls.LoadX509KeyPair(filepath.Join(*creds, n+".crt"), filepath.Join(*creds, n+".key"))
		if err != nil {
			log.Fatalf("certificate %s: %v", n, err)
		}
		certs = append(certs, c)
	}
	// HTTP/1.1 only: one request per connection, nothing multiplexed onto a connection from before
	tc := &tls.Config{Certificates: certs, NextProtos: []string{"http/1.1"}, MinVersion: tls.VersionTLS12}

	go capture(8446)
	go prune()

	serve := func(addr string, h http.Handler, track bool) {
		ln, err := listen(addr, track)
		if err != nil {
			log.Fatalf("listen %s: %v", addr, err)
		}
		srv := &http.Server{
			Handler:           h,
			TLSConfig:         tc,
			TLSNextProto:      map[string]func(*http.Server, *tls.Conn, http.Handler){},
			ReadHeaderTimeout: 5 * time.Second, // also the TLS handshake's limit: a black hole stalls there
			WriteTimeout:      10 * time.Second,
			IdleTimeout:       5 * time.Second,
			ConnState:         connState,
			ConnContext:       connContext,
			ErrorLog:          log.New(discard{}, "", 0), // handshake failures are what the tests are about, not errors
		}
		log.Fatal(srv.Serve(tls.NewListener(ln, tc)))
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/mss", handleMSS)
	mux.HandleFunc("/seen", handleSeen)
	hm := http.NewServeMux()
	hm.HandleFunc("/he", handleHE)
	log.Printf("1ms-ipv6: %s (mtu), %s (he)", *mtuAddr, *heAddr)
	go serve(*heAddr, cors(hm), false)
	serve(*mtuAddr, cors(mux), true)
}

type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }

func cors(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Connection", "close")
		if r.Method != http.MethodGet {
			http.Error(w, "GET only", http.StatusMethodNotAllowed)
			return
		}
		h.ServeHTTP(w, r)
	})
}

func reply(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// the tracked connection under an HTTP request (through the TLS layer)
type connKey struct{}

func connContext(ctx context.Context, c net.Conn) context.Context {
	if t, ok := c.(*tls.Conn); ok {
		if tc, ok := t.NetConn().(*conn); ok {
			return context.WithValue(ctx, connKey{}, tc)
		}
	}
	return ctx
}

func connOf(r *http.Request) *conn {
	tc, _ := r.Context().Value(connKey{}).(*conn)
	return tc
}

// a token from the page: short, letters and digits only
func token(r *http.Request) string {
	t := r.URL.Query().Get("t")
	if len(t) < 8 || len(t) > 40 || strings.Trim(t, "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ") != "" {
		return ""
	}
	return t
}

func handleMSS(w http.ResponseWriter, r *http.Request) {
	c := connOf(r)
	if c == nil {
		http.Error(w, "no connection", http.StatusInternalServerError)
		return
	}
	if t := token(r); t != "" && c.fam == 6 {
		putToken(t, c.ip)
	}
	reply(w, c.reading())
}

func handleSeen(w http.ResponseWriter, r *http.Request) {
	ip, err := netip.ParseAddr(r.URL.Query().Get("ip"))
	if err != nil {
		http.Error(w, "ip?", http.StatusBadRequest)
		return
	}
	c := lastFrom(ip.Unmap())
	if c == nil {
		reply(w, map[string]any{"seen": false})
		return
	}
	reply(w, c.reading())
}

func handleHE(w http.ResponseWriter, r *http.Request) {
	c := connOf(r)
	if c == nil {
		http.Error(w, "no connection", http.StatusInternalServerError)
		return
	}
	reply(w, fallback(c, token(r)))
}

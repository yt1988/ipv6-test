// Endpoint auth (docs/tool-contract.md, "端点鉴权"): the shell that serves the tool pages signs a short-lived token
// into the page, and the page sends it as "Authorization: Bearer v1.<exp>.<nonce>.<hmac>". The HMAC-SHA256 covers
// "v1|exp|nonce|scope". With MS_AUTH_SECRET unset — the default, and how a self-hosted copy runs — nothing is checked.
//
// The token carries no scope field, so the server must know the string that was signed. Two are accepted: this
// service's own capability, and the site-wide list of capabilities; the issuer is expected to sign one of them.
// This is a gate against casual use, not a hard boundary: a token that is valid for any page of the site is valid
// here, which is what "one token serves a page's endpoints" means.
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const tokenVersion = "v1"

// the scope strings a token may have been signed over
var authScopes = []string{
	"ipv6", // this service's capability
	"probe,reach,ping,rtc,ipv6,seg,dns,data", // the site-wide list the shell may sign for a page
}

const (
	whyNoToken  = "no_token"
	whyBadToken = "bad_token"
)

// authSecret is MS_AUTH_SECRET from the environment, or from systemd's credentials directory when the unit passes it
// with LoadCredential instead (the unit itself is not changed). Empty means no check.
func authSecret() string {
	if s := strings.TrimSpace(os.Getenv("MS_AUTH_SECRET")); s != "" {
		return s
	}
	if d := os.Getenv("CREDENTIALS_DIRECTORY"); d != "" {
		if b, err := os.ReadFile(filepath.Join(d, "MS_AUTH_SECRET")); err == nil {
			return strings.TrimSpace(string(b))
		}
	}
	return ""
}

// auth wraps h: without a secret every request passes; with one, every route of this listener needs a valid token.
func auth(h http.Handler, secret string) http.Handler {
	if secret == "" {
		return h
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// a CORS preflight carries no Authorization header; cors() answers it before this point, and if this wrapper
		// is ever used without cors() an OPTIONS request still must not be rejected
		if r.Method == http.MethodOptions {
			h.ServeHTTP(w, r)
			return
		}
		if ok, why := tokenOK(secret, r.Header.Get("Authorization"), time.Now()); !ok {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]any{"error": why})
			return
		}
		h.ServeHTTP(w, r)
	})
}

// tokenOK checks "Bearer v1.<exp>.<nonce>.<hmac>": version, not expired, and a signature over one of authScopes.
func tokenOK(secret, header string, now time.Time) (bool, string) {
	s := strings.TrimSpace(header)
	if s == "" {
		return false, whyNoToken
	}
	if len(s) < 7 || !strings.EqualFold(s[:7], "bearer ") {
		return false, whyNoToken
	}
	parts := strings.Split(strings.TrimSpace(s[7:]), ".")
	if len(parts) != 4 || parts[0] != tokenVersion || parts[2] == "" || parts[3] == "" {
		return false, whyBadToken
	}
	exp, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || now.Unix() >= exp {
		return false, whyBadToken
	}
	mac, err := hex.DecodeString(parts[3])
	if err != nil || len(mac) != sha256.Size {
		return false, whyBadToken
	}
	for _, scope := range authScopes {
		if hmac.Equal(mac, sign(secret, parts[1], parts[2], scope)) {
			return true, ""
		}
	}
	return false, whyBadToken
}

func sign(secret, exp, nonce, scope string) []byte {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(tokenVersion + "|" + exp + "|" + nonce + "|" + scope))
	return m.Sum(nil)
}

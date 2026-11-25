package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

const testSecret = "s3cret"

// signedToken builds the token the shell is meant to sign:
// v1.<exp>.<nonce>.<scope>.<hmac>, HMAC-SHA256 over "v1|exp|nonce|scope", base64url without padding.
func signedToken(secret, scope string, exp int64, nonce string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte("v1|" + strconv.FormatInt(exp, 10) + "|" + nonce + "|" + scope))
	return "v1." + strconv.FormatInt(exp, 10) + "." + nonce + "." + scope + "." + base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func reachable() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
}

func send(h http.Handler, authz string, method string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "https://v4.example:8445/mss", nil)
	if authz != "" {
		req.Header.Set("Authorization", authz)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func errCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct{ Error string }
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("401 body is not JSON: %q", rec.Body.String())
	}
	return body.Error
}

func TestAuthOffAllowsEverything(t *testing.T) {
	h := auth(reachable(), "")
	if rec := send(h, "", http.MethodGet); rec.Code != http.StatusOK {
		t.Fatalf("no secret: status %d, want 200", rec.Code)
	}
	if rec := send(h, "Bearer nonsense", http.MethodGet); rec.Code != http.StatusOK {
		t.Fatalf("no secret, junk token: status %d, want 200", rec.Code)
	}
}

func TestAuthNoToken(t *testing.T) {
	h := auth(reachable(), testSecret)
	for _, hdr := range []string{"", "Basic abc"} {
		rec := send(h, hdr, http.MethodGet)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("header %q: status %d, want 401", hdr, rec.Code)
		}
		if got := errCode(t, rec); got != "no_token" {
			t.Fatalf("header %q: error %q, want no_token", hdr, got)
		}
	}
}

func TestAuthExpired(t *testing.T) {
	past := time.Now().Add(-5 * time.Second).Unix()
	rec := send(auth(reachable(), testSecret), "Bearer "+signedToken(testSecret, "ipv6", past, "nonce1"), http.MethodGet)
	if rec.Code != http.StatusUnauthorized || errCode(t, rec) != "bad_token" {
		t.Fatalf("expired: status %d, body %q", rec.Code, rec.Body.String())
	}
}

func TestAuthScopeMustContainCapability(t *testing.T) {
	future := time.Now().Add(5 * time.Minute).Unix()
	for _, scope := range []string{"rtc", "probe,rtc", "ipv6x"} {
		rec := send(auth(reachable(), testSecret), "Bearer "+signedToken(testSecret, scope, future, "nonce2"), http.MethodGet)
		if rec.Code != http.StatusUnauthorized || errCode(t, rec) != "bad_token" {
			t.Fatalf("scope %q: status %d, body %q", scope, rec.Code, rec.Body.String())
		}
	}
	// the scope field is signed: a valid signature for "ipv6" does not carry over to another scope in the token
	good := signedToken(testSecret, "ipv6", future, "nonce3")
	tampered := strings.Replace(good, ".ipv6.", ".rtc.", 1)
	if rec := send(auth(reachable(), testSecret), "Bearer "+tampered, http.MethodGet); rec.Code != http.StatusUnauthorized {
		t.Fatalf("tampered scope: status %d, want 401", rec.Code)
	}
}

func TestAuthAcceptsItsScope(t *testing.T) {
	future := time.Now().Add(5 * time.Minute).Unix()
	for _, scope := range []string{"ipv6", "probe,ipv6", "rtc,ipv6,probe", "probe,reach,ping,rtc,ipv6,seg,dns,data", "*"} {
		rec := send(auth(reachable(), testSecret), "Bearer "+signedToken(testSecret, scope, future, "nonce4"), http.MethodGet)
		if rec.Code != http.StatusOK {
			t.Fatalf("scope %q: status %d, want 200", scope, rec.Code)
		}
	}
	rec := send(auth(reachable(), testSecret), "Bearer "+signedToken("other", "ipv6", future, "nonce5"), http.MethodGet)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("foreign secret: status %d, want 401", rec.Code)
	}
	// the old four-part shape is not a token any more
	old := "v1." + strconv.FormatInt(future, 10) + ".nonce6." + base64.RawURLEncoding.EncodeToString([]byte("x"))
	if rec := send(auth(reachable(), testSecret), "Bearer "+old, http.MethodGet); rec.Code != http.StatusUnauthorized {
		t.Fatalf("four-part token: status %d, want 401", rec.Code)
	}
}

// every route of both listeners is behind the check, and the CORS preflight is answered without a token
func TestAuthCoversAllRoutesAndPreflight(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/mss", func(w http.ResponseWriter, r *http.Request) {})
	mux.HandleFunc("/seen", func(w http.ResponseWriter, r *http.Request) {})
	mux.HandleFunc("/he", func(w http.ResponseWriter, r *http.Request) {})
	h := cors(auth(mux, testSecret))
	for _, path := range []string{"/mss", "/seen", "/he", "/nothing-here"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s without a token: status %d, want 401", path, rec.Code)
		}
	}
	req := httptest.NewRequest(http.MethodOptions, "/mss", nil)
	req.Header.Set("Origin", "https://ipv6.1ms.dog")
	req.Header.Set("Access-Control-Request-Headers", "authorization")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight: status %d, want 204", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(strings.ToLower(got), "authorization") {
		t.Fatalf("preflight allow-headers %q must allow Authorization", got)
	}
}

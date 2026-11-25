// Endpoint auth, page side (docs/tool-contract.md, "端点鉴权"). The shell that serves this page signs a short-lived
// token into <meta name="ms-auth" content="v1.<exp>.<nonce>.<scope>.<hmac>">; requests to our own measurement
// endpoints carry it as "Authorization: Bearer …". No meta (a self-hosted copy, a local build) means no header.
//
// A 401 means the token was stale or missing: ask the shell once for a fresh one (GET /_ms/token, same origin only),
// write it back into the meta and retry the request one time. If that fails too, the caller treats the endpoint as
// unavailable — no loops, no repeated retries.
//
// Kept dependency-free and injectable so the retry rules can be tested in Node, where there is no browser.

export function readToken(doc) {
  const m = doc && doc.querySelector ? doc.querySelector('meta[name="ms-auth"]') : null;
  return (m && m.getAttribute("content")) || "";
}

function writeToken(doc, token) {
  const m = doc && doc.querySelector ? doc.querySelector('meta[name="ms-auth"]') : null;
  if (m) m.setAttribute("content", token);
}

// authFetch returns a fetch() that attaches the page token to the endpoints it belongs to, and handles the one-shot
// renewal. fetch, doc and isOurs are injectable for tests.
export function authFetch({ fetch: doFetch, doc, isOurs = () => true, tokenPath = "/_ms/token" } = {}) {
  const f = doFetch || globalThis.fetch;
  const d = doc !== undefined ? doc : globalThis.document;
  let token = readToken(d), renewing = null;

  // one renewal in flight at a time: a page asks its endpoints together, and all of them may see 401 at once
  function renew() {
    if (renewing) return renewing;
    renewing = f(tokenPath, { cache: "no-store", credentials: "omit" })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        const t = (j && j.token) || "";
        if (t) { token = t; writeToken(d, t); }
        return t;
      })
      .catch(() => "")
      .finally(() => { renewing = null; });
    return renewing;
  }

  function call(url, init, useToken) {
    const headers = { ...((init && init.headers) || {}) };
    if (useToken) headers.Authorization = "Bearer " + useToken;
    return f(url, { ...(init || {}), headers });
  }

  return async function authedFetch(url, init = {}) {
    const ours = isOurs(url);
    if (!ours || !token) return call(url, init, "");   // nothing to send: no meta means no header
    const first = await call(url, init, token);
    if (first.status !== 401) return first;
    const fresh = await renew();
    if (!fresh) return first;                          // no shell to ask, or it has no secret: give up quietly
    return call(url, init, fresh);                     // exactly one retry
  };
}

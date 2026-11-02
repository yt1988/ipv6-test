// The Worker answers a shared-result path only when it can read the code (1ms-shell docs/tool-contract.md, section 4):
// anything else is a 404, never a redirect to the home page.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const ASSETS = { fetch: () => { throw new Error("a code that can't be read must not reach the page"); } };
const get = path => worker.fetch(new Request("https://ipv6.1ms.dog" + path), { ASSETS });

test("a result link whose code can't be read is a 404", async () => {
  for (const p of ["/r/zz", "/zh-cn/r/zz", "/r/9~tnuwco~-~v6_6_ar_3j_n", "/r/1~tnu", "/xx/r/1~tnuwco~-~v6_6_ar_3j_n", "/r/", "/nope"]) {
    const res = await get(p);
    assert.equal(res.status, 404, p);
    assert.equal(res.headers.get("location"), null, p);
  }
});

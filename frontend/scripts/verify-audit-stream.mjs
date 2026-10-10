import assert from "node:assert/strict";
import fs from "node:fs/promises";

const api = process.env.AUDIT_API_URL || "http://127.0.0.1:8003";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(api).hostname));
const login = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
assert.ok(login.ok);
const { token } = await login.json();
const headers = { Authorization: `Bearer ${token}` };
const started = performance.now();
const stream = await fetch(api + "/events/stream?topics=floor", { headers, signal: AbortSignal.timeout(45000) });
assert.equal(stream.status, 200);
let text = "", revoked = false;
for await (const chunk of stream.body) {
  text += new TextDecoder().decode(chunk);
  if (!revoked && text.includes("system.connected")) {
    const logout = await fetch(api + "/auth/logout", { method: "POST", headers });
    assert.equal(logout.status, 200);
    assert.equal((await fetch(api + "/auth/me", { headers })).status, 401);
    revoked = true;
  }
  if (text.includes("system.auth_expired")) break;
}
assert.ok(revoked && text.includes("system.auth_expired"));
const result = { connected: true, logout: 200, restAfterLogout: 401, streamAuthExpired: true, elapsedMilliseconds: +(performance.now() - started).toFixed(1), events: [...text.matchAll(/event: ([^\r\n]+)/g)].map(m => m[1]) };
await fs.writeFile("../docs/full-stack-audit/sse-revocation.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));

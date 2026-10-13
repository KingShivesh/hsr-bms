import assert from "node:assert/strict";
const api = "http://127.0.0.1:8006";
assert.equal(new URL(api).hostname, "127.0.0.1");
const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(response => response.json());
const headers = { Authorization: `Bearer ${auth.token}` };
const sessions = await fetch(api + "/sessions/active", { headers }).then(response => response.json());
for (const session of sessions) if (!session.paused) {
  const response = await fetch(api + "/sessions/pause/" + session.table_id, { method: "POST", headers }); assert.equal(response.status, 200);
}
const { alerts } = await fetch(api + "/sessions/alerts", { headers }).then(response => response.json());
for (const alert of alerts) {
  const response = await fetch(api + `/sessions/alerts/${alert.id}/acknowledge`, { method: "POST", headers }); assert.equal(response.status, 200);
}
console.log(JSON.stringify({ localOnly: true, pausedSessions: sessions.length, acknowledged: alerts.length, purpose: "Stable base-page contrast; alert and checkout states have separate browser coverage" }));

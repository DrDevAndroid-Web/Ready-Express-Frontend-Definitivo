import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCIsImlzcyI6InN1cGFiYXNlIn0",
  "test-signature"
].join(".");
process.env.SUPABASE_ANON_KEY ||= "anon-key";

const { isRecentRecoverySession } = await import("../middlewares/auth.js");
const { default: app } = await import("../app.js");

let server, baseUrl;
before(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const now = 1_790_000_000;
const jwt = amr => ["e30", Buffer.from(JSON.stringify({ sub: "u1", amr })).toString("base64url"), "firma"].join(".");

describe("isRecentRecoverySession — solo la sesión del enlace de recuperación", () => {
  it("acepta la sesión otp del enlace del email (reciente)", () => {
    assert.equal(isRecentRecoverySession(jwt([{ method: "otp", timestamp: now - 60 }]), now), true);
  });
  it("rechaza una sesión normal de contraseña", () => {
    assert.equal(isRecentRecoverySession(jwt([{ method: "password", timestamp: now - 60 }]), now), false);
  });
  it("rechaza un enlace de recuperación de hace más de una hora", () => {
    assert.equal(isRecentRecoverySession(jwt([{ method: "otp", timestamp: now - 3601 }]), now), false);
  });
  it("rechaza tokens mal formados o sin amr", () => {
    assert.equal(isRecentRecoverySession("no-es-un-jwt", now), false);
    assert.equal(isRecentRecoverySession(jwt(undefined), now), false);
    assert.equal(isRecentRecoverySession(undefined, now), false);
  });
});

describe("Peticiones sin cuerpo → 400, no 500", () => {
  for (const path of ["/api/payments/upload", "/api/chat/message", "/api/auth/login", "/api/auth/refresh"]) {
    it(`POST ${path} sin cuerpo`, async () => {
      const res = await fetch(`${baseUrl}${path}`, { method: "POST" });
      assert.equal(res.status, 400);
    });
  }
});

describe("Rutas protegidas tras la auditoría", () => {
  it("GET /api/notifications/stats sin sesión → 401", async () => {
    const res = await fetch(`${baseUrl}/api/notifications/stats`);
    assert.equal(res.status, 401);
  });
  it("POST /api/auth/reset-password sin sesión → 401", async () => {
    const res = await fetch(`${baseUrl}/api/auth/reset-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "12345678" }) });
    assert.equal(res.status, 401);
  });
  it("POST /api/auth/reset-password con token inválido → 401 sin detalles internos", async () => {
    const res = await fetch(`${baseUrl}/api/auth/reset-password`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer abc.def.ghi" }, body: "{}" });
    assert.equal(res.status, 401);
    assert.doesNotMatch((await res.json()).error, /fetch|ENOTFOUND|supabase/i);
  });
});

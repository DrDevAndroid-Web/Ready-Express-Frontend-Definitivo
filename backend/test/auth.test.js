import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCIsImlzcyI6InN1cGFiYXNlIn0",
  "test-signature"
].join(".");
process.env.SUPABASE_ANON_KEY ||= "anon-key";

const { default: app } = await import("../app.js");

let server;
let baseUrl;

before(() => {
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
});

async function request(path, options) {
  return fetch(`${baseUrl}${path}`, options);
}

describe("GET /api/auth/config", () => {
  it("devuelve la configuración de auth del dashboard", async () => {
    const res = await request("/api/auth/config");
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.auth, "backend");
  });
});

describe("GET /api/auth/me", () => {
  it("rechaza sin token con 401", async () => {
    const res = await request("/api/auth/me");
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.match(body.error, /Sesion requerida/i);
  });

  it("rechaza con formato de autorización incorrecto (no Bearer)", async () => {
    const res = await request("/api/auth/me", {
      headers: { Authorization: "Token un-token-cualquiera" }
    });
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.match(body.error, /Sesion requerida/i);
  });

  it("rechaza Bearer token inválido con 401 y mensaje de sesión expirada", async () => {
    const res = await request("/api/auth/me", {
      headers: { Authorization: "Bearer token-invalido-que-no-existe-en-supabase" }
    });
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.match(body.error, /Sesion invalida|expirada|No autorizado/i);
  });
});

describe("POST /api/auth/login", () => {
  it("rechaza body vacío con 400 y pide email y contraseña", async () => {
    const res = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /Email y contraseña/i);
  });

  it("rechaza con solo email (sin password)", async () => {
    const res = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" })
    });
    const body = await res.json();
    assert.equal(res.status, 400);
  });

  it("rechaza con solo password (sin email)", async () => {
    const res = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "12345678" })
    });
    const body = await res.json();
    assert.equal(res.status, 400);
  });
});

describe("POST /api/auth/refresh", () => {
  it("rechaza sin refresh_token con 400", async () => {
    const res = await request("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /Refresh token/i);
  });
});

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

process.env.TROPIPAY_CLIENT_ID = "client-id";
process.env.TROPIPAY_CLIENT_SECRET = "client-secret";
process.env.TROPIPAY_URL_BASE = "https://tropipay.test";

const { getTropipayPayment, resetTropipayTokenCache, tokenExpiresAt } = await import("../modules/payments/providers/tropipay.provider.js");

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
beforeEach(() => resetTropipayTokenCache());

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const expiredToken = { error: { code: "EXPIRED_TOKEN", type: "UNAUTHORIZED_ERROR", message: "Invalid credentials" } };
const inTwoHours = () => Math.floor(Date.now() / 1000) + 7200;

describe("tokenExpiresAt — formato de expires_in", () => {
  const now = Date.UTC(2026, 9, 1, 3, 0, 0);

  it("interpreta un timestamp Unix absoluto (lo que devuelve TropiPay)", () => {
    assert.equal(tokenExpiresAt(1790831294, now), 1790831294 * 1000);
  });

  it("interpreta una duración en segundos", () => {
    assert.equal(tokenExpiresAt(3600, now), now + 3600 * 1000);
  });

  it("usa 5 minutos si falta o no es válido", () => {
    assert.equal(tokenExpiresAt(undefined, now), now + 5 * 60_000);
    assert.equal(tokenExpiresAt("abc", now), now + 5 * 60_000);
  });
});

describe("token de TropiPay", () => {
  it("100 pagos simultáneos comparten una sola petición de token", async () => {
    let tokenCalls = 0;
    globalThis.fetch = async url => {
      if (url.endsWith("/api/v3/access/token")) {
        tokenCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 20));
        return json(200, { access_token: "token-1", expires_in: inTwoHours() });
      }
      return json(200, { id: "pc", state: 1 });
    };

    await Promise.all(Array.from({ length: 100 }, (_, i) => getTropipayPayment(`pc-${i}`)));
    assert.equal(tokenCalls, 1);
  });

  it("si el token es rechazado, 100 pagos simultáneos lo renuevan una sola vez", async () => {
    let tokens = 0;
    const authHeaders = [];
    globalThis.fetch = async (url, options = {}) => {
      if (url.endsWith("/api/v3/access/token")) {
        await new Promise(resolve => setTimeout(resolve, 20));
        return json(200, { access_token: `token-${++tokens}`, expires_in: inTwoHours() });
      }
      authHeaders.push(options.headers.Authorization);
      return options.headers.Authorization === "Bearer token-1" ? json(401, expiredToken) : json(200, { id: "pc", state: 1 });
    };

    await Promise.all(Array.from({ length: 100 }, (_, i) => getTropipayPayment(`pc-${i}`)));
    assert.equal(tokens, 2);
    assert.equal(authHeaders.filter(h => h === "Bearer token-2").length, 100);
  });

  it("no reintenta indefinidamente si el token nuevo también es rechazado", async () => {
    let calls = 0;
    globalThis.fetch = async url => {
      if (url.endsWith("/api/v3/access/token")) return json(200, { access_token: `token-${calls}`, expires_in: inTwoHours() });
      calls += 1;
      return json(401, expiredToken);
    };

    await assert.rejects(getTropipayPayment("pc-2"), error => error.status === 401);
    assert.equal(calls, 2);
  });

  it("no reintenta errores que no son de autenticación", async () => {
    let calls = 0;
    globalThis.fetch = async url => {
      if (url.endsWith("/api/v3/access/token")) return json(200, { access_token: "token-y", expires_in: inTwoHours() });
      calls += 1;
      return json(400, { error: { code: "INVALID_PARAM" } });
    };

    await assert.rejects(getTropipayPayment("pc-3"), error => error.status === 400);
    assert.equal(calls, 1);
  });

  it("renueva el token antes de que caduque", async () => {
    let tokens = 0;
    globalThis.fetch = async url => {
      if (url.endsWith("/api/v3/access/token")) return json(200, { access_token: `token-${++tokens}`, expires_in: Math.floor(Date.now() / 1000) + 30 });
      return json(200, { id: "pc", state: 1 });
    };

    await getTropipayPayment("pc-4");
    await getTropipayPayment("pc-5");
    assert.equal(tokens, 2); // caduca en 30 s, dentro del margen de 60 s: no se reutiliza
  });
});

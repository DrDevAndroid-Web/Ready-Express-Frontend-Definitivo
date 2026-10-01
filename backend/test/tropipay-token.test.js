import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

process.env.TROPIPAY_CLIENT_ID = "client-id";
process.env.TROPIPAY_CLIENT_SECRET = "client-secret";
process.env.TROPIPAY_URL_BASE = "https://tropipay.test";

const { getTropipayPayment } = await import("../modules/payments/providers/tropipay.provider.js");

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const expiredToken = { error: { code: "EXPIRED_TOKEN", type: "UNAUTHORIZED_ERROR", message: "Invalid credentials" } };

describe("token de TropiPay invalidado antes de expires_in", () => {
  it("pide un token nuevo y reintenta una vez cuando TropiPay responde EXPIRED_TOKEN", async () => {
    let tokens = 0;
    const authHeaders = [];
    globalThis.fetch = async (url, options = {}) => {
      if (url.endsWith("/api/v3/access/token")) return json(200, { access_token: `token-${++tokens}`, expires_in: 3600 });
      authHeaders.push(options.headers.Authorization);
      return options.headers.Authorization === "Bearer token-1" ? json(401, expiredToken) : json(200, { id: "pc-1", state: 1 });
    };

    const payment = await getTropipayPayment("pc-1");

    assert.equal(payment.id, "pc-1");
    assert.deepEqual(authHeaders, ["Bearer token-1", "Bearer token-2"]);
  });

  it("no reintenta indefinidamente si el token nuevo también es rechazado", async () => {
    let calls = 0;
    globalThis.fetch = async url => {
      if (url.endsWith("/api/v3/access/token")) return json(200, { access_token: "token-x", expires_in: 3600 });
      calls += 1;
      return json(401, expiredToken);
    };

    await assert.rejects(getTropipayPayment("pc-2"), error => error.status === 401);
    assert.equal(calls, 2);
  });

  it("no reintenta errores que no son de autenticación", async () => {
    let calls = 0;
    globalThis.fetch = async url => {
      if (url.endsWith("/api/v3/access/token")) return json(200, { access_token: "token-y", expires_in: 3600 });
      calls += 1;
      return json(400, { error: { code: "INVALID_PARAM" } });
    };

    await assert.rejects(getTropipayPayment("pc-3"), error => error.status === 400);
    assert.equal(calls, 1);
  });
});

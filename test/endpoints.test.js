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

describe("admin endpoint surface", () => {
  it("exposes Supabase auth config for the dashboard", async () => {
    const response = await request("/api/auth/config");
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.auth, "backend");
  });

  it("requires a Supabase session for admin reads and writes", async () => {
    const protectedEndpoints = [
      ["GET", "/api/orders"],
      ["GET", "/api/chat/sessions"],
      ["GET", "/api/chat/sessions/test-chat-id/messages"],
      ["POST", "/api/chat/sessions/test-chat-id/reply"],
      ["PATCH", "/api/chat/sessions/test-chat-id/takeover"],
      ["PATCH", "/api/chat/sessions/test-chat-id/resolve"],
      ["PATCH", "/api/chat/sessions/test-chat-id/release"],
      ["DELETE", "/api/chat/sessions/test-chat-id"],
      ["GET", "/api/payments/pending"],
      ["PATCH", "/api/payments/test-payment-id/verify"],
      ["POST", "/api/combos-comida"],
      ["PUT", "/api/combos-comida/test-combo-id"],
      ["DELETE", "/api/combos-comida/test-combo-id"],
      ["POST", "/api/productos"],
      ["PUT", "/api/productos/test-product-id"],
      ["DELETE", "/api/productos/test-product-id"],
      ["POST", "/api/electrodomesticos"],
      ["PUT", "/api/electrodomesticos/test-electro-id"],
      ["DELETE", "/api/electrodomesticos/test-electro-id"]
    ];

    for (const [method, path] of protectedEndpoints) {
      const response = await request(path, { method });
      const body = await response.json();

      assert.equal(response.status, 401, `${method} ${path}`);
      assert.match(body.error, /Sesion requerida/i);
    }
  });

  it("rejects invalid orders with a controlled 400 response", async () => {
    const response = await request("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /item/i);
  });

  it("rejects payment uploads without a receipt image with a controlled 400 response", async () => {
    const bodyData = new FormData();
    bodyData.set("order_id", "missing-order");
    bodyData.set("method", "WellsFargoZelle");
    bodyData.set("amount", "10");

    const response = await request("/api/payments/upload", {
      method: "POST",
      body: bodyData
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /imagen|comprobante/i);
  });

  it("rejects chat messages without sessionId and message with a controlled 400 response", async () => {
    const response = await request("/api/chat/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /sessionId y message/i);
  });
});

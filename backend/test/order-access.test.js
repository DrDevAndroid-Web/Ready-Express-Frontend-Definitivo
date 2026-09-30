import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCIsImlzcyI6InN1cGFiYXNlIn0",
  "test-signature"
].join(".");
process.env.SUPABASE_ANON_KEY ||= "anon-key";

const { assertOrderAccess } = await import("../modules/orders/orders.service.js");

const order = { id: "o1", checkout_token: "tok-123", customer_id: "user-1" };

describe("assertOrderAccess — acceso a una orden", () => {
  it("permite con el checkout_token correcto", () => {
    assert.doesNotThrow(() => assertOrderAccess(order, { checkoutToken: "tok-123" }));
  });

  it("permite al cliente propietario", () => {
    assert.doesNotThrow(() => assertOrderAccess(order, { customerId: "user-1" }));
  });

  it("permite a un admin", () => {
    assert.doesNotThrow(() => assertOrderAccess(order, { isAdmin: true }));
  });

  it("rechaza sin credenciales con 404 (no revela que existe)", () => {
    assert.throws(() => assertOrderAccess(order, {}), err => err.status === 404);
  });

  it("rechaza un checkout_token incorrecto", () => {
    assert.throws(() => assertOrderAccess(order, { checkoutToken: "otro" }), err => err.status === 404);
  });

  it("rechaza a otro cliente registrado", () => {
    assert.throws(() => assertOrderAccess(order, { customerId: "user-2" }), err => err.status === 404);
  });

  it("una orden antigua sin checkout_token no se abre con token vacío", () => {
    assert.throws(() => assertOrderAccess({ id: "o2", checkout_token: null }, { checkoutToken: "" }), err => err.status === 404);
  });

  it("orden inexistente → 404", () => {
    assert.throws(() => assertOrderAccess(null, { isAdmin: true }), err => err.status === 404);
  });
});

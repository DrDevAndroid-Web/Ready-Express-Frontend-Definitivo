import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTropipayClient, missingTropipayClientFields } from "../modules/payments/providers/tropipay.provider.js";

const order = {
  sender_name: "Juan Perez Garcia",
  sender_first_name: "Juan",
  sender_last_name: "Perez Garcia",
  sender_phone: "+1 305 555 0101",
  customer_email: "juan@example.com",
  customer_address: "Calle 5 #12, Guantánamo",
  payer_details: { country_iso: "us", address: "123 Main St", city: "Miami", state: "FL", post_code: "33101", terms_accepted_at: "2026-09-23T10:00:00.000Z" }
};

describe("buildTropipayClient — objeto client de TropiPay", () => {
  it("usa los datos del pagador, no la dirección del receptor en Cuba", () => {
    const client = buildTropipayClient(order);
    assert.deepEqual(client, {
      name: "Juan",
      lastName: "Perez Garcia",
      email: "juan@example.com",
      phone: "+1 305 555 0101",
      address: "123 Main St",
      countryIso: "US",
      termsAndConditions: true,
      city: "Miami",
      state: "FL",
      postCode: "33101"
    });
    assert.deepEqual(missingTropipayClientFields(client), []);
  });

  it("omite los campos opcionales vacíos", () => {
    const client = buildTropipayClient({ ...order, payer_details: { ...order.payer_details, state: null, post_code: null } });
    assert.equal("state" in client, false);
    assert.equal("postCode" in client, false);
  });

  it("divide sender_name en órdenes antiguas sin nombre/apellidos separados", () => {
    const client = buildTropipayClient({ ...order, sender_first_name: null, sender_last_name: null });
    assert.equal(client.name, "Juan");
    assert.equal(client.lastName, "Perez Garcia");
  });

  it("no inventa email ni país: una orden sin datos del pagador queda incompleta", () => {
    const client = buildTropipayClient({ sender_name: "Juan", sender_phone: "1" });
    assert.equal(client.email, "");
    assert.equal(client.countryIso, "");
    assert.deepEqual(missingTropipayClientFields(client), ["apellidos", "email", "direccion", "pais", "aceptacion de terminos"]);
  });
});

describe("webhookAmountMatches — importe del aviso de TropiPay", async () => {
  process.env.SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "x.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.y";
  process.env.SUPABASE_ANON_KEY ||= "anon-key";
  const { webhookAmountMatches } = await import("../modules/payments/tropipay.service.js");

  it("acepta el importe en centavos", () => assert.equal(webhookAmountMatches(5700, 57), true));
  it("acepta el importe en unidades", () => assert.equal(webhookAmountMatches("57.00", 57), true));
  it("rechaza un importe menor", () => assert.equal(webhookAmountMatches(100, 57), false));
  it("rechaza un importe ausente", () => assert.equal(webhookAmountMatches(undefined, 57), false));
});

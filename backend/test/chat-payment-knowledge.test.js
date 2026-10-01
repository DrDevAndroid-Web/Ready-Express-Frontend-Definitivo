import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCIsImlzcyI6InN1cGFiYXNlIn0",
  "test-signature"
].join(".");
process.env.SUPABASE_ANON_KEY ||= "anon-key";
process.env.CHAT_AI_API_KEY ||= "test-key";

const { buildCheckoutPrompt, callAI, CARD_PAYMENT_KNOWLEDGE } = await import("../modules/chat/chat.service.js");

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

// Captura el prompt de sistema que se envía a la IA sin llamar al proveedor real
async function captureSystemPrompt(productContext, checkoutContext = null) {
  let systemPrompt = "";
  globalThis.fetch = async (_url, options) => {
    systemPrompt = JSON.parse(options.body).messages[0].content;
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  };
  await callAI([{ role: "user", content: "¿Puedo pagar con tarjeta?" }], productContext, checkoutContext);
  return systemPrompt;
}

describe("agente de IA — pago con tarjeta", () => {
  it("el conocimiento cubre tarjeta, cuenta obligatoria, rechazo y recuperación de contraseña", () => {
    for (const fact of ["Tarjeta de débito o crédito", "Visa y Mastercard", "TropiPay", "iniciar sesión", "Crear cuenta gratis", "no se cobra", "3D Secure", "Reintentar pago", "¿Olvidaste tu contraseña?"]) {
      assert.ok(CARD_PAYMENT_KNOWLEDGE.includes(fact), `falta: ${fact}`);
    }
  });

  it("las reglas ya no dicen que las tarjetas no se aceptan y prohíben pedir datos de tarjeta", async () => {
    const prompt = await captureSystemPrompt("DATOS");
    assert.doesNotMatch(prompt, /restricciones bancarias/i);
    assert.match(prompt, /SÍ se aceptan/);
    assert.match(prompt, /NUNCA pidas ni aceptes números de tarjeta/);
  });

  it("en el checkout describe la tarjeta como pago en línea que requiere sesión", () => {
    const prompt = buildCheckoutPrompt({
      step: "payment",
      cartTotal: 57,
      selectedPaymentMethod: "Tarjeta de débito o crédito",
      selectedPaymentFlow: "tropipay",
      availablePaymentMethods: [{ name: "Tarjeta de débito o crédito", flow: "tropipay" }, { name: "Zelle", flow: "proof_upload" }]
    });
    assert.match(prompt, /- Tarjeta de débito o crédito \(pago en línea con tarjeta; requiere iniciar sesión\)/);
    assert.match(prompt, /- Zelle \(pago directo con comprobante\)/);
  });
});

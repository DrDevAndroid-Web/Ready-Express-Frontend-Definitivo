import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCIsImlzcyI6InN1cGFiYXNlIn0",
  "test-signature"
].join(".");
process.env.SUPABASE_ANON_KEY ||= "anon-key";

const { canReceive } = await import("../modules/notifications/notifications.service.js");

describe("canReceive — filtro de eventos SSE", () => {
  const admin = { admin: true, chatSessionId: null };
  const customer = { admin: false, chatSessionId: "chat-a" };

  it("el admin recibe todos los eventos", () => {
    assert.equal(canReceive(admin, "payment_received", { paymentId: 1 }), true);
    assert.equal(canReceive(admin, "chat_client_message", { sessionId: "chat-b" }), true);
  });

  it("el cliente recibe las respuestas del admin de su propia sesión", () => {
    assert.equal(canReceive(customer, "chat_admin_reply", { sessionId: "chat-a" }), true);
  });

  it("el cliente NO recibe respuestas de otra sesión", () => {
    assert.equal(canReceive(customer, "chat_admin_reply", { sessionId: "chat-b" }), false);
  });

  it("el cliente NO recibe eventos de pagos ni órdenes", () => {
    assert.equal(canReceive(customer, "payment_received", { sessionId: "chat-a" }), false);
    assert.equal(canReceive(customer, "order_created", { orderId: 1 }), false);
  });

  it("el cliente NO recibe mensajes de otros clientes aunque coincida la sesión", () => {
    assert.equal(canReceive(customer, "chat_client_message", { sessionId: "chat-a" }), false);
  });

  it("un cliente sin chatSessionId no recibe nada", () => {
    assert.equal(canReceive({ admin: false, chatSessionId: null }, "chat_admin_reply", { sessionId: undefined }), false);
  });
});

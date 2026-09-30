import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCIsImlzcyI6InN1cGFiYXNlIn0",
  "test-signature"
].join(".");
process.env.SUPABASE_ANON_KEY ||= "anon-key";
// Claves ficticias solo para firmar webhooks simulados en este proceso
process.env.TROPIPAY_API_KEY = "test-api-key";
process.env.TROPIPAY_API_SECRET = "test-api-secret";

const { getTropipayStatus, processTropipayWebhook } = await import("../modules/payments/tropipay.service.js");

const TX_ID = "tx-1";
const OWNER = "user-1";
const TOKEN = "tok-123";

// Dobles en memoria: ninguna prueba toca Supabase, TropiPay ni la impresora
function setup({ txStatus = "pending", order = {}, paymentcard = { state: 1, amount: 2500, paymentInfo: { paid: false, paymentsCount: 0 } }, cardError = null } = {}) {
  const state = {
    tx: { id: TX_ID, order_id: "o1", status: txStatus, amount: 25, currency: "USD", external_reference: "REN-1", provider_payment_id: "card-1", payment_url: "https://tpp.me/abc", raw_payload: { secreto: true } },
    order: { id: "o1", checkout_token: TOKEN, customer_id: OWNER, order_reference: "REN-1", total: 25, status: "pending", payment_status: "processing", printed_at: null, ...order },
    events: [],
    cardCalls: 0,
    printed: 0,
    notified: 0,
    notifications: []
  };
  const deps = {
    paymentRepository: {
      async findById(id) {
        if (id !== state.tx.id) throw Object.assign(new Error("No se pudo consultar el pago"), { status: 404 });
        return { ...state.tx, orders: { ...state.order } };
      },
      async findByProviderReference() { return { ...state.tx }; },
      async updatePayment(_id, updates) { Object.assign(state.tx, updates); return { ...state.tx }; }
    },
    paymentEventRepository: {
      async exists(id, type) { return state.events.some(e => e.payment_transaction_id === id && e.event_type === type); },
      // Imita el índice único de idempotency_key
      async record(payload) {
        if (state.events.some(e => e.idempotency_key === payload.idempotency_key)) return null;
        state.events.push(payload);
        return payload;
      }
    },
    orderRepository: {
      async findPrintState() { return { ...state.order }; },
      async updatePaymentState(_id, paymentStatus, status) { Object.assign(state.order, { payment_status: paymentStatus, status }); },
      async markPrinted() { state.order.printed_at = new Date().toISOString(); }
    },
    async getTropipayPayment() {
      state.cardCalls++;
      if (cardError) throw cardError;
      return paymentcard;
    },
    async notifyConfirmedOrder() { state.notified++; },
    async printOrder() { state.printed++; },
    notify(type) { state.notifications.push(type); }
  };
  return { state, deps };
}

const owner = { customerId: OWNER };

function signedWebhook({ status = "OK", amount = 2500 } = {}) {
  const bankOrderCode = "BANK-1";
  const secretHash = createHash("sha1").update(process.env.TROPIPAY_API_SECRET).digest("hex");
  const signaturev3 = createHash("sha256").update(`${bankOrderCode}${process.env.TROPIPAY_API_KEY}${secretHash}${amount}`).digest("hex");
  return { status, data: { reference: "REN-1", paymentcardId: "card-1", bankOrderCode, originalCurrencyAmount: amount, signaturev3 } };
}

describe("GET estado TropiPay — respuesta saneada", () => {
  it("devuelve solo los campos públicos, sin raw_payload ni datos de la orden", async () => {
    const { deps } = setup();
    const result = await getTropipayStatus(TX_ID, owner, deps);
    assert.deepEqual(Object.keys(result).sort(), ["can_retry", "currency", "order_reference", "order_status", "retry_url", "status", "total"]);
    assert.equal(result.order_reference, "REN-1");
    assert.equal(result.total, 25);
    assert.ok(!JSON.stringify(result).includes(TOKEN));
    assert.ok(!JSON.stringify(result).includes("secreto"));
  });
});

describe("GET estado TropiPay — permisos", () => {
  it("permite al dueño por sesión", async () => {
    const { deps } = setup();
    await assert.doesNotReject(getTropipayStatus(TX_ID, { customerId: OWNER }, deps));
  });

  it("permite con el checkout_token de la orden", async () => {
    const { deps } = setup();
    await assert.doesNotReject(getTropipayStatus(TX_ID, { checkoutToken: TOKEN }, deps));
  });

  it("permite a un admin", async () => {
    const { deps } = setup();
    await assert.doesNotReject(getTropipayStatus(TX_ID, { isAdmin: true }, deps));
  });

  it("rechaza a otro cliente con 404 y sin consultar TropiPay", async () => {
    const { state, deps } = setup();
    await assert.rejects(getTropipayStatus(TX_ID, { customerId: "user-2" }, deps), err => err.status === 404);
    assert.equal(state.cardCalls, 0);
  });

  it("rechaza un checkout_token incorrecto con 404", async () => {
    const { deps } = setup();
    await assert.rejects(getTropipayStatus(TX_ID, { checkoutToken: "otro" }, deps), err => err.status === 404);
  });

  it("pago inexistente → 404", async () => {
    const { deps } = setup();
    await assert.rejects(getTropipayStatus("no-existe", { isAdmin: true }, deps), err => err.status === 404);
  });
});

describe("GET estado TropiPay — conciliación con la API", () => {
  it("enlace activo y sin pagar: sigue pendiente y ofrece reutilizar el enlace", async () => {
    const { state, deps } = setup();
    const result = await getTropipayStatus(TX_ID, owner, deps);
    assert.equal(result.status, "pending");
    assert.equal(result.can_retry, true);
    assert.equal(result.retry_url, "https://tpp.me/abc");
    assert.equal(state.printed, 0);
    assert.equal(state.events.length, 0);
  });

  it("pagado con el importe correcto: confirma, avisa e imprime una vez", async () => {
    const { state, deps } = setup({ paymentcard: { state: 1, amount: 2500, paymentInfo: { paid: true, paymentsCount: 1 } } });
    const result = await getTropipayStatus(TX_ID, owner, deps);
    assert.equal(result.status, "successful");
    assert.equal(result.order_status, "paid");
    assert.equal(result.can_retry, false);
    assert.equal(result.retry_url, undefined);
    assert.equal(state.printed, 1);
    assert.equal(state.notified, 1);
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].event_type, "payment_successful");
    assert.equal(state.events[0].payload.source, "poll");
    assert.equal(state.events[0].signature_verified, false);
  });

  it("pagado con otro importe: no marca la orden como pagada", async () => {
    const { state, deps } = setup({ paymentcard: { state: 1, amount: 2000, paymentInfo: { paid: true } } });
    const result = await getTropipayStatus(TX_ID, owner, deps);
    assert.notEqual(result.status, "successful");
    assert.notEqual(state.order.status, "paid");
    assert.equal(state.printed, 0);
    assert.ok(state.notifications.includes("payment_amount_mismatch"));
  });

  it("solo confirma con paid === true (no con valores parecidos)", async () => {
    const { state, deps } = setup({ paymentcard: { state: 1, amount: 2500, paymentInfo: { paid: "true", paymentsCount: 1 } } });
    const result = await getTropipayStatus(TX_ID, owner, deps);
    assert.equal(result.status, "pending");
    assert.equal(state.printed, 0);
  });

  it("si TropiPay no responde: devuelve el estado guardado sin enlace de reintento", async () => {
    const { state, deps } = setup({ cardError: new Error("timeout") });
    const result = await getTropipayStatus(TX_ID, owner, deps);
    assert.equal(result.status, "pending");
    assert.equal(result.can_retry, true);
    assert.equal(result.retry_url, undefined);
    assert.equal(state.printed, 0);
  });

  it("enlace inactivo: no ofrece reutilizarlo", async () => {
    const { deps } = setup({ paymentcard: { state: 2, amount: 2500, paymentInfo: { paid: false } } });
    const result = await getTropipayStatus(TX_ID, owner, deps);
    assert.equal(result.can_retry, true);
    assert.equal(result.retry_url, undefined);
  });

  it("pago ya confirmado: no vuelve a consultar TropiPay", async () => {
    const { state, deps } = setup({ txStatus: "successful", order: { status: "paid", payment_status: "successful" } });
    const result = await getTropipayStatus(TX_ID, owner, deps);
    assert.equal(state.cardCalls, 0);
    assert.equal(result.can_retry, false);
  });

  it("pago fallido: se puede reintentar, pero sin reutilizar el enlace", async () => {
    const { state, deps } = setup({ txStatus: "failed", order: { status: "payment_rejected", payment_status: "failed" } });
    const result = await getTropipayStatus(TX_ID, owner, deps);
    assert.equal(state.cardCalls, 0);
    assert.equal(result.can_retry, true);
    assert.equal(result.retry_url, undefined);
  });

  it("orden cancelada: no se puede reintentar", async () => {
    const { deps } = setup({ order: { status: "cancelled" } });
    const result = await getTropipayStatus(TX_ID, owner, deps);
    assert.equal(result.can_retry, false);
    assert.equal(result.retry_url, undefined);
  });
});

describe("Conciliación y webhook — idempotencia", () => {
  const paid = { state: 1, amount: 2500, paymentInfo: { paid: true, paymentsCount: 1 } };

  it("conciliación primero y webhook después: una sola impresión y un solo aviso", async () => {
    const { state, deps } = setup({ paymentcard: paid });
    await getTropipayStatus(TX_ID, owner, deps);
    const webhook = await processTropipayWebhook(signedWebhook(), deps);
    assert.equal(webhook.reason, "ALREADY_PROCESSED");
    assert.equal(state.printed, 1);
    assert.equal(state.notified, 1);
  });

  it("webhook primero y conciliación después: no vuelve a procesar", async () => {
    const { state, deps } = setup({ paymentcard: paid });
    const webhook = await processTropipayWebhook(signedWebhook(), deps);
    assert.equal(webhook.processed, true);
    const result = await getTropipayStatus(TX_ID, owner, deps);
    assert.equal(result.status, "successful");
    assert.equal(state.cardCalls, 0);
    assert.equal(state.printed, 1);
  });

  it("webhook y conciliación a la vez: una sola impresión", async () => {
    const { state, deps } = setup({ paymentcard: paid });
    await Promise.all([
      getTropipayStatus(TX_ID, owner, deps),
      processTropipayWebhook(signedWebhook(), deps)
    ]);
    assert.equal(state.printed, 1);
    assert.equal(state.notified, 1);
    assert.equal(state.events.filter(e => e.event_type === "payment_successful").length, 1);
  });

  it("webhook con firma inválida: no procesa nada", async () => {
    const { state, deps } = setup();
    const payload = signedWebhook();
    payload.data.signaturev3 = "0".repeat(64);
    const result = await processTropipayWebhook(payload, deps);
    assert.equal(result.reason, "INVALID_SIGNATURE");
    assert.equal(state.events.length, 0);
  });

  it("webhook KO tras un pago confirmado: no deja la orden como rechazada", async () => {
    const { state, deps } = setup({ paymentcard: paid });
    await getTropipayStatus(TX_ID, owner, deps);
    const result = await processTropipayWebhook(signedWebhook({ status: "KO" }), deps);
    assert.equal(result.reason, "ALREADY_PAID");
    assert.equal(state.order.status, "paid");
  });

  it("webhook KO sobre un pago abierto: lo marca como rechazado", async () => {
    const { state, deps } = setup();
    const result = await processTropipayWebhook(signedWebhook({ status: "KO" }), deps);
    assert.equal(result.status, "failed");
    assert.equal(state.order.status, "payment_rejected");
    assert.equal(state.printed, 0);
  });
});

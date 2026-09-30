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

const { createTropipayPaymentForOrder, getTropipayStatus, processTropipayWebhook, retryTropipayPayment } = await import("../modules/payments/tropipay.service.js");
const { resolveReturnBase } = await import("../modules/payments/providers/tropipay.provider.js");

const OPEN = new Set(["pending", "processing"]);
const TX_ID = "tx-1";
const OWNER = "user-1";
const TOKEN = "tok-123";

// Dobles en memoria: ninguna prueba toca Supabase, TropiPay ni la impresora
function setup({ txStatus = "pending", order = {}, paymentcard = { state: 1, amount: 2500, paymentInfo: { paid: false, paymentsCount: 0 } }, cardError = null } = {}) {
  const state = {
    tx: { id: TX_ID, order_id: "o1", status: txStatus, amount: 25, currency: "USD", external_reference: "REN-1", provider_payment_id: "card-1", payment_url: "https://tpp.me/abc", raw_payload: { secreto: true } },
    order: {
      id: "o1", checkout_token: TOKEN, customer_id: OWNER, order_reference: "REN-1", total: 25, status: "pending", payment_status: "processing", printed_at: null,
      sender_first_name: "Ana", sender_last_name: "Pérez", customer_email: "ana@example.com", sender_phone: "+15550001",
      payer_details: { address: "Calle 1", country_iso: "US", terms_accepted_at: "2026-09-01T00:00:00Z" },
      ...order
    },
    created: [],
    links: [],
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
      async findOrderById() { return { ...state.order }; },
      async findPendingByOrder() { return OPEN.has(state.tx.status) ? { ...state.tx } : null; },
      async countByOrder() { return 1 + state.created.length; },
      async findByProviderReference() { return { ...state.tx }; },
      async createPayment(payload) {
        const row = { id: `tx-${2 + state.created.length}`, ...payload };
        state.created.push(row);
        return row;
      },
      async updatePayment(id, updates) {
        const row = id === state.tx.id ? state.tx : state.created.find(r => r.id === id);
        Object.assign(row, updates);
        return { ...row };
      }
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
      async findCustomerBilling() { return state.profile || null; },
      async updatePayerDetails(_id, payerDetails) { state.order.payer_details = payerDetails; },
      async findPrintState() { return { ...state.order }; },
      async updatePaymentState(_id, paymentStatus, status) { Object.assign(state.order, { payment_status: paymentStatus, status }); },
      async markPrinted() { state.order.printed_at = new Date().toISOString(); }
    },
    async createTropipayPayment({ order, reference, returnOrigin }) {
      state.links.push({ reference, returnOrigin, payer: order.payer_details });
      return { id: `card-${1 + state.links.length}`, shortUrl: `https://tpp.me/new-${state.links.length}` };
    },
    warmTropipayToken() {},
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
    assert.deepEqual(Object.keys(result).sort(), ["can_retry", "currency", "order_id", "order_reference", "order_status", "retry_url", "status", "total"]);
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

  it("pago rechazado con el enlace aún activo: ofrece reutilizarlo", async () => {
    const { state, deps } = setup({ txStatus: "failed", order: { status: "payment_rejected", payment_status: "failed" } });
    const result = await getTropipayStatus(TX_ID, owner, deps);
    assert.equal(state.cardCalls, 1);
    assert.equal(result.can_retry, true);
    assert.equal(result.retry_url, "https://tpp.me/abc");
  });

  it("pago cuyo enlace no llegó a crearse: se puede reintentar sin consultar TropiPay", async () => {
    const { state, deps } = setup({ txStatus: "failed" });
    state.tx.provider_payment_id = null;
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

describe("POST reintento TropiPay", () => {
  it("enlace activo y sin pagar: devuelve el mismo enlace sin crear otro", async () => {
    const { state, deps } = setup();
    const result = await retryTropipayPayment(TX_ID, owner, deps);
    assert.deepEqual(result, { payment_id: TX_ID, payment_url: "https://tpp.me/abc", reused: true });
    assert.equal(state.links.length, 0);
  });

  it("tras un rechazo con el enlace activo: lo reutiliza y reabre la orden", async () => {
    const { state, deps } = setup({ txStatus: "failed", order: { status: "payment_rejected", payment_status: "failed" } });
    const result = await retryTropipayPayment(TX_ID, owner, deps);
    assert.equal(result.reused, true);
    assert.equal(state.tx.status, "pending");
    assert.equal(state.order.status, "pending");
    assert.equal(state.order.payment_status, "processing");
  });

  it("enlace caducado: cierra el anterior y crea otro para la misma orden con referencia -R2", async () => {
    const { state, deps } = setup({ paymentcard: { state: 2, amount: 2500, paymentInfo: { paid: false } } });
    const result = await retryTropipayPayment(TX_ID, owner, deps);
    assert.equal(result.reused, false);
    assert.equal(result.payment_url, "https://tpp.me/new-1");
    assert.equal(state.tx.status, "cancelled");
    assert.equal(state.links[0].reference, "REN-1-R2");
    assert.equal(state.created[0].order_id, "o1");
    assert.equal(state.created[0].amount, 25);
  });

  it("enlace que no llegó a crearse: crea uno nuevo", async () => {
    const { state, deps } = setup({ txStatus: "failed" });
    state.tx.provider_payment_id = null;
    const result = await retryTropipayPayment(TX_ID, owner, deps);
    assert.equal(result.reused, false);
    assert.equal(state.links.length, 1);
  });

  it("orden ya pagada → 409", async () => {
    const { state, deps } = setup({ txStatus: "successful", order: { status: "paid", payment_status: "successful" } });
    await assert.rejects(retryTropipayPayment(TX_ID, owner, deps), err => err.status === 409);
    assert.equal(state.links.length, 0);
  });

  it("pagada en TropiPay pero sin webhook: la concilia y responde 409 sin crear otro enlace", async () => {
    const { state, deps } = setup({ paymentcard: { state: 1, amount: 2500, paymentInfo: { paid: true } } });
    await assert.rejects(retryTropipayPayment(TX_ID, owner, deps), err => err.status === 409);
    assert.equal(state.order.status, "paid");
    assert.equal(state.links.length, 0);
  });

  it("orden cancelada → 409", async () => {
    const { deps } = setup({ order: { status: "cancelled" } });
    await assert.rejects(retryTropipayPayment(TX_ID, owner, deps), err => err.status === 409);
  });

  it("TropiPay no responde: 503 y no abre un segundo enlace", async () => {
    const { state, deps } = setup({ cardError: new Error("timeout") });
    await assert.rejects(retryTropipayPayment(TX_ID, owner, deps), err => err.status === 503);
    assert.equal(state.links.length, 0);
  });

  it("otro cliente → 404", async () => {
    const { state, deps } = setup();
    await assert.rejects(retryTropipayPayment(TX_ID, { customerId: "user-2" }, deps), err => err.status === 404);
    assert.equal(state.cardCalls, 0);
  });
});

describe("Crear pago TropiPay — acceso", () => {
  it("el dueño con sesión puede pagar sin checkout_token (primer intento: referencia de la orden)", async () => {
    const { state, deps } = setup({ txStatus: "cancelled" });
    deps.paymentRepository.countByOrder = async () => 0;
    const result = await createTropipayPaymentForOrder({ orderId: "o1", customerId: OWNER }, deps);
    assert.equal(result.payment_url, "https://tpp.me/new-1");
    assert.equal(state.links[0].reference, "REN-1");
  });

  it("si un intento anterior falló, el nuevo enlace lleva sufijo y no choca con la referencia única", async () => {
    const { state, deps } = setup({ txStatus: "failed" });
    await createTropipayPaymentForOrder({ orderId: "o1", customerId: OWNER }, deps);
    assert.equal(state.links[0].reference, "REN-1-R2");
  });

  it("otro cliente sin token → 404", async () => {
    const { deps } = setup({ txStatus: "cancelled" });
    await assert.rejects(createTropipayPaymentForOrder({ orderId: "o1", customerId: "user-2" }, deps), err => err.status === 404);
  });

  it("orden pagada → 409", async () => {
    const { deps } = setup({ txStatus: "successful", order: { status: "paid", payment_status: "successful" } });
    await assert.rejects(createTropipayPaymentForOrder({ orderId: "o1", checkoutToken: TOKEN }, deps), err => err.status === 409);
  });
});

describe("URLs de retorno según el entorno", () => {
  it("usa la carpeta de la página de origen si su dominio está en CORS_ORIGINS", () => {
    process.env.CORS_ORIGINS = "https://www.readyexpressnow.com, https://preview.vercel.app";
    assert.equal(resolveReturnBase("https://preview.vercel.app/checkout.html"), "https://preview.vercel.app");
    assert.equal(resolveReturnBase("https://preview.vercel.app/frontend/"), "https://preview.vercel.app/frontend");
    assert.equal(resolveReturnBase("https://preview.vercel.app"), "https://preview.vercel.app");
  });

  it("localhost o http vuelven a FRONTEND_PUBLIC_URL (TropiPay las rechaza)", () => {
    process.env.CORS_ORIGINS = "http://localhost:5173, https://localhost:5173";
    process.env.FRONTEND_PUBLIC_URL = "https://www.readyexpressnow.com";
    assert.equal(resolveReturnBase("http://localhost:5173/checkout.html"), "https://www.readyexpressnow.com");
    assert.equal(resolveReturnBase("https://localhost:5173/checkout.html"), "https://www.readyexpressnow.com");
  });

  it("un dominio que no está en CORS_ORIGINS vuelve a FRONTEND_PUBLIC_URL", () => {
    process.env.CORS_ORIGINS = "http://localhost:5500";
    process.env.FRONTEND_PUBLIC_URL = "https://www.readyexpressnow.com/";
    assert.equal(resolveReturnBase("https://evil.example/phish/"), "https://www.readyexpressnow.com");
    assert.equal(resolveReturnBase("no es una url"), "https://www.readyexpressnow.com");
    assert.equal(resolveReturnBase(null), "https://www.readyexpressnow.com");
  });
});

describe("Reintento de pedidos antiguos — datos del pagador desde el perfil", () => {
  const profile = { pais_iso: "ES", direccion_facturacion: "Otra 2", ciudad: "Madrid", estado_region: null, codigo_postal: "28001", fecha_nacimiento: "1985-05-05", terminos_tropipay_at: "2026-09-30T00:00:00Z" };

  it("completa fecha de nacimiento y código postal que faltan, sin pisar lo que tiene la orden", async () => {
    const { state, deps } = setup({ txStatus: "failed" });
    state.tx.provider_payment_id = null;
    state.profile = profile;
    await retryTropipayPayment(TX_ID, owner, deps);
    const payer = state.links[0].payer;
    assert.equal(payer.birth_date, "1985-05-05");
    assert.equal(payer.post_code, "28001");
    assert.equal(payer.country_iso, "US");
    assert.equal(payer.address, "Calle 1");
    assert.equal(state.order.payer_details.birth_date, "1985-05-05");
  });

  it("también al crear el pago desde el checkout o Mi cuenta", async () => {
    const { state, deps } = setup({ txStatus: "cancelled" });
    state.profile = profile;
    await createTropipayPaymentForOrder({ orderId: "o1", customerId: OWNER }, deps);
    assert.equal(state.links[0].payer.birth_date, "1985-05-05");
  });

  it("sin perfil con facturación: el enlace se crea con lo que tenga la orden", async () => {
    const { state, deps } = setup({ txStatus: "failed" });
    state.tx.provider_payment_id = null;
    await retryTropipayPayment(TX_ID, owner, deps);
    assert.equal(state.links[0].payer.birth_date, undefined);
    assert.equal(state.links.length, 1);
  });

  it("orden completa: no consulta el perfil", async () => {
    const { state, deps } = setup({ txStatus: "failed" });
    state.tx.provider_payment_id = null;
    Object.assign(state.order.payer_details, { city: "Miami", state: "FL", post_code: "33101", birth_date: "1990-01-15" });
    let consulted = false;
    deps.orderRepository.findCustomerBilling = async () => { consulted = true; return profile; };
    await retryTropipayPayment(TX_ID, owner, deps);
    assert.equal(consulted, false);
  });
});

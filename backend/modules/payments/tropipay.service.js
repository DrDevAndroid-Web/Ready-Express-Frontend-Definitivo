import { createHash, timingSafeEqual } from "node:crypto";
import { createBadRequest, createConflict, createNotFound, HttpError } from "../../utils/http-error.js";
import { classifyCreateFailure, describeDecline, minAmountMessage, paymentError, toTropipayHttpError, tropipayMinAmount } from "./tropipay-errors.js";
import { buildTropipayClient, createTropipayPayment, getTropipayPayment, missingTropipayClientFields, warmTropipayToken } from "./providers/tropipay.provider.js";
import { assertOrderAccess, notifyConfirmedOrder, printOrder } from "../orders/orders.service.js";
import { NotificationManager } from "../notifications/notifications.service.js";
import * as paymentRepository from "./adapters/supabase-payment.repository.js";
import * as paymentEventRepository from "./adapters/supabase-payment-event.repository.js";
import * as orderRepository from "./adapters/supabase-order.repository.js";
import { qualifyReferralForOrder } from "../referrals/referral.qualification.service.js";

// Dependencias de los casos de uso; los tests las sustituyen por dobles
const defaultDeps = {
  paymentRepository,
  paymentEventRepository,
  orderRepository,
  createTropipayPayment,
  getTropipayPayment,
  warmTropipayToken,
  notifyConfirmedOrder,
  printOrder,
  qualifyReferralForOrder,
  notify: (type, data) => NotificationManager.sendNotification(type, data)
};

// Estados en los que el pago aún puede completarse (un rechazo de tarjeta no cierra el enlace)
const RETRYABLE_STATUSES = new Set(["pending", "processing", "failed"]);

export async function createTropipayPaymentForOrder({ orderId, checkoutToken = null, customerId = null, returnOrigin = null }, deps = defaultDeps) {
  deps.warmTropipayToken();
  // Consultas independientes en paralelo: cada ida y vuelta a Supabase cuesta 200-500 ms
  const [storedOrder, existing] = await Promise.all([
    deps.paymentRepository.findOrderById(orderId),
    deps.paymentRepository.findPendingByOrder(orderId)
  ]);
  // Quien creó la orden (checkout_token) o su cliente registrado
  assertOrderAccess(storedOrder, { checkoutToken, customerId });
  const order = await completePayerFromProfile(storedOrder, deps);
  assertPayableWithTropipay(order);

  if (existing?.payment_url) return existing;
  // La referencia es única por enlace: si un intento anterior falló, el nuevo lleva sufijo
  const attempts = await deps.paymentRepository.countByOrder(order.id);
  const reference = attempts ? `${order.order_reference}-R${attempts + 1}` : order.order_reference;
  return openTropipayLink(order, { reference, customerId, returnOrigin }, deps);
}

// Pedidos anteriores a los datos de facturación en el registro no guardan fecha de
// nacimiento (y a veces tampoco código postal): se completan con el perfil del cliente
// para que TropiPay no tenga que pedirlos en la pasarela. Lo que ya tiene la orden manda.
const PAYER_FROM_PROFILE = {
  country_iso: "pais_iso",
  address: "direccion_facturacion",
  city: "ciudad",
  state: "estado_region",
  post_code: "codigo_postal",
  birth_date: "fecha_nacimiento",
  terms_accepted_at: "terminos_tropipay_at"
};

async function completePayerFromProfile(order, deps) {
  const current = order.payer_details || {};
  const missing = Object.keys(PAYER_FROM_PROFILE).filter(key => !current[key]);
  if (!order.customer_id || !missing.length) return order;

  const profile = await deps.orderRepository.findCustomerBilling(order.customer_id).catch(error => {
    console.warn("[tropipay] No se pudo leer la facturación del perfil:", error?.message || error);
    return null;
  });
  const filled = Object.fromEntries(missing.map(key => [key, profile?.[PAYER_FROM_PROFILE[key]]]).filter(([, value]) => value));
  if (!Object.keys(filled).length) return order;

  const payerDetails = { ...current, ...filled };
  await deps.orderRepository.updatePayerDetails(order.id, payerDetails);
  return { ...order, payer_details: payerDetails };
}

function assertPayableWithTropipay(order) {
  if (!order.order_reference) throw createBadRequest("La orden no tiene order_reference; ejecuta la migración y vuelve a crearla");
  if (order.status === "paid" || order.payment_status === "successful") throw createConflict("La orden ya está pagada");
  if (order.status === "cancelled") throw createConflict("La orden está cancelada");
  const missing = missingTropipayClientFields(buildTropipayClient(order));
  if (missing.length) throw paymentError(422, "CARD_PAYER_DATA", `Faltan datos de facturación para pagar con tarjeta: ${missing.join(", ")}. Complétalos en Mi cuenta → Perfil e inténtalo de nuevo.`, { missing });
  // Se comprueba antes de abrir la transacción: TropiPay lo rechazaría con TOO_LOW_AMOUNT
  if (Number(order.total) < tropipayMinAmount()) throw paymentError(422, "CARD_MIN_AMOUNT", minAmountMessage(), { min_amount: tropipayMinAmount() });
}

// Crea la transacción y su enlace en TropiPay. `reference` es la referencia única
// del enlace (la orden en el primer intento; con sufijo -R<n> en los siguientes).
async function openTropipayLink(order, { reference, customerId = null, returnOrigin = null }, deps) {
  const transaction = await deps.paymentRepository.createPayment({ order_id: order.id, customer_id: customerId, provider: "tropipay", amount: order.total, currency: process.env.TROPIPAY_CURRENCY || "USD", status: "processing", external_reference: reference });

  try {
    const payment = await deps.createTropipayPayment({ order, transactionId: transaction.id, reference, returnOrigin });
    const [updated] = await Promise.all([
      deps.paymentRepository.updatePayment(transaction.id, { provider_payment_id: payment?.id || null, paymentcard_id: payment?.id || null, payment_url: payment?.shortUrl || payment?.paymentUrl || null, status: "pending", raw_payload: payment || null, updated_at: new Date().toISOString() }),
      deps.orderRepository.updatePaymentState(order.id, "processing", reopenedOrderStatus(order.status))
    ]);
    return updated;
  } catch (error) {
    await deps.paymentRepository.updatePayment(transaction.id, { status: "failed", raw_payload: { source: "create", provider: error.providerBody || null, message: error.message }, updated_at: new Date().toISOString() });
    // Con payment_id el frontend lleva al cliente a la página de reintento / otro método de esta misma orden
    const friendly = toTropipayHttpError(error);
    friendly.expose = { ...friendly.expose, payment_id: transaction.id, order_reference: order.order_reference || null };
    throw friendly;
  }
}

// Tras un rechazo la orden vuelve a esperar el pago
function reopenedOrderStatus(status) {
  return status === "payment_rejected" ? "pending" : status;
}

// Carga la transacción comprobando el acceso y, si el pago puede seguir abierto,
// consulta el enlace en TropiPay (la redirección suele llegar antes que el webhook,
// o el webhook no llega). Si consta pagado por el importe correcto, se confirma
// igual que con el webhook. Nunca se decide con lo que traiga la URL de retorno.
async function loadVerifiedTransaction(transactionId, access, deps) {
  let transaction = await deps.paymentRepository.findById(transactionId).catch(error => {
    if (error?.status === 404) return null;
    throw error;
  });
  // Sin acceso, 404: no revela qué pagos existen
  assertOrderAccess(transaction?.orders, access);

  const { paymentcard, providerUnavailable, confirmed } = await reconcileWithProvider(transaction, "poll", deps);
  if (confirmed) transaction = await deps.paymentRepository.findById(transactionId);
  return { transaction, paymentcard, providerUnavailable };
}

// Consulta el enlace en TropiPay si el pago sigue abierto y lo confirma si consta pagado.
// `source` queda en el evento: "poll" (página de retorno) o "reconcile" (revisión periódica).
async function reconcileWithProvider(transaction, source, deps) {
  if (!RETRYABLE_STATUSES.has(transaction.status) || !transaction.provider_payment_id || isPaid(transaction)) {
    return { paymentcard: null, providerUnavailable: false, confirmed: false };
  }

  let providerUnavailable = false;
  const paymentcard = await deps.getTropipayPayment(transaction.provider_payment_id).catch(error => {
    console.warn(`[tropipay:${source}] No se pudo consultar el enlace en TropiPay:`, error?.message || error);
    providerUnavailable = true;
    return null;
  });

  if (paymentcard?.paymentInfo?.paid !== true) return { paymentcard, providerUnavailable, confirmed: false };
  const result = await confirmTropipayPayment(transaction, {
    source,
    payload: { source, paymentcard },
    amount: paymentcard.amount
  }, deps);
  return { paymentcard, providerUnavailable, confirmed: true, result };
}

const RECONCILE_WINDOW_MS = 48 * 60 * 60_000;
// Margen para que el webhook o la página de retorno lleguen primero
const RECONCILE_MIN_AGE_MS = 2 * 60_000;
const STALE_LINK_MS = 15 * 60_000;

// Revisión periódica: confirma los pagos cobrados cuyo webhook no llegó (o falló al procesarse)
// y el cliente no volvió a la página de retorno, y cierra las transacciones sin enlace.
export async function reconcilePendingTropipayPayments(deps = defaultDeps, now = Date.now()) {
  const stale = await deps.paymentRepository.failStaleWithoutLink({ before: new Date(now - STALE_LINK_MS).toISOString() });
  const transactions = await deps.paymentRepository.findReconcilable({
    since: new Date(now - RECONCILE_WINDOW_MS).toISOString(),
    before: new Date(now - RECONCILE_MIN_AGE_MS).toISOString()
  });

  const summary = { checked: 0, confirmed: 0, unavailable: 0, closedWithoutLink: stale.length };
  // De uno en uno: son pocos y así no se satura la API de TropiPay
  for (const transaction of transactions) {
    summary.checked++;
    try {
      const { providerUnavailable, result } = await reconcileWithProvider(transaction, "reconcile", deps);
      if (providerUnavailable) summary.unavailable++;
      if (result?.processed) summary.confirmed++;
    } catch (error) {
      console.error("[tropipay:reconcile]", transaction.id, error?.message || error);
    }
  }
  return summary;
}

export async function getTropipayStatus(transactionId, access = {}, deps = defaultDeps) {
  const { transaction, paymentcard } = await loadVerifiedTransaction(transactionId, access, deps);
  return toPublicStatus(transaction, paymentcard);
}

// Reintento sobre la misma orden, sin carrito: reutiliza el enlace si TropiPay
// confirma que sigue activo y sin pagar; si caducó o no llegó a crearse, abre uno nuevo.
export async function retryTropipayPayment(transactionId, access = {}, deps = defaultDeps) {
  deps.warmTropipayToken();
  const { transaction, paymentcard, providerUnavailable } = await loadVerifiedTransaction(transactionId, access, deps);
  const order = transaction.orders || {};

  if (isPaid(transaction)) throw createConflict("La orden ya está pagada");
  if (order.status === "cancelled") throw createConflict("La orden está cancelada");
  if (!RETRYABLE_STATUSES.has(transaction.status)) throw createConflict("Este pago ya no se puede reintentar; escríbenos por WhatsApp");
  // Sin saber si el enlace anterior sigue vivo, abrir otro permitiría pagar dos veces
  if (providerUnavailable) throw new HttpError(503, "No pudimos verificar el pago con TropiPay; inténtalo de nuevo en unos minutos");

  if (isLinkActive(transaction, paymentcard)) {
    if (transaction.status === "failed") {
      await Promise.all([
        deps.paymentRepository.updatePayment(transaction.id, { status: "pending", updated_at: new Date().toISOString() }),
        deps.orderRepository.updatePaymentState(transaction.order_id, "processing", reopenedOrderStatus(order.status))
      ]);
    }
    return { payment_id: transaction.id, payment_url: transaction.payment_url, reused: true };
  }

  // Enlace caducado o que no llegó a crearse: se cierra y se abre otro para la misma orden
  const fullOrder = await completePayerFromProfile(await deps.paymentRepository.findOrderById(transaction.order_id), deps);
  assertPayableWithTropipay(fullOrder);
  const attempts = await deps.paymentRepository.countByOrder(transaction.order_id);
  await deps.paymentRepository.updatePayment(transaction.id, { status: "cancelled", updated_at: new Date().toISOString() });
  const replacement = await openTropipayLink(fullOrder, {
    reference: `${fullOrder.order_reference}-R${attempts + 1}`,
    customerId: transaction.customer_id || access.customerId || null,
    returnOrigin: access.returnOrigin || null
  }, deps);
  return { payment_id: replacement.id, payment_url: replacement.payment_url, reused: false };
}

function isPaid(transaction) {
  const order = transaction.orders || {};
  return transaction.status === "successful" || order.payment_status === "successful" || order.status === "paid";
}

// El enlace solo se reutiliza si TropiPay confirma que sigue activo (state 1) y sin pagar
function isLinkActive(transaction, paymentcard) {
  return RETRYABLE_STATUSES.has(transaction.status)
    && Boolean(transaction.payment_url)
    && Number(paymentcard?.state) === 1
    && paymentcard?.paymentInfo?.paid !== true;
}

// Motivo legible del fallo, sin exponer raw_payload: rechazo de la tarjeta (aviso KO de TropiPay),
// fallo al abrir el enlace o un importe que no cuadra y queda en revisión
export function publicFailure(transaction) {
  if (transaction.status === "amount_mismatch") {
    return { failure_code: "PAYMENT_REVIEW", failure_message: "Recibimos un pago con un importe distinto al del pedido y lo estamos revisando. No vuelvas a pagar: te escribiremos pronto." };
  }
  if (transaction.status !== "failed") return {};
  const raw = transaction.raw_payload || {};
  const failure = raw.status === "KO" ? describeDecline(raw) : classifyCreateFailure(raw.provider ?? raw);
  return { failure_code: failure.code, failure_message: failure.message };
}

// Solo lo que necesita la página de retorno: sin raw_payload ni datos de la orden
export function toPublicStatus(transaction, paymentcard = null) {
  const order = transaction.orders || {};
  const closed = isPaid(transaction) || order.status === "cancelled" || !RETRYABLE_STATUSES.has(transaction.status);

  return {
    status: transaction.status,
    // Para pagar la misma orden con otro método (la subida del comprobante vuelve a comprobar el acceso)
    order_id: transaction.order_id,
    order_reference: order.order_reference || transaction.external_reference || null,
    total: Number(order.total ?? transaction.amount),
    currency: transaction.currency,
    order_status: order.status || null,
    can_retry: !closed,
    ...publicFailure(transaction),
    ...(!closed && isLinkActive(transaction, paymentcard) ? { retry_url: transaction.payment_url } : {})
  };
}

export function verifyTropipaySignature(payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const received = data?.signaturev3 || data?.signatureV3 || payload?.signaturev3 || payload?.signatureV3;
  const bankOrderCode = data?.bankOrderCode || payload?.bankOrderCode;
  const originalAmount = data?.originalCurrencyAmount || payload?.originalCurrencyAmount;
  // TropiPay usa un único par de credenciales: la "API key/secret" de la firma son el client id/secret
  const apiKey = process.env.TROPIPAY_CLIENT_ID;
  const apiSecret = process.env.TROPIPAY_CLIENT_SECRET;
  if (!received || !bankOrderCode || !originalAmount || !apiKey || !apiSecret) return false;
  const expected = createHash("sha256").update(`${bankOrderCode}${apiKey}${createHash("sha1").update(apiSecret).digest("hex")}${originalAmount}`).digest("hex");
  const a = Buffer.from(String(received).toLowerCase());
  const b = Buffer.from(expected.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

// TropiPay informa el importe en centavos, igual que el importe enviado al crear
// el enlace. No aceptar unidades: 15 USD no debe poder validar una orden de 1500 USD.
export function webhookAmountMatches(rawAmount, expectedAmount) {
  const received = Number(rawAmount);
  const expected = Number(expectedAmount);
  if (!Number.isFinite(received) || !Number.isFinite(expected)) return false;
  return received === Math.round(expected * 100);
}

export async function processTropipayWebhook(payload, deps = defaultDeps) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const reference = data?.reference || payload?.reference;
  const providerPaymentId = String(data?.paymentcardId || data?.paymentcard?.id || data?.id || "");
  const status = String(payload?.status || "").toUpperCase();
  const signatureVerified = verifyTropipaySignature(payload);
  if (!signatureVerified) return { processed: false, reason: "INVALID_SIGNATURE" };

  if (!['OK', 'KO'].includes(status)) {
    console.warn("[tropipay:webhook] Estado no procesable", status || "(vacío)");
    return { processed: false, reason: "UNSUPPORTED_STATUS", status: status || null };
  }

  const transaction = await deps.paymentRepository.findByProviderReference(reference, providerPaymentId);
  if (!transaction) throw createNotFound("Transacción TropiPay no encontrada");

  if (status === "OK") {
    return confirmTropipayPayment(transaction, {
      source: "webhook",
      payload,
      amount: data?.originalCurrencyAmount ?? payload?.originalCurrencyAmount,
      providerPaymentId,
      bankOrderCode: data?.bankOrderCode
    }, deps);
  }

  // Cada intento de cobro rechazado es un evento distinto: el enlace sigue activo tras un rechazo
  if (!await claimEvent(transaction, "payment_failed", payload, deps, data?.bankOrderCode)) {
    return { processed: false, reason: "ALREADY_PROCESSED", transactionId: transaction.id, status: transaction.status };
  }

  // Un aviso de fallo tras un pago confirmado no debe dejar la orden como rechazada
  const currentOrder = await deps.orderRepository.findPrintState(transaction.order_id);
  if (currentOrder?.payment_status === "successful" || currentOrder?.status === "paid" || currentOrder?.printed_at) {
    deps.notify("payment_failed_after_success", { paymentId: transaction.id, orderId: transaction.order_id, orderReference: transaction.external_reference, message: "TropiPay envió un aviso de fallo para una orden ya pagada; revisar en TropiPay" });
    return { processed: false, reason: "ALREADY_PAID", transactionId: transaction.id };
  }

  await deps.paymentRepository.updatePayment(transaction.id, { provider_payment_id: providerPaymentId || transaction.provider_payment_id, bank_order_code: data?.bankOrderCode || transaction.bank_order_code, signature_verified: true, status: "failed", raw_payload: payload, updated_at: new Date().toISOString() });
  await deps.orderRepository.updatePaymentState(transaction.order_id, "failed", "payment_rejected");
  deps.notify("payment_failed", { paymentId: transaction.id, orderId: transaction.order_id, orderReference: transaction.external_reference, message: "Pago TropiPay rechazado" });
  return { processed: true, transactionId: transaction.id, status: "failed" };
}

// Registra el evento una sola vez por transacción y tipo (o por intento de cobro, con
// `attempt`). Devuelve false si ya lo había registrado el webhook o la conciliación
// (lo que llegue segundo no hace nada).
async function claimEvent(transaction, eventType, payload, deps, attempt = null) {
  // Con intento, solo decide el índice único: puede haber varios eventos del mismo tipo
  if (!attempt && await deps.paymentEventRepository.exists(transaction.id, eventType)) return false;
  const recorded = await deps.paymentEventRepository.record({
    payment_transaction_id: transaction.id,
    event_type: eventType,
    idempotency_key: `tropipay:${transaction.id}:${eventType}${attempt ? `:${attempt}` : ""}`,
    payload,
    signature_verified: !["poll", "reconcile"].includes(payload?.source),
    processed_at: new Date().toISOString()
  });
  return Boolean(recorded);
}

// Pago confirmado, por webhook firmado o por conciliación con la API de TropiPay:
// marca la orden como pagada, envía los avisos retenidos e imprime una sola vez.
async function confirmTropipayPayment(transaction, { source, payload, amount, providerPaymentId = null, bankOrderCode = null }, deps) {
  if (!await claimEvent(transaction, "payment_successful", payload, deps)) {
    return { processed: false, reason: "ALREADY_PROCESSED", transactionId: transaction.id, status: transaction.status };
  }

  const currentOrder = await deps.orderRepository.findPrintState(transaction.order_id);

  // Un pago por un importe distinto al de la orden no la marca como pagada
  if (!webhookAmountMatches(amount, transaction.amount)) {
    deps.notify("payment_amount_mismatch", { paymentId: transaction.id, orderId: transaction.order_id, orderReference: transaction.external_reference, message: `Importe TropiPay (${amount}) distinto al de la orden (${transaction.amount}); revisar manualmente` });
    await deps.paymentRepository.updatePayment(transaction.id, { status: "amount_mismatch", raw_payload: payload, updated_at: new Date().toISOString() })
      .catch(error => console.error("[tropipay:amount_mismatch]", error?.message || error));
    return { processed: false, reason: "AMOUNT_MISMATCH", transactionId: transaction.id };
  }

  await deps.paymentRepository.updatePayment(transaction.id, {
    provider_payment_id: providerPaymentId || transaction.provider_payment_id,
    bank_order_code: bankOrderCode || transaction.bank_order_code,
    ...(source === "webhook" ? { signature_verified: true } : {}),
    status: "successful",
    raw_payload: payload,
    updated_at: new Date().toISOString()
  });
  await deps.orderRepository.updatePaymentState(transaction.order_id, "successful", "paid");
  if (typeof deps.qualifyReferralForOrder === "function") {
    await deps.qualifyReferralForOrder(transaction.order_id).catch(error => {
      console.error("[tropipay:referral-qualification]", error?.message || error);
    });
  }
  deps.notify("payment_successful", { paymentId: transaction.id, orderId: transaction.order_id, orderReference: transaction.external_reference, source, message: "Pago TropiPay confirmado" });

  // Los avisos de la orden (APK, email, Telegram, SMS) se retuvieron al crearla: salen ahora
  Promise.resolve(deps.notifyConfirmedOrder(transaction.order_id)).catch(err => console.error("[tropipay:notify]", err?.message || err));

  if (!currentOrder?.printed_at) {
    try {
      await deps.printOrder(transaction.order_id);
      await deps.orderRepository.markPrinted(transaction.order_id);
      deps.notify("order_printed", { orderId: transaction.order_id, orderReference: transaction.external_reference, message: "Orden enviada a imprimir" });
    } catch (printError) {
      deps.notify("order_print_failed", { orderId: transaction.order_id, orderReference: transaction.external_reference, message: printError.message });
    }
  }
  return { processed: true, transactionId: transaction.id, status: "successful" };
}

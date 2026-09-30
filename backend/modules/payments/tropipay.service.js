import { createHash, timingSafeEqual } from "node:crypto";
import { createBadRequest, createConflict, createNotFound, HttpError } from "../../utils/http-error.js";
import { buildTropipayClient, createTropipayPayment, getTropipayPayment, missingTropipayClientFields, warmTropipayToken } from "./providers/tropipay.provider.js";
import { assertOrderAccess, notifyConfirmedOrder, printOrder } from "../orders/orders.service.js";
import { NotificationManager } from "../notifications/notifications.service.js";
import * as paymentRepository from "./adapters/supabase-payment.repository.js";
import * as paymentEventRepository from "./adapters/supabase-payment-event.repository.js";
import * as orderRepository from "./adapters/supabase-order.repository.js";

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
  notify: (type, data) => NotificationManager.sendNotification(type, data)
};

// Estados en los que el pago aún puede completarse (un rechazo de tarjeta no cierra el enlace)
const RETRYABLE_STATUSES = new Set(["pending", "processing", "failed"]);

export async function createTropipayPaymentForOrder({ orderId, checkoutToken = null, customerId = null, returnOrigin = null }, deps = defaultDeps) {
  deps.warmTropipayToken();
  // Consultas independientes en paralelo: cada ida y vuelta a Supabase cuesta 200-500 ms
  const [order, existing] = await Promise.all([
    deps.paymentRepository.findOrderById(orderId),
    deps.paymentRepository.findPendingByOrder(orderId)
  ]);
  // Quien creó la orden (checkout_token) o su cliente registrado
  assertOrderAccess(order, { checkoutToken, customerId });
  assertPayableWithTropipay(order);

  if (existing?.payment_url) return existing;
  return openTropipayLink(order, { reference: order.order_reference, customerId, returnOrigin }, deps);
}

function assertPayableWithTropipay(order) {
  if (!order.order_reference) throw createBadRequest("La orden no tiene order_reference; ejecuta la migración y vuelve a crearla");
  if (order.status === "paid" || order.payment_status === "successful") throw createConflict("La orden ya está pagada");
  if (order.status === "cancelled") throw createConflict("La orden está cancelada");
  const missing = missingTropipayClientFields(buildTropipayClient(order));
  if (missing.length) throw createBadRequest(`Faltan datos del pagador para TropiPay: ${missing.join(", ")}`);
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
    await deps.paymentRepository.updatePayment(transaction.id, { status: "failed", raw_payload: error.providerBody || { message: error.message }, updated_at: new Date().toISOString() });
    throw error;
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

  let paymentcard = null;
  let providerUnavailable = false;
  if (RETRYABLE_STATUSES.has(transaction.status) && transaction.provider_payment_id && !isPaid(transaction)) {
    paymentcard = await deps.getTropipayPayment(transaction.provider_payment_id).catch(error => {
      console.warn("[tropipay:status] No se pudo consultar el enlace en TropiPay:", error?.message || error);
      providerUnavailable = true;
      return null;
    });

    if (paymentcard?.paymentInfo?.paid === true) {
      await confirmTropipayPayment(transaction, {
        source: "poll",
        payload: { source: "poll", paymentcard },
        amount: paymentcard.amount
      }, deps);
      transaction = await deps.paymentRepository.findById(transactionId);
    }
  }

  return { transaction, paymentcard, providerUnavailable };
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
  const fullOrder = await deps.paymentRepository.findOrderById(transaction.order_id);
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
    ...(!closed && isLinkActive(transaction, paymentcard) ? { retry_url: transaction.payment_url } : {})
  };
}

export function verifyTropipaySignature(payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const received = data?.signaturev3 || data?.signatureV3 || payload?.signaturev3 || payload?.signatureV3;
  const bankOrderCode = data?.bankOrderCode || payload?.bankOrderCode;
  const originalAmount = data?.originalCurrencyAmount || payload?.originalCurrencyAmount;
  const apiKey = process.env.TROPIPAY_API_KEY || process.env.TROPIPAY_CLIENT_ID;
  const apiSecret = process.env.TROPIPAY_API_SECRET || process.env.TROPIPAY_CLIENT_SECRET;
  if (!received || !bankOrderCode || !originalAmount || !apiKey || !apiSecret) return false;
  const expected = createHash("sha256").update(`${bankOrderCode}${apiKey}${createHash("sha1").update(apiSecret).digest("hex")}${originalAmount}`).digest("hex");
  const a = Buffer.from(String(received).toLowerCase());
  const b = Buffer.from(expected.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

// TropiPay informa el importe en centavos (como lo enviamos al crear el enlace);
// se acepta también en unidades por tolerancia ante cambios de formato.
export function webhookAmountMatches(rawAmount, expectedAmount) {
  const received = Number(rawAmount);
  const expected = Number(expectedAmount);
  if (!Number.isFinite(received) || !Number.isFinite(expected)) return false;
  return received === Math.round(expected * 100) || Math.abs(received - expected) < 0.01;
}

export async function processTropipayWebhook(payload, deps = defaultDeps) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const reference = data?.reference || payload?.reference;
  const providerPaymentId = String(data?.paymentcardId || data?.paymentcard?.id || data?.id || "");
  const status = String(payload?.status || "").toUpperCase();
  const successful = status === "OK";
  const signatureVerified = verifyTropipaySignature(payload);
  if (!signatureVerified) return { processed: false, reason: "INVALID_SIGNATURE" };

  const transaction = await deps.paymentRepository.findByProviderReference(reference, providerPaymentId);
  if (!transaction) throw createNotFound("Transacción TropiPay no encontrada");

  if (successful) {
    return confirmTropipayPayment(transaction, {
      source: "webhook",
      payload,
      amount: data?.originalCurrencyAmount ?? payload?.originalCurrencyAmount,
      providerPaymentId,
      bankOrderCode: data?.bankOrderCode
    }, deps);
  }

  if (!await claimEvent(transaction, "payment_failed", payload, deps)) {
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

// Registra el evento una sola vez por transacción y tipo. Devuelve false si ya
// lo había registrado el webhook o la conciliación (lo que llegue segundo no hace nada).
async function claimEvent(transaction, eventType, payload, deps) {
  if (await deps.paymentEventRepository.exists(transaction.id, eventType)) return false;
  const recorded = await deps.paymentEventRepository.record({
    payment_transaction_id: transaction.id,
    event_type: eventType,
    idempotency_key: `tropipay:${transaction.id}:${eventType}`,
    payload,
    signature_verified: payload?.source !== "poll",
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

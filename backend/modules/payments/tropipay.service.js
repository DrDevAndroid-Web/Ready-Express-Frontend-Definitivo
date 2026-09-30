import { createHash, timingSafeEqual } from "node:crypto";
import { createBadRequest, createNotFound } from "../../utils/http-error.js";
import { buildTropipayClient, createTropipayPayment, missingTropipayClientFields, warmTropipayToken } from "./providers/tropipay.provider.js";
import { notifyConfirmedOrder, printOrder } from "../orders/orders.service.js";
import { NotificationManager } from "../notifications/notifications.service.js";
import * as paymentRepository from "./adapters/supabase-payment.repository.js";
import * as paymentEventRepository from "./adapters/supabase-payment-event.repository.js";
import * as orderRepository from "./adapters/supabase-order.repository.js";

export async function createTropipayPaymentForOrder({ orderId, checkoutToken, customerId = null }) {
  if (!checkoutToken) throw createBadRequest("checkout_token es requerido");
  warmTropipayToken();
  // Consultas independientes en paralelo: cada ida y vuelta a Supabase cuesta 200-500 ms
  const [order, existing] = await Promise.all([
    paymentRepository.findOrderForCheckout(orderId, checkoutToken),
    paymentRepository.findPendingByOrder(orderId)
  ]);
  if (!order) throw createNotFound("Orden no encontrada");
  if (!order.order_reference) throw createBadRequest("La orden no tiene order_reference; ejecuta la migración y vuelve a crearla");

  const missing = missingTropipayClientFields(buildTropipayClient(order));
  if (missing.length) throw createBadRequest(`Faltan datos del pagador para TropiPay: ${missing.join(", ")}`);

  if (existing?.payment_url) return existing;

  const transaction = await paymentRepository.createPayment({ order_id: order.id, customer_id: customerId, provider: "tropipay", amount: order.total, currency: process.env.TROPIPAY_CURRENCY || "USD", status: "processing", external_reference: order.order_reference });

  try {
    const payment = await createTropipayPayment({ order, transactionId: transaction.id });
    const [updated] = await Promise.all([
      paymentRepository.updatePayment(transaction.id, { provider_payment_id: payment?.id || null, paymentcard_id: payment?.id || null, payment_url: payment?.shortUrl || payment?.paymentUrl || null, status: "pending", raw_payload: payment || null, updated_at: new Date().toISOString() }),
      orderRepository.updatePaymentState(order.id, "processing", order.status)
    ]);
    return updated;
  } catch (error) {
    await paymentRepository.updatePayment(transaction.id, { status: "failed", raw_payload: error.providerBody || { message: error.message }, updated_at: new Date().toISOString() });
    throw error;
  }
}

export async function getTropipayStatus(transactionId, { checkoutToken = null, customerId = null, isAdmin = false } = {}) {
  const data = await paymentRepository.findById(transactionId);
  if (!data) throw createNotFound("Pago no encontrado");
  const ownsCheckout = checkoutToken && data.orders?.checkout_token === checkoutToken;
  const ownsCustomer = customerId && data.orders?.customer_id === customerId;
  if (!isAdmin && !ownsCheckout && !ownsCustomer) throw createBadRequest("Se requiere checkout_token o sesión propietaria para consultar este pago");
  return data;
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

export async function processTropipayWebhook(payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const reference = data?.reference || payload?.reference;
  const providerPaymentId = String(data?.paymentcardId || data?.paymentcard?.id || data?.id || "");
  const status = String(payload?.status || "").toUpperCase();
  const successful = status === "OK";
  const eventType = successful ? "payment_successful" : "payment_failed";
  const signatureVerified = verifyTropipaySignature(payload);
  if (!signatureVerified) return { processed: false, reason: "INVALID_SIGNATURE" };

  const transaction = await paymentRepository.findByProviderReference(reference, providerPaymentId);
  if (!transaction) throw createNotFound("Transacción TropiPay no encontrada");

  const currentOrder = await orderRepository.findPrintState(transaction.order_id);

  if (await paymentEventRepository.exists(transaction.id, eventType)) {
    return { processed: false, reason: "ALREADY_PROCESSED", transactionId: transaction.id, status: transaction.status };
  }

  await paymentEventRepository.record({ payment_transaction_id: transaction.id, event_type: eventType, payload, signature_verified: true, processed_at: new Date().toISOString() });

  // Un aviso de fallo tras un pago confirmado no debe dejar la orden como rechazada
  if (!successful && (currentOrder?.payment_status === "successful" || currentOrder?.status === "paid" || currentOrder?.printed_at)) {
    NotificationManager.sendNotification("payment_failed_after_success", { paymentId: transaction.id, orderId: transaction.order_id, orderReference: transaction.external_reference, message: "TropiPay envió un aviso de fallo para una orden ya pagada; revisar en TropiPay" });
    return { processed: false, reason: "ALREADY_PAID", transactionId: transaction.id };
  }

  // Un pago por un importe distinto al de la orden no la marca como pagada
  const originalAmount = data?.originalCurrencyAmount ?? payload?.originalCurrencyAmount;
  if (successful && !webhookAmountMatches(originalAmount, transaction.amount)) {
    await paymentRepository.updatePayment(transaction.id, { status: "amount_mismatch", raw_payload: payload, signature_verified: true, updated_at: new Date().toISOString() });
    NotificationManager.sendNotification("payment_amount_mismatch", { paymentId: transaction.id, orderId: transaction.order_id, orderReference: transaction.external_reference, message: `Importe TropiPay (${originalAmount}) distinto al de la orden (${transaction.amount}); revisar manualmente` });
    return { processed: false, reason: "AMOUNT_MISMATCH", transactionId: transaction.id };
  }

  const nextStatus = successful ? "successful" : "failed";
  await paymentRepository.updatePayment(transaction.id, { provider_payment_id: providerPaymentId || transaction.provider_payment_id, bank_order_code: data?.bankOrderCode || transaction.bank_order_code, signature_verified: true, status: nextStatus, raw_payload: payload, updated_at: new Date().toISOString() });

  await orderRepository.updatePaymentState(transaction.order_id, nextStatus, successful ? "paid" : "payment_rejected");
  NotificationManager.sendNotification(eventType, { paymentId: transaction.id, orderId: transaction.order_id, orderReference: transaction.external_reference, message: successful ? "Pago TropiPay confirmado" : "Pago TropiPay rechazado" });

  // Los avisos de la orden (APK, email, Telegram, SMS) se retuvieron al crearla: salen ahora
  if (successful) {
    notifyConfirmedOrder(transaction.order_id).catch(err => console.error("[tropipay:notify]", err?.message || err));
  }

  if (successful && !currentOrder?.printed_at) {
    try {
      await printOrder(transaction.order_id);
      await orderRepository.markPrinted(transaction.order_id);
      NotificationManager.sendNotification("order_printed", { orderId: transaction.order_id, orderReference: transaction.external_reference, message: "Orden enviada a imprimir" });
    } catch (printError) {
      NotificationManager.sendNotification("order_print_failed", { orderId: transaction.order_id, orderReference: transaction.external_reference, message: printError.message });
    }
  }
  return { processed: true, transactionId: transaction.id, status: nextStatus };
}

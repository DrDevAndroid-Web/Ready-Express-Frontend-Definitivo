import { sendError } from "../../utils/http-error.js";
import { createTropipayPaymentForOrder, getTropipayStatus, processTropipayWebhook, retryTropipayPayment, verifyTropipaySignature } from "./tropipay.service.js";
import { getTropipayConfigurationStatus } from "./providers/tropipay.provider.js";

// Quién puede actuar sobre la orden: checkout_token (cabecera o query), su cliente o un admin
function orderAccess(req) {
  return {
    checkoutToken: req.get("x-checkout-token") || req.query.checkout_token || req.body?.checkout_token || null,
    customerId: req.user?.id || null,
    isAdmin: req.userRoles?.includes("admin") || req.userRoles?.includes("operador")
  };
}

// Carpeta de la página que inició el pago; el proveedor solo la acepta si está en CORS_ORIGINS
function returnOrigin(req) {
  return req.body?.return_url_base || req.get("origin") || null;
}

export async function createTropipayPaymentController(req, res) {
  try {
    const { order_id: orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: "order_id es requerido" });
    const { checkoutToken, customerId } = orderAccess(req);
    res.status(201).json(await createTropipayPaymentForOrder({ orderId, checkoutToken, customerId, returnOrigin: returnOrigin(req) }));
  } catch (error) {
    sendError(res, error);
  }
}

export async function getTropipayStatusController(req, res) {
  try {
    res.json(await getTropipayStatus(req.params.id, orderAccess(req)));
  } catch (error) {
    sendError(res, error);
  }
}

export async function retryTropipayPaymentController(req, res) {
  try {
    res.json(await retryTropipayPayment(req.params.id, { ...orderAccess(req), returnOrigin: returnOrigin(req) }));
  } catch (error) {
    sendError(res, error);
  }
}

// Se procesa antes de responder: TropiPay reintenta el aviso hasta recibir un 200,
// así que un fallo (p. ej. Supabase caído) responde 500 para que vuelva a llegar.
// Una transacción que no existe responde 200: reintentarla no la haría aparecer.
export async function handleTropipayWebhook(payload, processWebhook = processTropipayWebhook) {
  if (!verifyTropipaySignature(payload)) return { status: 401, body: { error: "Firma TropiPay inválida" } };
  try {
    await processWebhook(payload);
    return { status: 200, body: { received: true } };
  } catch (error) {
    if (error?.status === 404) {
      console.warn("[tropipay:webhook]", error.message, payload?.data?.reference || payload?.reference || "");
      return { status: 200, body: { received: true } };
    }
    console.error("[tropipay:webhook]", error?.message || error);
    return { status: 500, body: { error: "No se pudo procesar el aviso" } };
  }
}

export async function tropipayWebhookController(req, res) {
  const { status, body } = await handleTropipayWebhook(req.body);
  res.status(status).json(body);
}

export function tropipayConfigurationController(_req, res) {
  res.json(getTropipayConfigurationStatus());
}

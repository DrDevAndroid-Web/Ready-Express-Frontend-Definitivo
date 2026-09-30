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

export async function tropipayWebhookController(req, res) {
  if (!verifyTropipaySignature(req.body)) return res.status(401).json({ error: "Firma TropiPay inválida" });
  res.status(200).json({ received: true });
  processTropipayWebhook(req.body).catch(error => console.error("[tropipay:webhook]", error));
}

export function tropipayConfigurationController(_req, res) {
  res.json(getTropipayConfigurationStatus());
}

import { sendError } from "../../utils/http-error.js";
import { createTropipayPaymentForOrder, getTropipayStatus, processTropipayWebhook, verifyTropipaySignature } from "./tropipay.service.js";
import { getTropipayConfigurationStatus } from "./providers/tropipay.provider.js";

export async function createTropipayPaymentController(req, res) {
  try {
    const { order_id: orderId, checkout_token: checkoutToken } = req.body || {};
    if (!orderId) return res.status(400).json({ error: "order_id es requerido" });
    res.status(201).json(await createTropipayPaymentForOrder({ orderId, checkoutToken, customerId: req.user?.id || null }));
  } catch (error) {
    sendError(res, error);
  }
}

export async function getTropipayStatusController(req, res) {
  try {
    res.json(await getTropipayStatus(req.params.id, {
      checkoutToken: req.get("x-checkout-token") || req.query.checkout_token || null,
      customerId: req.user?.id || null,
      isAdmin: req.userRoles?.includes("admin") || req.userRoles?.includes("operador")
    }));
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

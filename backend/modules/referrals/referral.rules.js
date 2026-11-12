import { createBadRequest, createConflict } from "../../utils/http-error.js";

export const REFERRAL_STATUSES = Object.freeze([
  "pending",
  "registered",
  "purchase_pending",
  "qualified",
  "rewarded",
  "rejected",
  "cancelled"
]);

export const REWARD_STATUSES = Object.freeze([
  "pending",
  "available",
  "used",
  "reversed",
  "expired",
  "rejected"
]);

export const REFERRAL_REWARD_TYPES = Object.freeze([
  "discount_fixed",
  "discount_percent",
  "credit_fixed",
  "credit_percent"
]);

export const REFERRAL_BENEFICIARY_TYPES = Object.freeze(["referred_customer", "referrer"]);

export function validateReferralProgramPayload(payload = {}) {
  const allowed = ["enabled", "name", "description", "currency", "starts_at", "ends_at", "attribution_window_days", "qualification_event"];
  const unknown = Object.keys(payload).filter(key => !allowed.includes(key));
  if (unknown.length) throw createBadRequest(`Campo(s) de programa no permitido(s): ${unknown.join(", ")}`);
  if (payload.enabled != null && typeof payload.enabled !== "boolean") throw createBadRequest("enabled debe ser booleano");
  if (payload.name != null && (!String(payload.name).trim() || String(payload.name).length > 120)) throw createBadRequest("El nombre del programa no es válido");
  if (payload.currency != null && !/^[A-Z]{3}$/.test(String(payload.currency).toUpperCase())) throw createBadRequest("La moneda del programa no es válida");
  if (payload.attribution_window_days != null && (!Number.isInteger(Number(payload.attribution_window_days)) || Number(payload.attribution_window_days) < 1 || Number(payload.attribution_window_days) > 365)) throw createBadRequest("La ventana de atribución debe estar entre 1 y 365 días");
  if (payload.qualification_event != null && payload.qualification_event !== "payment_successful") throw createBadRequest("El evento de calificación no está soportado");
  if (payload.starts_at && Number.isNaN(Date.parse(payload.starts_at))) throw createBadRequest("starts_at no es una fecha válida");
  if (payload.ends_at && Number.isNaN(Date.parse(payload.ends_at))) throw createBadRequest("ends_at no es una fecha válida");
  if (payload.starts_at && payload.ends_at && Date.parse(payload.ends_at) <= Date.parse(payload.starts_at)) throw createBadRequest("ends_at debe ser posterior a starts_at");
  return {
    ...(payload.enabled != null ? { enabled: payload.enabled } : {}),
    ...(payload.name != null ? { name: String(payload.name).trim() } : {}),
    ...(payload.description !== undefined ? { description: payload.description == null ? null : String(payload.description).trim() } : {}),
    ...(payload.currency != null ? { currency: String(payload.currency).toUpperCase() } : {}),
    ...(payload.starts_at !== undefined ? { starts_at: payload.starts_at || null } : {}),
    ...(payload.ends_at !== undefined ? { ends_at: payload.ends_at || null } : {}),
    ...(payload.attribution_window_days != null ? { attribution_window_days: Number(payload.attribution_window_days) } : {}),
    ...(payload.qualification_event != null ? { qualification_event: payload.qualification_event } : {})
  };
}

export function validateReferralRulePayload(payload = {}) {
  const allowed = ["beneficiary_type", "reward_type", "amount", "minimum_purchase", "maximum_discount", "expires_after_days", "max_rewards_per_referrer", "active"];
  const unknown = Object.keys(payload).filter(key => !allowed.includes(key));
  if (unknown.length) throw createBadRequest(`Campo(s) de regla no permitido(s): ${unknown.join(", ")}`);
  if (!REFERRAL_BENEFICIARY_TYPES.includes(payload.beneficiary_type)) throw createBadRequest("El beneficiario de la regla no es válido");
  if (!REFERRAL_REWARD_TYPES.includes(payload.reward_type)) throw createBadRequest("El tipo de recompensa no es válido");
  if (payload.beneficiary_type === "referred_customer" && !payload.reward_type.startsWith("discount_")) throw createBadRequest("El referido solo admite reglas de descuento");
  if (payload.beneficiary_type === "referrer" && !payload.reward_type.startsWith("credit_")) throw createBadRequest("El referente solo admite reglas de crédito");
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0 || (payload.reward_type.endsWith("_percent") && amount > 100)) throw createBadRequest("El importe de la regla no es válido");
  if (payload.expires_after_days != null && (!Number.isInteger(Number(payload.expires_after_days)) || Number(payload.expires_after_days) < 1 || Number(payload.expires_after_days) > 3650)) throw createBadRequest("expires_after_days no es válido");
  if (payload.max_rewards_per_referrer != null && (!Number.isInteger(Number(payload.max_rewards_per_referrer)) || Number(payload.max_rewards_per_referrer) < 1 || Number(payload.max_rewards_per_referrer) > 100000)) throw createBadRequest("max_rewards_per_referrer no es válido");
  if (payload.minimum_purchase != null && (!Number.isFinite(Number(payload.minimum_purchase)) || Number(payload.minimum_purchase) < 0)) throw createBadRequest("minimum_purchase no es válido");
  if (payload.maximum_discount != null && (!Number.isFinite(Number(payload.maximum_discount)) || Number(payload.maximum_discount) <= 0)) throw createBadRequest("maximum_discount no es válido");
  if (payload.reward_type.startsWith("credit_") && payload.maximum_discount != null) throw createBadRequest("maximum_discount solo aplica a descuentos");
  if (payload.active != null && typeof payload.active !== "boolean") throw createBadRequest("active debe ser booleano");
  return {
    beneficiary_type: payload.beneficiary_type,
    reward_type: payload.reward_type,
    amount,
    minimum_purchase: payload.minimum_purchase == null ? 0 : Number(payload.minimum_purchase),
    maximum_discount: payload.maximum_discount == null ? null : Number(payload.maximum_discount),
    expires_after_days: payload.expires_after_days == null ? null : Number(payload.expires_after_days),
    max_rewards_per_referrer: payload.max_rewards_per_referrer == null ? null : Number(payload.max_rewards_per_referrer),
    active: payload.active !== false
  };
}

export function normalizeReferralCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z2-9]{8,16}$/.test(code)) throw createBadRequest("El código de referido no es válido");
  return code;
}

export function assertNotSelfReferral(referrerCustomerId, referredCustomerId) {
  if (referrerCustomerId && referredCustomerId && referrerCustomerId === referredCustomerId) {
    throw createConflict("No puedes referirte a ti mismo");
  }
}

export function canApplyReferredDiscount(referral) {
  return referral?.status === "registered"
    && !referral.first_eligible_order_id
    && !referral.discount_used_at;
}

export function roundMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw createBadRequest("El importe no es válido");
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function calculateReferralDiscount(rule, eligibleSubtotal) {
  if (!rule?.active) return 0;
  const subtotal = roundMoney(eligibleSubtotal);
  const minimum = roundMoney(rule.minimum_purchase || 0);
  if (subtotal < minimum) return 0;

  let discount;
  if (rule.reward_type === "discount_fixed") discount = Number(rule.amount);
  else if (rule.reward_type === "discount_percent") discount = subtotal * Number(rule.amount) / 100;
  else throw createBadRequest("La regla de descuento no es válida");

  if (!Number.isFinite(discount) || discount <= 0) return 0;
  if (rule.maximum_discount != null) discount = Math.min(discount, Number(rule.maximum_discount));
  return Math.min(roundMoney(discount), subtotal);
}

export function calculateReferralCredit(rule, eligiblePurchaseAmount) {
  if (!rule?.active) return 0;
  const purchase = roundMoney(eligiblePurchaseAmount);
  const minimum = roundMoney(rule.minimum_purchase || 0);
  if (purchase < minimum) return 0;

  let credit;
  if (rule.reward_type === "credit_fixed") credit = Number(rule.amount);
  else if (rule.reward_type === "credit_percent") credit = purchase * Number(rule.amount) / 100;
  else throw createBadRequest("La regla de crédito no es válida");

  if (!Number.isFinite(credit) || credit <= 0) return 0;
  return roundMoney(credit);
}

export function calculateReferralBalance(entries = []) {
  const balance = entries.reduce((total, entry) => {
    const amount = Number(entry?.amount || 0);
    const restoresDebit = entry?.entry_type === "reversal" && entry?.metadata?.source === "order_cancelled";
    return total + (entry?.entry_type === "credit" || restoresDebit ? amount : -amount);
  }, 0);
  return Math.max(0, roundMoney(balance));
}

export function buildReferralRewardIdempotencyKey(referralId, rewardType, orderId) {
  if (!referralId || !rewardType || !orderId) throw createBadRequest("No se pudo construir la clave de recompensa");
  return `referral:${referralId}:${rewardType}:${orderId}`;
}

export function assertEligibleReferralOrder({ order, paymentStatus, requiredCurrency = "USD" }) {
  if (!order?.id) throw createBadRequest("La orden es requerida");
  if (String(paymentStatus || order.payment_status || "").toLowerCase() !== "successful") {
    throw createConflict("La orden todavía no tiene un pago confirmado");
  }
  if (["cancelled", "payment_rejected"].includes(String(order.status || "").toLowerCase())) {
    throw createConflict("La orden no puede generar una recompensa");
  }
  if (requiredCurrency && String(order.currency || requiredCurrency).toUpperCase() !== String(requiredCurrency).toUpperCase()) {
    throw createConflict("La moneda de la orden no coincide con el programa");
  }
  return true;
}

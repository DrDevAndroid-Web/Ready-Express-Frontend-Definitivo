import test from "node:test";
import assert from "node:assert/strict";
import {
  assertEligibleReferralOrder,
  assertNotSelfReferral,
  buildReferralRewardIdempotencyKey,
  calculateReferralBalance,
  calculateReferralCredit,
  calculateReferralDiscount,
  canApplyReferredDiscount,
  normalizeReferralCode,
  validateReferralProgramPayload,
  validateReferralRulePayload
} from "../modules/referrals/referral.rules.js";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "x.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.y";
process.env.SUPABASE_ANON_KEY ||= "anon-key";
const { generateReferralCode, hashReferralToken } = await import("../modules/referrals/referral.service.js");
const { reverseAdminReferralReward } = await import("../modules/referrals/referral.admin.service.js");

test("referidos — normaliza y valida códigos públicos", () => {
  assert.equal(normalizeReferralCode(" abcd2345 "), "ABCD2345");
  assert.throws(() => normalizeReferralCode("abc"), /código de referido/);
  assert.throws(() => normalizeReferralCode("ABC1234!"), /código de referido/);
});

test("referidos — genera códigos sin caracteres ambiguos y tokens hash", () => {
  const code = generateReferralCode(10, length => Buffer.alloc(length, 0));
  assert.equal(code.length, 10);
  assert.match(code, /^[A-Z2-9]+$/);
  assert.equal(hashReferralToken("a".repeat(32)).length, 64);
  assert.throws(() => hashReferralToken("corto"), /token de referido/);
});

test("referidos — bloquea autorreferencia", () => {
  assert.throws(() => assertNotSelfReferral("customer-1", "customer-1"), /referirte a ti mismo/);
  assert.doesNotThrow(() => assertNotSelfReferral("customer-1", "customer-2"));
});

test("referidos — calcula descuento fijo/porcentual y mínimos", () => {
  assert.equal(calculateReferralDiscount({ active: true, reward_type: "discount_fixed", amount: 2, minimum_purchase: 25 }, 30), 2);
  assert.equal(calculateReferralDiscount({ active: true, reward_type: "discount_percent", amount: 20, minimum_purchase: 25, maximum_discount: 3 }, 30), 3);
  assert.equal(calculateReferralDiscount({ active: true, reward_type: "discount_fixed", amount: 2, minimum_purchase: 25 }, 20), 0);
});

test("referidos — el descuento de primera compra solo se ofrece antes de reservarlo o consumirlo", () => {
  assert.equal(canApplyReferredDiscount({ status: "registered", first_eligible_order_id: null, discount_used_at: null }), true);
  assert.equal(canApplyReferredDiscount({ status: "purchase_pending", first_eligible_order_id: "order-1", discount_used_at: null }), false);
  assert.equal(canApplyReferredDiscount({ status: "registered", first_eligible_order_id: null, discount_used_at: "2026-11-06T12:00:00Z" }), false);
  assert.equal(canApplyReferredDiscount({ status: "rewarded", first_eligible_order_id: null, discount_used_at: null }), false);
});

test("referidos — calcula crédito y limita errores monetarios", () => {
  assert.equal(calculateReferralCredit({ active: true, reward_type: "credit_fixed", amount: 3, minimum_purchase: 25 }, 25), 3);
  assert.equal(calculateReferralCredit({ active: true, reward_type: "credit_percent", amount: 10, minimum_purchase: 25 }, 25), 2.5);
  assert.equal(buildReferralRewardIdempotencyKey("r1", "referrer_credit", "o1"), "referral:r1:referrer_credit:o1");
});

test("referidos — las reversiones reducen el saldo del ledger", () => {
  assert.equal(calculateReferralBalance([
    { entry_type: "credit", amount: 10 },
    { entry_type: "reversal", amount: 4 },
    { entry_type: "debit", amount: 1 }
  ]), 5);
  assert.equal(calculateReferralBalance([{ entry_type: "reversal", amount: 4 }]), 0);
  assert.equal(calculateReferralBalance([
    { entry_type: "credit", amount: 2 },
    { entry_type: "debit", amount: 2 },
    { entry_type: "reversal", amount: 2, metadata: { source: "order_cancelled" } }
  ]), 2);
});

test("referidos — solo califica una orden con pago exitoso", () => {
  assert.equal(assertEligibleReferralOrder({ order: { id: "o1", status: "paid", currency: "USD" }, paymentStatus: "successful" }), true);
  assert.throws(() => assertEligibleReferralOrder({ order: { id: "o1", status: "paid" }, paymentStatus: "processing" }), /pago confirmado/);
  assert.throws(() => assertEligibleReferralOrder({ order: { id: "o1", status: "cancelled" }, paymentStatus: "successful" }), /no puede generar/);
});

test("referidos — valida configuración administrativa y normaliza moneda", () => {
  assert.deepEqual(validateReferralProgramPayload({ enabled: true, currency: "usd", attribution_window_days: 45 }), {
    enabled: true,
    currency: "USD",
    attribution_window_days: 45
  });
  assert.throws(() => validateReferralProgramPayload({ qualification_event: "delivery_completed" }), /no está soportado/);
  assert.throws(() => validateReferralProgramPayload({ ends_at: "2026-01-01", starts_at: "2026-02-01" }), /posterior/);
});

test("referidos — valida reglas administrativas según tipo de beneficio", () => {
  assert.deepEqual(validateReferralRulePayload({ beneficiary_type: "referred_customer", reward_type: "discount_percent", amount: 15, maximum_discount: 10 }), {
    beneficiary_type: "referred_customer",
    reward_type: "discount_percent",
    amount: 15,
    minimum_purchase: 0,
    maximum_discount: 10,
    expires_after_days: null,
    max_rewards_per_referrer: null,
    active: true
  });
  assert.throws(() => validateReferralRulePayload({ beneficiary_type: "referrer", reward_type: "credit_percent", amount: 101 }), /importe/);
  assert.throws(() => validateReferralRulePayload({ beneficiary_type: "referred_customer", reward_type: "credit_fixed", amount: 5 }), /descuento/);
  assert.throws(() => validateReferralRulePayload({ beneficiary_type: "referrer", reward_type: "credit_fixed", amount: 5, maximum_discount: 2 }), /maximum_discount/);
});

test("referidos — exige razón para una reversión administrativa", async () => {
  await assert.rejects(() => reverseAdminReferralReward("reward-1", "admin-1", "corta"), /entre 10 y 500/);
});

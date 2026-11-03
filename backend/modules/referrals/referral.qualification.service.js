import { supabase } from "../../config/supabase.js";
import { throwIfSupabaseError } from "../../utils/http-error.js";
import { calculateReferralCredit, assertEligibleReferralOrder, buildReferralRewardIdempotencyKey } from "./referral.rules.js";
import { getReferralProgram } from "./referral.service.js";
import { notifyReferralPurchase } from "../notifications/referral-push.service.js";

const MISSING_RELATION_CODES = new Set(["PGRST205", "42P01"]);

// Caso idempotente invocado por cada fuente de pago cuando confirma una orden.
// La reserva de la primera compra se hace al crear la orden; aquí se convierte
// en recompensa solo después de payment_status=successful.
export async function qualifyReferralForOrder(orderId) {
  const atomic = await supabase.rpc("qualify_referral_order", { p_order_id: orderId });
  if (!isMissingFunction(atomic.error)) {
    throwIfSupabaseError(atomic.error, "No se pudo calificar el referido");
    await notifyReferralPurchaseForOrder(orderId).catch(error => console.error("[referral-push]", error.message || error));
    return atomic.data;
  }

  // Compatibilidad durante el despliegue escalonado: si las tablas ya existen
  // pero la segunda migración aún no se aplicó, conserva la ruta idempotente
  // anterior. Una vez aplicada la RPC, todas las escrituras pasan por SQL.
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id,status,payment_status,total,products_subtotal")
    .eq("id", orderId)
    .maybeSingle();
  throwIfSupabaseError(orderError, "No se pudo cargar la orden para referidos");
  if (!order) return { qualified: false, reason: "order_not_found" };
  if (String(order.payment_status || "").toLowerCase() !== "successful") return { qualified: false, reason: "payment_not_successful" };
  if (["cancelled", "payment_rejected"].includes(String(order.status || "").toLowerCase())) return { qualified: false, reason: "order_not_eligible" };

  const adjustment = await supabase
    .from("order_adjustments")
    .select("id,source_id,amount,currency,metadata")
    .eq("order_id", orderId)
    .eq("adjustment_type", "referral_discount")
    .maybeSingle();
  if (isMissingRelation(adjustment.error)) return { qualified: false, reason: "feature_not_installed" };
  throwIfSupabaseError(adjustment.error, "No se pudo cargar el ajuste de referido");
  if (!adjustment.data?.source_id) return { qualified: false, reason: "not_a_referral_order" };

  const referralResult = await supabase
    .from("referrals")
    .select("id,referrer_customer_id,referred_customer_id,status,rule_snapshot")
    .eq("id", adjustment.data.source_id)
    .maybeSingle();
  if (isMissingRelation(referralResult.error)) return { qualified: false, reason: "feature_not_installed" };
  throwIfSupabaseError(referralResult.error, "No se pudo cargar la atribución de referido");
  const referral = referralResult.data;
  if (!referral || !["purchase_pending", "qualified", "rewarded"].includes(referral.status)) return { qualified: false, reason: "referral_not_pending" };

  if (referral.status === "purchase_pending") {
    const { data: transitioned, error: transitionError } = await supabase
      .from("referrals")
      .update({ status: "qualified", qualified_at: new Date().toISOString() })
      .eq("id", referral.id)
      .eq("status", "purchase_pending")
      .select("id");
    throwIfSupabaseError(transitionError, "No se pudo calificar el referido");
    if (!transitioned?.length) return qualifyReferralForOrder(orderId);
  }
  if (referral.status === "rewarded") return { qualified: true, rewarded: true, referralId: referral.id, idempotent: true };

  const program = await getReferralProgram();
  const snapshot = adjustment.data.metadata?.rule_snapshot || referral.rule_snapshot || {};
  const referrerRule = snapshot.referrer || (program.rules || []).find(rule => rule.active && rule.beneficiary_type === "referrer");
  const purchaseAmount = Number(order.total || order.products_subtotal || 0);
  let credit = 0;
  if (referrerRule) credit = calculateReferralCredit(referrerRule, purchaseAmount);

  await ensureReward({
    referralId: referral.id,
    recipientCustomerId: referral.referred_customer_id,
    sourceOrderId: order.id,
    rewardType: "referred_discount",
    amount: Number(adjustment.data.amount),
    currency: adjustment.data.currency,
    status: "used",
    idempotencyKey: buildReferralRewardIdempotencyKey(referral.id, "referred_discount", order.id),
    ruleSnapshot: snapshot.referred || snapshot
  });

  if (credit > 0 && referral.referrer_customer_id) {
    const referrerRewardLimitReached = await hasReachedRewardLimit(referral.referrer_customer_id, referrerRule?.max_rewards_per_referrer);
    const reward = await ensureReward({
      referralId: referral.id,
      recipientCustomerId: referral.referrer_customer_id,
      sourceOrderId: order.id,
      rewardType: "referrer_credit",
      amount: credit,
      currency: program.currency,
      status: referrerRewardLimitReached ? "rejected" : "available",
      availableAt: referrerRewardLimitReached ? null : new Date().toISOString(),
      expiresAt: referrerRule?.expires_after_days ? new Date(Date.now() + Number(referrerRule.expires_after_days) * 86400000).toISOString() : null,
      idempotencyKey: buildReferralRewardIdempotencyKey(referral.id, "referrer_credit", order.id),
      ruleSnapshot: referrerRule || {}
    });
    if (!referrerRewardLimitReached) await ensureWalletCredit(reward, referral.referrer_customer_id, order.id, program.currency);
  }

  await notifyReferralPurchaseForOrder(orderId).catch(error => console.error("[referral-push]", error.message || error));

  const { error: finalError } = await supabase.from("referrals").update({ status: "rewarded" }).eq("id", referral.id).in("status", ["qualified", "rewarded"]);
  throwIfSupabaseError(finalError, "No se pudo completar la recompensa de referido");
  return { qualified: true, rewarded: true, referralId: referral.id, credit };
}

async function notifyReferralPurchaseForOrder(orderId) {
  const { data: reward, error: rewardError } = await supabase
    .from("referral_rewards")
    .select("id,referral_id,amount,currency,push_notified_at")
    .eq("source_order_id", orderId)
    .eq("reward_type", "referrer_credit")
    .eq("status", "available")
    .is("push_notified_at", null)
    .maybeSingle();
  if (rewardError?.code === "PGRST204" || rewardError?.code === "PGRST205") return;
  throwIfSupabaseError(rewardError, "No se pudo cargar la recompensa para push");
  if (!reward) return;

  const { data: referral, error: referralError } = await supabase.from("referrals").select("referrer_customer_id").eq("id", reward.referral_id).maybeSingle();
  throwIfSupabaseError(referralError, "No se pudo cargar el referente para push");
  if (!referral?.referrer_customer_id) return;

  const { data: claimed, error: claimError } = await supabase
    .from("referral_rewards")
    .update({ push_notified_at: new Date().toISOString() })
    .eq("id", reward.id)
    .is("push_notified_at", null)
    .select("id")
    .maybeSingle();
  throwIfSupabaseError(claimError, "No se pudo reservar la notificación push");
  if (!claimed) return;
  await notifyReferralPurchase({ referrerCustomerId: referral.referrer_customer_id, amount: reward.amount, currency: reward.currency, orderReference: orderId });
}

async function ensureReward(input) {
  const { data, error } = await supabase.from("referral_rewards").insert({
    referral_id: input.referralId,
    recipient_customer_id: input.recipientCustomerId,
    source_order_id: input.sourceOrderId,
    reward_type: input.rewardType,
    amount: input.amount,
    currency: input.currency,
    status: input.status,
    idempotency_key: input.idempotencyKey,
    rule_snapshot: input.ruleSnapshot || {},
    available_at: input.availableAt || null,
    expires_at: input.expiresAt || null,
    used_at: input.status === "used" ? new Date().toISOString() : null
  }).select("id,amount,currency,status").single();
  if (!error) return data;
  if (error.code !== "23505") throwIfSupabaseError(error, "No se pudo crear la recompensa de referido");
  const existing = await supabase.from("referral_rewards").select("id,amount,currency,status").eq("idempotency_key", input.idempotencyKey).single();
  throwIfSupabaseError(existing.error, "No se pudo cargar la recompensa existente");
  return existing.data;
}

async function ensureWalletCredit(reward, customerId, orderId, currency) {
  const idempotencyKey = `reward:${reward.id}:credit`;
  const { error } = await supabase.from("referral_wallet_entries").insert({
    customer_id: customerId,
    reward_id: reward.id,
    order_id: orderId,
    entry_type: "credit",
    amount: reward.amount,
    currency: currency || reward.currency,
    idempotency_key: idempotencyKey,
    metadata: { source: "referral_qualification" }
  });
  if (error && error.code !== "23505") throwIfSupabaseError(error, "No se pudo acreditar el crédito de referido");
}

async function hasReachedRewardLimit(customerId, limit) {
  if (limit == null) return false;
  const { count, error } = await supabase
    .from("referral_rewards")
    .select("id", { count: "exact", head: true })
    .eq("recipient_customer_id", customerId)
    .eq("reward_type", "referrer_credit")
    .in("status", ["available", "used"]);
  throwIfSupabaseError(error, "No se pudo comprobar el límite de recompensas");
  return Number(count || 0) >= Number(limit);
}

function isMissingRelation(error) {
  return MISSING_RELATION_CODES.has(error?.code);
}

function isMissingFunction(error) {
  return error?.code === "PGRST202";
}

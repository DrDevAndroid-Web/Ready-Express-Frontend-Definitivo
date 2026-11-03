import { createHash, randomBytes } from "node:crypto";
import { supabase } from "../../config/supabase.js";
import { createBadRequest, createConflict, createNotFound, throwIfSupabaseError } from "../../utils/http-error.js";
import { assertNotSelfReferral, calculateReferralBalance, calculateReferralDiscount, normalizeReferralCode, roundMoney } from "./referral.rules.js";

const DEFAULT_PROGRAM = Object.freeze({
  enabled: false,
  name: "Programa de referidos",
  description: null,
  currency: "USD",
  attribution_window_days: 30,
  qualification_event: "payment_successful",
  rules: []
});

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function assertProgramActive(program) {
  if (!program?.enabled) throw createConflict("El programa de referidos no está activo");
  if (!(program.rules || []).some(rule => rule.active && rule.beneficiary_type === "referred_customer")) {
    throw createConflict("El programa de referidos no tiene una regla de beneficio configurada");
  }
  const now = Date.now();
  if (program.starts_at && now < Date.parse(program.starts_at)) throw createConflict("El programa de referidos todavía no ha comenzado");
  if (program.ends_at && now >= Date.parse(program.ends_at)) throw createConflict("El programa de referidos ya terminó");
}

export function generateReferralCode(length = 10, random = randomBytes) {
  if (!Number.isInteger(length) || length < 8 || length > 16) throw new Error("Longitud de código no válida");
  const bytes = random(length);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

export function hashReferralToken(token) {
  const value = String(token || "").trim();
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(value)) throw createBadRequest("El token de referido no es válido");
  return createHash("sha256").update(value).digest("hex");
}

async function customerProfileId(authUserId) {
  if (!authUserId) throw createBadRequest("La sesión del cliente es requerida");
  const { data, error } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  throwIfSupabaseError(error, "No se pudo cargar el perfil del cliente");
  if (!data?.id) throw createNotFound("Perfil de cliente no encontrado");
  return data.id;
}

export async function getReferralProgram() {
  const { data: program, error } = await supabase
    .from("referral_programs")
    .select("id,enabled,name,description,currency,starts_at,ends_at,attribution_window_days,qualification_event")
    .eq("singleton_key", "default")
    .maybeSingle();
  // Permite desplegar el backend antes de aplicar la migración: el programa
  // queda efectivamente apagado y los pedidos existentes siguen funcionando.
  if (isMissingReferralRelation(error)) return DEFAULT_PROGRAM;
  throwIfSupabaseError(error, "No se pudo cargar el programa de referidos");
  if (!program) return DEFAULT_PROGRAM;

  const { data: rules, error: rulesError } = await supabase
    .from("referral_rules")
    .select("beneficiary_type,reward_type,amount,minimum_purchase,maximum_discount,expires_after_days,max_rewards_per_referrer,active")
    .eq("program_id", program.id)
    .eq("active", true);
  if (isMissingReferralRelation(rulesError)) return { ...program, enabled: false, rules: [] };
  throwIfSupabaseError(rulesError, "No se pudieron cargar las reglas de referidos");
  return { ...program, rules: rules || [] };
}

function isMissingReferralRelation(error) {
  return ["PGRST205", "42P01"].includes(error?.code);
}

function isMissingFunction(error) {
  return error?.code === "PGRST202";
}

export async function getOrCreateReferralCode(authUserId) {
  const profileId = await customerProfileId(authUserId);
  const { data: existing, error: existingError } = await supabase
    .from("referral_codes")
    .select("id,code,active,created_at,revoked_at")
    .eq("customer_id", profileId)
    .maybeSingle();
  throwIfSupabaseError(existingError, "No se pudo cargar el código de referido");
  if (existing) return existing;

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from("referral_codes")
      .insert({ customer_id: profileId, code: generateReferralCode() })
      .select("id,code,active,created_at,revoked_at")
      .single();
    if (!error) return data;
    if (error.code !== "23505") throwIfSupabaseError(error, "No se pudo crear el código de referido");
  }
  throw createConflict("No se pudo generar un código de referido único");
}

// Devuelve solo el beneficio de primera compra del cliente autenticado. El total
// final se calcula en orders.service.js; el navegador nunca decide este importe.
export async function getReferralDiscountForOrder(authUserId, rawToken, eligibleSubtotal, currency = "USD") {
  if (!authUserId) return null;
  const profileId = await customerProfileId(authUserId);
  if (rawToken) await attachReferralClaim(rawToken, authUserId);

  const program = await getReferralProgram();
  if (!program.enabled || String(program.currency).toUpperCase() !== String(currency).toUpperCase()) return null;
  const { data: referral, error: referralError } = await supabase
    .from("referrals")
    .select("id,status,first_eligible_order_id,rule_snapshot")
    .eq("referred_customer_id", profileId)
    .in("status", ["registered", "purchase_pending"])
    .maybeSingle();
  throwIfSupabaseError(referralError, "No se pudo cargar la atribución de referido");
  if (!referral || referral.first_eligible_order_id) return null;

  const rule = (program.rules || []).find(item => item.active && item.beneficiary_type === "referred_customer");
  const amount = calculateReferralDiscount(rule, eligibleSubtotal);
  if (!amount) return null;
  const referrerRule = (program.rules || []).find(item => item.active && item.beneficiary_type === "referrer");
  return {
    referralId: referral.id,
    amount,
    currency: program.currency,
    ruleSnapshot: { referred: { ...rule }, referrer: referrerRule ? { ...referrerRule } : null }
  };
}

// El crédito del referente es un saldo de tienda: se puede aplicar a una compra
// posterior y nunca puede superar el subtotal elegible del pedido.
export async function getReferralCreditForOrder(authUserId, eligibleSubtotal, currency = "USD") {
  if (!authUserId) return null;
  const profileId = await customerProfileId(authUserId);
  const program = await getReferralProgram();
  if (!program.enabled || String(program.currency).toUpperCase() !== String(currency).toUpperCase()) return null;

  const { data: entries, error } = await supabase
    .from("referral_wallet_entries")
    .select("entry_type,amount,currency")
    .eq("customer_id", profileId)
    .eq("currency", program.currency);
  if (isMissingReferralRelation(error)) return null;
  throwIfSupabaseError(error, "No se pudo cargar el saldo de referidos");

  const balance = calculateReferralBalance(entries || []);
  const maximum = Math.max(0, roundMoney(eligibleSubtotal));
  const amount = Math.min(balance, maximum);
  if (!amount) return null;
  return { amount: roundMoney(amount), currency: program.currency, customerProfileId: profileId };
}

// Consume el saldo con una RPC atómica cuando la migración está instalada. El
// fallback mantiene compatibilidad durante el despliegue escalonado.
export async function redeemReferralWalletCredit({ authUserId, orderId, amount, currency = "USD" }) {
  const profileId = await customerProfileId(authUserId);
  const cleanAmount = roundMoney(amount);
  const idempotencyKey = `order:${orderId}:referral_credit`;
  const atomic = await supabase.rpc("redeem_referral_wallet_credit", {
    p_customer_id: profileId,
    p_order_id: orderId,
    p_amount: cleanAmount,
    p_currency: currency
  });
  if (!isMissingFunction(atomic.error)) {
    throwIfSupabaseError(atomic.error, "No se pudo aplicar el saldo de referidos");
    return atomic.data;
  }

  const { data: entries, error: balanceError } = await supabase
    .from("referral_wallet_entries")
    .select("entry_type,amount,currency")
    .eq("customer_id", profileId)
    .eq("currency", currency);
  if (isMissingReferralRelation(balanceError)) throwIfSupabaseError(balanceError, "El saldo de referidos no está disponible");
  throwIfSupabaseError(balanceError, "No se pudo comprobar el saldo de referidos");
  if (calculateReferralBalance(entries || []) < cleanAmount) throw createConflict("El saldo de referidos cambió; actualiza el checkout e inténtalo de nuevo");

  const { data: adjustment, error: adjustmentError } = await supabase
    .from("order_adjustments")
    .insert({ order_id: orderId, adjustment_type: "referral_credit", source_id: profileId, amount: cleanAmount, currency, metadata: { source: "referral_wallet" } })
    .select("id,order_id,adjustment_type,amount,currency")
    .single();
  throwIfSupabaseError(adjustmentError, "No se pudo registrar el uso del saldo de referidos");

  const { error: debitError } = await supabase.from("referral_wallet_entries").insert({
    customer_id: profileId,
    order_id: orderId,
    entry_type: "debit",
    amount: cleanAmount,
    currency,
    idempotency_key: idempotencyKey,
    metadata: { source: "referral_wallet", adjustment_id: adjustment.id }
  });
  if (debitError && debitError.code !== "23505") {
    await supabase.from("order_adjustments").delete().eq("id", adjustment.id);
    throwIfSupabaseError(debitError, "No se pudo descontar el saldo de referidos");
  }
  return adjustment;
}

export async function reverseReferralWalletDebit(orderId) {
  const { data: debits, error } = await supabase
    .from("referral_wallet_entries")
    .select("id,customer_id,reward_id,amount,currency,idempotency_key")
    .eq("order_id", orderId)
    .eq("entry_type", "debit");
  if (isMissingReferralRelation(error)) return;
  throwIfSupabaseError(error, "No se pudo cargar el uso del saldo de referidos");
  for (const debit of debits || []) {
    const { error: reversalError } = await supabase.from("referral_wallet_entries").insert({
      customer_id: debit.customer_id,
      reward_id: debit.reward_id || null,
      order_id: orderId,
      entry_type: "reversal",
      amount: debit.amount,
      currency: debit.currency,
      idempotency_key: `reversal:${debit.idempotency_key}`,
      metadata: { source: "order_cancelled", debit_id: debit.id }
    });
    if (reversalError && reversalError.code !== "23505") throwIfSupabaseError(reversalError, "No se pudo restaurar el saldo de referidos");
  }
}

export async function claimReferralCode(rawCode, authUserId = null) {
  const code = normalizeReferralCode(rawCode);
  const { data: codeRow, error: codeError } = await supabase
    .from("referral_codes")
    .select("id,code,customer_id,active")
    .eq("code", code)
    .eq("active", true)
    .maybeSingle();
  throwIfSupabaseError(codeError, "No se pudo validar el código de referido");
  if (!codeRow) throw createNotFound("Código de referido no encontrado o inactivo");

  const program = await getReferralProgram();
  assertProgramActive(program);
  const expiresAt = new Date(Date.now() + Number(program.attribution_window_days || 30) * 86400000).toISOString();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashReferralToken(token);
  let referredCustomerId = null;

  if (authUserId) {
    referredCustomerId = await customerProfileId(authUserId);
    assertNotSelfReferral(codeRow.customer_id, referredCustomerId);
  }

  const { data, error } = await supabase
    .from("referral_claims")
    .insert({
      referral_code_id: codeRow.id,
      referrer_customer_id: codeRow.customer_id,
      token_hash: tokenHash,
      expires_at,
      claimed_by_customer_id: referredCustomerId,
      claimed_at: referredCustomerId ? new Date().toISOString() : null
    })
    .select("id,expires_at,claimed_by_customer_id")
    .single();
  throwIfSupabaseError(error, "No se pudo guardar la atribución de referido");

  if (referredCustomerId) await attachClaimToReferral(data.id, referredCustomerId);
  return { token, expires_at: data.expires_at, code: codeRow.code };
}

export async function attachReferralClaim(rawToken, authUserId) {
  const tokenHash = hashReferralToken(rawToken);
  const referredCustomerId = await customerProfileId(authUserId);
  const { data: claim, error } = await supabase
    .from("referral_claims")
    .select("id,referrer_customer_id,expires_at,claimed_by_customer_id")
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  throwIfSupabaseError(error, "No se pudo cargar la atribución de referido");
  if (!claim) throw createNotFound("La atribución de referido no existe o expiró");
  if (claim.claimed_by_customer_id && claim.claimed_by_customer_id !== referredCustomerId) {
    throw createConflict("La atribución de referido ya fue utilizada");
  }
  assertNotSelfReferral(claim.referrer_customer_id, referredCustomerId);

  const { data: existing, error: existingError } = await supabase
    .from("referrals")
    .select("id,status")
    .eq("referred_customer_id", referredCustomerId)
    .maybeSingle();
  throwIfSupabaseError(existingError, "No se pudo comprobar la atribución del cliente");
  if (existing) return { referral_id: existing.id, status: existing.status, reused: true };

  const { data: claimed, error: claimError } = await supabase
    .from("referral_claims")
    .update({ claimed_by_customer_id: referredCustomerId, claimed_at: new Date().toISOString() })
    .eq("id", claim.id)
    .is("claimed_by_customer_id", null);
  throwIfSupabaseError(claimError, "No se pudo confirmar la atribución de referido");
  if (!claimed?.length) {
    const current = await supabase.from("referral_claims").select("claimed_by_customer_id").eq("id", claim.id).single();
    throwIfSupabaseError(current.error, "No se pudo comprobar la atribución de referido");
    if (current.data?.claimed_by_customer_id !== referredCustomerId) throw createConflict("La atribución de referido ya fue utilizada");
  }
  return attachClaimToReferral(claim.id, referredCustomerId);
}

async function attachClaimToReferral(claimId, referredCustomerId) {
  const { data: claim, error: claimError } = await supabase
    .from("referral_claims")
    .select("id,referral_code_id,referrer_customer_id")
    .eq("id", claimId)
    .single();
  throwIfSupabaseError(claimError, "No se pudo cargar la atribución de referido");

  const { data, error } = await supabase
    .from("referrals")
    .insert({
      referral_code_id: claim.referral_code_id,
      referrer_customer_id: claim.referrer_customer_id,
      referred_customer_id: referredCustomerId,
      status: "registered"
    })
    .select("id,status,created_at")
    .single();
  if (error?.code === "23505") {
    const existing = await supabase.from("referrals").select("id,status,created_at").eq("referred_customer_id", referredCustomerId).single();
    throwIfSupabaseError(existing.error, "No se pudo cargar la atribución existente");
    return { referral_id: existing.data.id, status: existing.data.status, created_at: existing.data.created_at, reused: true };
  }
  throwIfSupabaseError(error, "No se pudo crear la atribución de referido");
  return { referral_id: data.id, status: data.status, created_at: data.created_at, reused: false };
}

export async function getMyReferralSummary(authUserId) {
  const profileId = await customerProfileId(authUserId);
  const [codeResult, referralsResult, referredResult, rewardsResult, ledgerResult] = await Promise.all([
    supabase.from("referral_codes").select("id,code,active,created_at,revoked_at").eq("customer_id", profileId).maybeSingle(),
    supabase.from("referrals").select("id,status,created_at,qualified_at,first_eligible_order_id").eq("referrer_customer_id", profileId).order("created_at", { ascending: false }).limit(100),
    supabase.from("referrals").select("id,status,created_at,qualified_at,first_eligible_order_id").eq("referred_customer_id", profileId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("referral_rewards").select("id,referral_id,reward_type,amount,currency,status,expires_at,created_at").eq("recipient_customer_id", profileId).order("created_at", { ascending: false }).limit(100),
    supabase.from("referral_wallet_entries").select("entry_type,amount,currency,created_at").eq("customer_id", profileId).order("created_at", { ascending: true }).limit(500)
  ]);
  for (const result of [codeResult, referralsResult, referredResult, rewardsResult, ledgerResult]) throwIfSupabaseError(result.error, "No se pudo cargar el resumen de referidos");
  const program = await getReferralProgram();
  const referredRule = (program.rules || []).find(rule => rule.active && rule.beneficiary_type === "referred_customer") || null;
  return {
    code: codeResult.data,
    referrals: referralsResult.data || [],
    referred: referredResult.data || null,
    referred_promotion: referredRule ? {
      reward_type: referredRule.reward_type,
      amount: referredRule.amount,
      minimum_purchase: referredRule.minimum_purchase,
      maximum_discount: referredRule.maximum_discount,
      currency: program.currency
    } : null,
    rewards: rewardsResult.data || [],
    balance: calculateReferralBalance(ledgerResult.data || []),
    currency: rewardsResult.data?.[0]?.currency || program.currency || "USD"
  };
}

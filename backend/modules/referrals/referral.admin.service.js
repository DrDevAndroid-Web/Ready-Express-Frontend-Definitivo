import { supabase } from "../../config/supabase.js";
import { createBadRequest, createNotFound, throwIfSupabaseError } from "../../utils/http-error.js";
import { validateReferralProgramPayload, validateReferralRulePayload } from "./referral.rules.js";
import { getAdminReferralAnalytics } from "./referral.analytics.service.js";

function pagination(query = {}) {
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
  return { limit, offset };
}

export async function getAdminReferralProgram() {
  const { data, error } = await supabase.from("referral_programs").select("*").eq("singleton_key", "default").maybeSingle();
  throwIfSupabaseError(error, "No se pudo cargar la configuración de referidos");
  if (!data) throw createNotFound("La configuración del programa de referidos no existe");
  const rules = await supabase.from("referral_rules").select("*").eq("program_id", data.id).order("created_at", { ascending: true });
  throwIfSupabaseError(rules.error, "No se pudieron cargar las reglas de referidos");
  return { ...data, rules: rules.data || [] };
}

export async function updateAdminReferralProgram(payload) {
  const update = validateReferralProgramPayload(payload);
  const { data, error } = await supabase.from("referral_programs").update(update).eq("singleton_key", "default").select("*").single();
  throwIfSupabaseError(error, "No se pudo actualizar la configuración de referidos");
  return data;
}

export async function createAdminReferralRule(payload) {
  const program = await getAdminReferralProgram();
  const rule = validateReferralRulePayload(payload);
  const { data, error } = await supabase.from("referral_rules").insert({ ...rule, program_id: program.id }).select("*").single();
  throwIfSupabaseError(error, "No se pudo crear la regla de referidos");
  return data;
}

export async function updateAdminReferralRule(ruleId, payload) {
  const current = await supabase.from("referral_rules").select("beneficiary_type,reward_type,amount,minimum_purchase,maximum_discount,expires_after_days,max_rewards_per_referrer,active").eq("id", ruleId).maybeSingle();
  throwIfSupabaseError(current.error, "No se pudo cargar la regla de referidos");
  if (!current.data) throw createNotFound("Regla de referidos no encontrada");
  const rule = validateReferralRulePayload({ ...current.data, ...payload });
  const { data, error } = await supabase.from("referral_rules").update(rule).eq("id", ruleId).select("*").single();
  throwIfSupabaseError(error, "No se pudo actualizar la regla de referidos");
  return data;
}

export async function listAdminReferrals(query = {}) {
  const { limit, offset } = pagination(query);
  let request = supabase.from("referrals").select("*, referral_codes(code), referral_rewards(id,reward_type,amount,currency,status)").order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  if (query.status) request = request.eq("status", query.status);
  const { data, error } = await request;
  throwIfSupabaseError(error, "No se pudieron cargar las atribuciones de referidos");
  return data || [];
}

export async function listAdminReferralRewards(query = {}) {
  const { limit, offset } = pagination(query);
  let request = supabase.from("referral_rewards").select("*").order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  if (query.status) request = request.eq("status", query.status);
  if (query.reward_type) request = request.eq("reward_type", query.reward_type);
  const { data, error } = await request;
  throwIfSupabaseError(error, "No se pudieron cargar las recompensas de referidos");
  return data || [];
}

export async function getAdminReferralStats() {
  const [referrals, rewards, available, analytics] = await Promise.all([
    supabase.from("referrals").select("status", { count: "exact", head: false }),
    supabase.from("referral_rewards").select("status,amount", { count: "exact", head: false }),
    supabase.from("referral_rewards").select("amount").eq("status", "available"),
    getAdminReferralAnalytics()
  ]);
  for (const result of [referrals, rewards, available]) throwIfSupabaseError(result.error, "No se pudieron cargar las métricas de referidos");
  const byStatus = (rows) => (rows || []).reduce((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {});
  return {
    referrals: { total: referrals.count || 0, by_status: byStatus(referrals.data) },
    rewards: { total: rewards.count || 0, by_status: byStatus(rewards.data), available_amount: (available.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0) },
    analytics
  };
}

export async function reverseAdminReferralReward(rewardId, actorUserId, reason) {
  const cleanReason = String(reason || "").trim();
  if (cleanReason.length < 10 || cleanReason.length > 500) throw createBadRequest("La razón de reversión debe tener entre 10 y 500 caracteres");
  const { data, error } = await supabase.rpc("reverse_referral_reward", {
    p_reward_id: rewardId,
    p_actor_user_id: actorUserId,
    p_reason: cleanReason
  });
  throwIfSupabaseError(error, "No se pudo revertir la recompensa");
  return data;
}

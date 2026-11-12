import { supabase } from "../../config/supabase.js";
import { createBadRequest, throwIfSupabaseError } from "../../utils/http-error.js";
import { normalizeReferralCode } from "./referral.rules.js";

const EVENT_TYPES = new Set(["cta_click", "attribution_captured", "registration_completed", "first_purchase", "reward_issued"]);
const MISSING_RELATION_CODES = new Set(["PGRST205", "42P01"]);
const MAX_METADATA_BYTES = 4000;

function isMissingRelation(error) { return MISSING_RELATION_CODES.has(error?.code); }
function cleanText(value, max = 120) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}
function cleanMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try { return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_METADATA_BYTES ? value : {}; } catch { return {}; }
}

export function normalizeReferralAnalyticsEvent(input = {}) {
  const eventType = cleanText(input.event_type || input.eventType, 40);
  if (!EVENT_TYPES.has(eventType)) throw createBadRequest("El evento de referido no es válido");
  return {
    event_type: eventType,
    referral_code_id: cleanText(input.referral_code_id || input.referralCodeId, 80),
    referral_claim_id: cleanText(input.referral_claim_id || input.referralClaimId, 80),
    referral_id: cleanText(input.referral_id || input.referralId, 80),
    customer_id: cleanText(input.customer_id || input.customerId, 80),
    order_id: cleanText(input.order_id || input.orderId, 80),
    placement: cleanText(input.placement, 60),
    session_id: cleanText(input.session_id || input.sessionId, 128),
    idempotency_key: cleanText(input.idempotency_key || input.idempotencyKey, 180),
    metadata: cleanMetadata(input.metadata)
  };
}

export async function recordReferralEvent(input = {}) {
  const payload = normalizeReferralAnalyticsEvent(input);
  const { data, error } = await supabase.from("referral_events").insert(payload).select("id,event_type,created_at").maybeSingle();
  if (isMissingRelation(error)) return null;
  if (error?.code === "23505" && payload.idempotency_key) return null;
  throwIfSupabaseError(error, "No se pudo registrar la métrica de referidos");
  return data;
}

export async function recordPublicReferralEvent(input = {}) {
  const event = normalizeReferralAnalyticsEvent(input);
  if (event.event_type !== "cta_click") throw createBadRequest("Solo se pueden registrar clics públicos");
  let referralCodeId = null;
  const rawCode = cleanText(input.code || input.referral_code, 32);
  if (rawCode) {
    try {
      const code = normalizeReferralCode(rawCode);
      const result = await supabase.from("referral_codes").select("id").eq("code", code).eq("active", true).maybeSingle();
      if (result.error && !isMissingRelation(result.error)) throwIfSupabaseError(result.error, "No se pudo validar el código de referido");
      referralCodeId = result.data?.id || null;
    } catch (error) {
      if (error?.status !== 400) throw error;
    }
  }
  return recordReferralEvent({
    event_type: event.event_type,
    referral_code_id: referralCodeId,
    placement: event.placement,
    session_id: event.session_id,
    idempotency_key: event.idempotency_key,
    metadata: event.metadata
  });
}

function emptyAnalytics() {
  return { total_events: 0, unique_sessions: 0, by_type: {}, by_placement: {}, funnel: { cta_click: 0, attribution_captured: 0, registration_completed: 0, first_purchase: 0, reward_issued: 0 }, conversion_rates: {}, daily: [] };
}

export async function getAdminReferralAnalytics() {
  const { data, error } = await supabase.from("referral_events").select("event_type,placement,session_id,occurred_at").order("occurred_at", { ascending: false }).limit(10000);
  if (isMissingRelation(error)) return emptyAnalytics();
  throwIfSupabaseError(error, "No se pudieron cargar las analíticas de referidos");
  const rows = data || [];
  const byType = {}, byPlacement = {}, sessions = new Set(), dailyMap = new Map();
  for (const row of rows) {
    byType[row.event_type] = (byType[row.event_type] || 0) + 1;
    if (row.placement) byPlacement[row.placement] = (byPlacement[row.placement] || 0) + 1;
    if (row.session_id) sessions.add(row.session_id);
    const day = String(row.occurred_at || "").slice(0, 10);
    if (day) {
      const current = dailyMap.get(day) || { date: day, total: 0, by_type: {} };
      current.total += 1;
      current.by_type[row.event_type] = (current.by_type[row.event_type] || 0) + 1;
      dailyMap.set(day, current);
    }
  }
  const funnel = { cta_click: byType.cta_click || 0, attribution_captured: byType.attribution_captured || 0, registration_completed: byType.registration_completed || 0, first_purchase: byType.first_purchase || 0, reward_issued: byType.reward_issued || 0 };
  const rate = (numerator, denominator) => denominator ? Number((numerator / denominator * 100).toFixed(1)) : 0;
  return {
    total_events: rows.length,
    unique_sessions: sessions.size,
    by_type: byType,
    by_placement: byPlacement,
    funnel,
    conversion_rates: {
      click_to_attribution: rate(funnel.attribution_captured, funnel.cta_click),
      attribution_to_registration: rate(funnel.registration_completed, funnel.attribution_captured),
      registration_to_purchase: rate(funnel.first_purchase, funnel.registration_completed),
      purchase_to_reward: rate(funnel.reward_issued, funnel.first_purchase)
    },
    daily: [...dailyMap.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30)
  };
}

export { EVENT_TYPES };

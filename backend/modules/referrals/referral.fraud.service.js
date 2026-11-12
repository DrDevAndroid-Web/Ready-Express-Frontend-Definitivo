import { createHmac } from "node:crypto";
import { supabase } from "../../config/supabase.js";

const MISSING_RELATION_CODES = new Set(["PGRST205", "42P01"]);

function isMissingRelation(error) {
  return MISSING_RELATION_CODES.has(error?.code);
}

function antifraudMode() {
  const configured = String(process.env.REFERRAL_ANTIFRAUD_MODE || "").trim().toLowerCase();
  if (["shadow", "enforce", "off"].includes(configured)) return configured;
  return process.env.NODE_ENV === "production" ? "enforce" : "shadow";
}

function numberEnv(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function fraudSecret() {
  return String(process.env.REFERRAL_ANTIFRAUD_SECRET || "readyexpress-development-antifraud");
}

export function hashRiskValue(value, purpose = "value") {
  const clean = String(value || "").trim();
  if (!clean) return null;
  return createHmac("sha256", fraudSecret()).update(`${purpose}:${clean}`).digest("hex");
}

export function buildReferralRiskContext({ ip, userAgent, deviceId, sessionId } = {}) {
  return {
    ipHash: hashRiskValue(ip, "ip"),
    // Si no llega un identificador persistente, no convertimos el User-Agent
    // compartido por muchos clientes en un falso "mismo dispositivo".
    deviceHash: hashRiskValue(deviceId, "device"),
    sessionHash: hashRiskValue(sessionId, "session"),
    userAgent: String(userAgent || "").slice(0, 400) || null
  };
}

export function evaluateReferralRisk({
  ipClaims = 0,
  deviceClaims = 0,
  sessionClaims = 0,
  codeClaims = 0,
  sharedDeviceAccounts = 0,
  duplicatePhoneAccounts = 0,
  selfReferral = false,
  existingCustomer = false
} = {}) {
  const reasons = [];
  let score = 0;
  const add = (reason, points) => { reasons.push(reason); score += points; };

  if (selfReferral) add("self_referral", 100);
  if (existingCustomer) add("existing_customer", 100);
  if (ipClaims >= numberEnv("REFERRAL_ANTIFRAUD_IP_CLAIMS_REVIEW", 4)) add("ip_velocity", 25);
  if (deviceClaims >= numberEnv("REFERRAL_ANTIFRAUD_DEVICE_CLAIMS_REVIEW", 3)) add("device_velocity", 35);
  if (sessionClaims >= numberEnv("REFERRAL_ANTIFRAUD_SESSION_CLAIMS_REVIEW", 2)) add("session_velocity", 20);
  if (codeClaims >= numberEnv("REFERRAL_ANTIFRAUD_CODE_CLAIMS_REVIEW", 20)) add("code_velocity", 20);
  if (sharedDeviceAccounts >= 2) add("shared_device_accounts", 45);
  if (duplicatePhoneAccounts >= 2) add("duplicate_phone_accounts", 20);

  const blockScore = numberEnv("REFERRAL_ANTIFRAUD_BLOCK_SCORE", 80);
  const reviewScore = numberEnv("REFERRAL_ANTIFRAUD_REVIEW_SCORE", 45);
  const decision = score >= blockScore ? "block" : score >= reviewScore ? "review" : "allow";
  return { score, decision, reasons };
}

async function countRecent(column, value, since) {
  if (!value) return 0;
  const result = await supabase.from("referral_risk_events").select("id", { count: "exact", head: true })
    .eq(column, value).gte("created_at", since);
  if (result.error) {
    if (!isMissingRelation(result.error)) console.error("[referral-fraud] history", result.error.message || result.error);
    return 0;
  }
  return result.count || 0;
}

async function countSharedDeviceAccounts(deviceHash, since) {
  if (!deviceHash) return 0;
  const result = await supabase.from("referral_risk_events").select("customer_id")
    .eq("device_hash", deviceHash).not("customer_id", "is", null).gte("created_at", since).limit(100);
  if (result.error) {
    if (!isMissingRelation(result.error)) console.error("[referral-fraud] device history", result.error.message || result.error);
    return 0;
  }
  return new Set((result.data || []).map(row => row.customer_id).filter(Boolean)).size;
}

export async function assessReferralRisk({
  eventType = "claim_attempt",
  referralCodeId = null,
  referralClaimId = null,
  referralId = null,
  customerId = null,
  referrerCustomerId = null,
  existingCustomer = false,
  context = {}
} = {}) {
  const now = Date.now();
  const since10m = new Date(now - 10 * 60 * 1000).toISOString();
  const since30m = new Date(now - 30 * 60 * 1000).toISOString();
  const since1h = new Date(now - 60 * 60 * 1000).toISOString();
  const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const [ipClaims, deviceClaims, sessionClaims, codeClaims, sharedDeviceAccounts] = await Promise.all([
    countRecent("ip_hash", context.ipHash, since10m),
    countRecent("device_hash", context.deviceHash, since24h),
    countRecent("session_hash", context.sessionHash, since30m),
    countRecent("referral_code_id", referralCodeId, since1h),
    countSharedDeviceAccounts(context.deviceHash, since24h)
  ]);
  const result = evaluateReferralRisk({
    ipClaims,
    deviceClaims,
    sessionClaims,
    codeClaims,
    sharedDeviceAccounts,
    selfReferral: Boolean(referrerCustomerId && customerId && referrerCustomerId === customerId),
    existingCustomer
  });
  const mode = antifraudMode();
  return {
    ...result,
    mode,
    blocked: mode === "enforce" && result.decision === "block",
    observedDecision: result.decision,
    context,
    counts: { ipClaims, deviceClaims, sessionClaims, codeClaims, sharedDeviceAccounts },
    eventType,
    referralCodeId,
    referralClaimId,
    referralId,
    customerId
  };
}

export async function recordReferralRiskEvent(assessment, metadata = {}) {
  if (!assessment) return null;
  const payload = {
    event_type: assessment.eventType || "claim_attempt",
    decision: assessment.observedDecision || assessment.decision || "allow",
    enforced: Boolean(assessment.blocked),
    risk_score: Number(assessment.score || 0),
    reason_codes: assessment.reasons || [],
    referral_code_id: assessment.referralCodeId || null,
    referral_claim_id: assessment.referralClaimId || null,
    referral_id: assessment.referralId || null,
    customer_id: assessment.customerId || null,
    ip_hash: assessment.context?.ipHash || null,
    device_hash: assessment.context?.deviceHash || null,
    session_hash: assessment.context?.sessionHash || null,
    user_agent: assessment.context?.userAgent || null,
    metadata: { ...metadata, mode: assessment.mode, counts: assessment.counts || {} }
  };
  const { data, error } = await supabase.from("referral_risk_events").insert(payload).select("id").single();
  if (error) {
    if (!isMissingRelation(error)) console.error("[referral-fraud] record", error.message || error);
    return null;
  }
  return data;
}

export async function assessReferralPurchaseRisk({ context = {} } = {}) {
  const assessment = await assessReferralRisk({
    eventType: "purchase_attempt",
    context: buildReferralRiskContext(context)
  });
  await recordReferralRiskEvent(assessment, { source: "purchase" });
  return assessment;
}

export function getReferralAntifraudMode() {
  return antifraudMode();
}

export async function listAdminReferralRiskEvents(query = {}) {
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
  let request = supabase.from("referral_risk_events")
    .select("id,event_type,decision,enforced,risk_score,reason_codes,referral_code_id,referral_claim_id,referral_id,customer_id,user_agent,metadata,created_at")
    .order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  if (["allow", "review", "block"].includes(query.decision)) request = request.eq("decision", query.decision);
  const { data, error } = await request;
  if (isMissingRelation(error)) return [];
  if (error) throw new Error("No se pudieron cargar los riesgos de referidos");
  return data || [];
}

export async function getAdminReferralRiskStats() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("referral_risk_events")
    .select("decision,enforced,risk_score,reason_codes,created_at").gte("created_at", since).limit(10000);
  if (isMissingRelation(error)) return { mode: antifraudMode(), total_24h: 0, by_decision: {}, top_reasons: [], table_ready: false };
  if (error) throw new Error("No se pudieron cargar las métricas antifraude");
  const byDecision = {};
  const reasons = {};
  for (const row of data || []) {
    byDecision[row.decision] = (byDecision[row.decision] || 0) + 1;
    for (const reason of row.reason_codes || []) reasons[reason] = (reasons[reason] || 0) + 1;
  }
  const topReasons = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([reason, count]) => ({ reason, count }));
  return { mode: antifraudMode(), total_24h: data?.length || 0, by_decision: byDecision, top_reasons: topReasons, table_ready: true };
}

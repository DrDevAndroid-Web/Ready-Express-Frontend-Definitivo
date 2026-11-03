import "dotenv/config";
import { randomUUID } from "node:crypto";

const target = String(process.env.REFERRALS_TARGET || "").toLowerCase();
const confirmation = process.env.REFERRALS_STAGING_CONFIRM;
const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
const productionProjectRef = process.env.REFERRALS_PRODUCTION_PROJECT_REF;

function fail(message) {
  throw new Error(`[referrals:staging-preflight] ${message}`);
}

if (target !== "staging") fail("REFERRALS_TARGET debe ser exactamente 'staging'.");
if (confirmation !== "READY") fail("Se requiere REFERRALS_STAGING_CONFIRM=READY.");
if (process.env.NODE_ENV === "production") fail("No se permite ejecutar el preflight con NODE_ENV=production.");
if (!supabaseUrl || !serviceRoleKey || !anonKey) fail("Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o SUPABASE_ANON_KEY.");

const parsedUrl = new URL(supabaseUrl);
const projectRef = parsedUrl.hostname.split(".")[0];
if (!projectRef || projectRef === parsedUrl.hostname) fail("SUPABASE_URL no parece ser un proyecto Supabase válido.");
if (productionProjectRef && projectRef === productionProjectRef) fail("El proyecto indicado coincide con REFERRALS_PRODUCTION_PROJECT_REF.");

async function request(path, key, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

const requiredColumns = {
  referral_programs: ["id", "singleton_key", "enabled", "currency", "qualification_event"],
  referral_rules: ["id", "program_id", "beneficiary_type", "reward_type", "amount", "active"],
  referral_codes: ["id", "customer_id", "code", "active"],
  referral_claims: ["id", "referral_code_id", "token_hash", "expires_at", "claimed_by_customer_id"],
  referrals: ["id", "referrer_customer_id", "referred_customer_id", "status", "first_eligible_order_id", "rule_snapshot"],
  referral_rewards: ["id", "referral_id", "recipient_customer_id", "source_order_id", "reward_type", "amount", "status", "idempotency_key"],
  referral_wallet_entries: ["id", "customer_id", "reward_id", "order_id", "entry_type", "amount", "idempotency_key"],
  order_adjustments: ["id", "order_id", "adjustment_type", "source_id", "amount", "metadata"],
  referral_admin_actions: ["id", "actor_user_id", "action", "reward_id", "reason", "idempotency_key"]
};

for (const [table, columns] of Object.entries(requiredColumns)) {
  const { response, body } = await request(`${table}?select=*&limit=1`, serviceRoleKey);
  if (!response.ok) fail(`La tabla ${table} no está disponible (${response.status}): ${JSON.stringify(body)}`);
  const schemaProbe = await request(`${table}?select=${columns.join(",")}&limit=0`, serviceRoleKey);
  if (!schemaProbe.response.ok) fail(`La tabla ${table} no tiene el esquema esperado (${schemaProbe.response.status}): ${JSON.stringify(schemaProbe.body)}`);
}

const rpc = await request("rpc/qualify_referral_order", serviceRoleKey, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ p_order_id: randomUUID() })
});
if (!rpc.response.ok || rpc.body?.reason !== "order_not_found") {
  fail(`La RPC qualify_referral_order no responde como se esperaba (${rpc.response.status}): ${JSON.stringify(rpc.body)}`);
}

const anonProbe = await request("referral_programs?select=*&limit=1", anonKey);
if (anonProbe.response.ok && Array.isArray(anonProbe.body) && anonProbe.body.length > 0) {
  fail("anon pudo leer datos de referral_programs; revisar RLS/grants antes de continuar.");
}

console.log(JSON.stringify({
  ok: true,
  target: "staging",
  project_ref: projectRef,
  tables: "available_with_service_role",
  qualification_rpc: "available_and_closed_contract",
  anon_probe: anonProbe.response.ok ? "no_rows_visible" : `blocked_${anonProbe.response.status}`
}, null, 2));

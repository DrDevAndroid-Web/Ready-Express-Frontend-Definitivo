import { API_BASE } from "./config.js?v68";
import { attachPendingReferral, getDeviceId, safeReturnPath, saveSession } from "./auth.js?v68";

const PENDING_PHONE_KEY = "ren_pending_phone_auth";
const SUPABASE_JS_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.101.1/+esm";
let clientPromise;

export function normalizeCubanPhone(value) {
  const digits = String(value || "").replace(/\D/g, "").replace(/^53/, "");
  if (!/^5\d{7}$/.test(digits)) throw new Error("Escribe un número móvil cubano válido de 8 dígitos.");
  return `+53${digits}`;
}

export function maskPhone(phone) {
  const value = String(phone || "");
  return value.replace(/^(\+53\s?5\d)\d{4}(\d{2})$/, "$1••••$2");
}

export function getPendingPhoneAuth() {
  try { return JSON.parse(localStorage.getItem(PENDING_PHONE_KEY) || "null"); } catch { return null; }
}

export function savePendingPhoneAuth(phone, returnPath = "") {
  const state = { phone, mode: "login", requestedAt: Date.now(), returnPath: returnPath || "" };
  try { localStorage.setItem(PENDING_PHONE_KEY, JSON.stringify(state)); } catch { /* continúa aunque el almacenamiento esté bloqueado */ }
  return state;
}

export function clearPendingPhoneAuth() {
  try { localStorage.removeItem(PENDING_PHONE_KEY); } catch {}
}

async function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const response = await fetch(`${API_BASE}/auth/config`, { headers: { Accept: "application/json" } });
      const config = await response.json().catch(() => ({}));
      if (!response.ok || !config.phone_enabled || !config.supabase_url || !config.supabase_anon_key) {
        throw new Error("La autenticación por teléfono no está habilitada en este entorno.");
      }
      const { createClient } = await import(SUPABASE_JS_URL);
      return createClient(config.supabase_url, config.supabase_anon_key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce" }
      });
    })();
  }
  return clientPromise;
}

export async function requestPhoneCode(phone, returnPath = "") {
  const normalized = normalizeCubanPhone(phone);
  const client = await getSupabaseClient();
  const { error } = await client.auth.signInWithOtp({ phone: normalized, options: { shouldCreateUser: true } });
  if (error) throw error;
  return savePendingPhoneAuth(normalized, returnPath);
}

export async function verifyPhoneCode(code) {
  const pending = getPendingPhoneAuth();
  if (!pending?.phone) throw new Error("No hay una verificación telefónica pendiente.");
  const token = String(code || "").replace(/\D/g, "");
  if (!/^\d{6,10}$/.test(token)) throw new Error("Escribe el código SMS de 6 a 10 dígitos.");
  const client = await getSupabaseClient();
  const { data, error } = await client.auth.verifyOtp({ phone: pending.phone, token, type: "sms" });
  if (error || !data?.session) throw error || new Error("No se pudo confirmar el código SMS.");
  const response = await fetch(`${API_BASE}/auth/phone/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify({ device_id: getDeviceId() })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "No se pudo completar el acceso telefónico.");
  saveSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_at: data.session.expires_at, user: body.user || data.user });
  await attachPendingReferral();
  clearPendingPhoneAuth();
  const target = pending.returnPath === "checkout" ? "./checkout.html" : safeReturnPath() || "./cuenta.html";
  location.href = target;
}

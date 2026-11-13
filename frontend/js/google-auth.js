import { API_BASE } from "./config.js?v68";
import { attachPendingReferral, getDeviceId, safeReturnPath, saveSession } from "./auth.js?v68";

const SUPABASE_JS_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.101.1/+esm";
let clientPromise;

async function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const response = await fetch(`${API_BASE}/auth/config`, { headers: { Accept: "application/json" } });
      const config = await response.json().catch(() => ({}));
      if (!response.ok || !config.google_enabled || !config.supabase_url || !config.supabase_anon_key) {
        throw new Error("El acceso con Google todavía no está habilitado en este entorno.");
      }
      const { createClient } = await import(SUPABASE_JS_URL);
      return createClient(config.supabase_url, config.supabase_anon_key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
      });
    })();
  }
  return clientPromise;
}

export async function startGoogleLogin() {
  const client = await getSupabaseClient();
  const redirect = new URL("./login-v25.html", location.href);
  const returnTarget = new URLSearchParams(location.search).get("return");
  if (returnTarget) redirect.searchParams.set("return", returnTarget);
  if (new URLSearchParams(location.search).get("backend") === "local") redirect.searchParams.set("backend", "local");
  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirect.href,
      queryParams: { prompt: "select_account" }
    }
  });
  if (error) throw error;
}

export async function completeGoogleLogin() {
  const hasOAuthCallback = Boolean(new URLSearchParams(location.search).get("code") || location.hash.includes("access_token="));
  if (!hasOAuthCallback) return false;
  const client = await getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const session = data?.session;
  if (!session?.access_token) return false;

  const response = await fetch(`${API_BASE}/auth/google/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ device_id: getDeviceId() })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "No se pudo completar el acceso con Google");

  saveSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    user: body.user || session.user
  });
  await attachPendingReferral();
  history.replaceState({}, document.title, `${location.pathname}${location.search}`);
  const target = safeReturnPath();
  location.href = target || "./cuenta.html";
  return true;
}

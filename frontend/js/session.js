// Sesión del cliente: los access_token de Supabase caducan (≈1 h). Antes de usarlos se
// renuevan con el refresh_token, y ante un 401 se renueva y se reintenta una sola vez.
import { API_BASE } from "./config.js?v40";

const ACCESS_KEY = "ren_access_token";
const REFRESH_KEY = "ren_refresh_token";
const USER_KEY = "ren_user";
const EXPIRY_MARGIN_MS = 60_000;

const read = key => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* almacenamiento bloqueado */ } };
const remove = key => { try { localStorage.removeItem(key); } catch { /* almacenamiento bloqueado */ } };

export function storeSession(data) {
  write(ACCESS_KEY, data?.access_token || "");
  write(REFRESH_KEY, data?.refresh_token || "");
  if (data?.user) write(USER_KEY, JSON.stringify(data.user));
}

export function clearStoredSession() {
  [ACCESS_KEY, REFRESH_KEY, USER_KEY].forEach(remove);
}

// Caducidad leída del propio JWT (campo exp), así sirve también para sesiones ya guardadas
function tokenExpiresAt(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return Number(payload.exp) * 1000 || 0;
  } catch {
    return 0;
  }
}

let refreshing = null;

export function refreshSession() {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = read(REFRESH_KEY);
      if (!refreshToken) { clearStoredSession(); return ""; }
      try {
        const response = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken })
        });
        if (!response.ok) {
          // Refresh inválido o revocado: la sesión terminó
          if (response.status === 400 || response.status === 401) clearStoredSession();
          return "";
        }
        const data = await response.json();
        if (!data?.access_token) { clearStoredSession(); return ""; }
        storeSession(data);
        return data.access_token;
      } catch {
        return ""; // sin red: se conserva la sesión para reintentar más tarde
      }
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

// Token listo para usar ("" si no hay sesión). Renueva si caduca en menos de un minuto.
export async function getValidAccessToken() {
  const token = read(ACCESS_KEY);
  if (!token) return "";
  const expiresAt = tokenExpiresAt(token);
  if (expiresAt && expiresAt - Date.now() < EXPIRY_MARGIN_MS) return refreshSession();
  return token;
}

// fetch con Authorization; ante un 401 renueva la sesión y reintenta una vez
export async function authorizedFetch(url, options = {}, fetchImpl = fetch) {
  const send = token => fetchImpl(url, {
    ...options,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });
  const token = await getValidAccessToken();
  const response = await send(token);
  if (response.status !== 401 || !token) return response;
  const renewed = await refreshSession();
  return renewed ? send(renewed) : response;
}

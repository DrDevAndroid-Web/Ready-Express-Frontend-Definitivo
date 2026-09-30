import { API_BASE } from "./config.js?v28";
import { authorizedFetch, clearStoredSession, storeSession } from "./session.js?v28";
const ACCESS_KEY = "ren_access_token";
export function getAccessToken() { try { return localStorage.getItem(ACCESS_KEY) || ""; } catch { return ""; } }
export function getCurrentUser() { try { return JSON.parse(localStorage.getItem("ren_user") || "null"); } catch { return null; } }
export function saveSession(data) { storeSession(data); }
export function clearSession() { clearStoredSession(); }
async function authRequest(path, options = {}) { const response = await authorizedFetch(`${API_BASE}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } }); const body = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(body.error || "No se pudo completar la operación"); error.status = response.status; throw error; } return body; }
export async function registerCustomer(data) { const result = await authRequest("/auth/register", { method: "POST", body: JSON.stringify(data) }); if (result.access_token) saveSession(result); return result; }
export async function requestPasswordReset(email) { return authRequest("/auth/recover-password", { method: "POST", body: JSON.stringify({ email }) }); }
// Página a la que volver tras iniciar sesión (?return=). Solo páginas propias conocidas,
// para que el parámetro no sirva para redirigir a otro sitio.
const RETURN_PAGES = ["pago-confirmado.html", "pago-rechazado.html"];
export function safeReturnPath() {
  const target = new URLSearchParams(location.search).get("return") || "";
  if (target === "checkout") return "./checkout.html";
  const [page, query = ""] = target.split("?");
  if (!RETURN_PAGES.includes(page)) return null;
  return `./${page}${query ? `?${new URLSearchParams(query)}` : ""}`;
}
export async function loginCustomer(email, password) { const result = await authRequest("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); saveSession(result); const target = safeReturnPath(); if (target) location.href = target; return result; }
export async function getMyProfile() { return authRequest("/auth/profile"); }
export async function getMyOrders() { return authRequest("/account/orders"); }
export async function updateMyProfile(data) { return authRequest("/auth/profile", { method: "PATCH", body: JSON.stringify(data) }); }
export async function getMyAddresses() { return authRequest("/account/addresses"); }
export async function createMyAddress(data) { return authRequest("/account/addresses", { method: "POST", body: JSON.stringify(data) }); }
export async function updateMyAddress(id, data) { return authRequest(`/account/addresses/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) }); }
export async function deleteMyAddress(id) { return authRequest(`/account/addresses/${encodeURIComponent(id)}`, { method: "DELETE" }); }
export async function resetPassword(recoveryAccessToken, password) { const response = await fetch(`${API_BASE}/auth/reset-password`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${recoveryAccessToken}` }, body: JSON.stringify({ password }) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(response.status === 401 ? "El enlace de recuperación expiró. Solicita uno nuevo." : body.error || "No se pudo actualizar la contraseña"); return body; }

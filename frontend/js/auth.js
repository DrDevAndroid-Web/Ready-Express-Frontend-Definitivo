import { API_BASE, attachReferralClaim } from "./api.js?v53";
import { authorizedFetch, clearStoredSession, storeSession } from "./session.js?v53";
import { clearReferralClaim, clearReferralPromotionState, clearReferralWalletState, getReferralClaimToken } from "./referrals.js?v53";
const ACCESS_KEY = "ren_access_token";
export function getAccessToken() { try { return localStorage.getItem(ACCESS_KEY) || ""; } catch { return ""; } }
export function getCurrentUser() { try { return JSON.parse(localStorage.getItem("ren_user") || "null"); } catch { return null; } }
export function saveSession(data) { storeSession(data); }
export function clearSession() { clearStoredSession(); clearReferralWalletState(); clearReferralPromotionState(); }
// Identificador aleatorio de este navegador: el backend avisa por email al entrar desde uno nuevo
function getDeviceId() {
  try {
    let id = localStorage.getItem("ren_device_id");
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("ren_device_id", id);
    }
    return id;
  } catch {
    return ""; // almacenamiento bloqueado: el backend usa el user agent
  }
}
async function authRequest(path, options = {}) { const response = await authorizedFetch(`${API_BASE}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } }); const body = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(body.error || "No se pudo completar la operación"); error.status = response.status; error.code = body.code || ""; throw error; } return body; }
async function attachPendingReferral() {
  const token = getReferralClaimToken();
  if (!token) return;
  try {
    await attachReferralClaim(token);
    clearReferralClaim();
  } catch (error) {
    // Un token ya usado/expirado no debe bloquear el acceso; los errores de red
    // conservan el token para poder reintentar en la siguiente navegación.
    if ([404, 409].includes(error?.status || error?.originalError?.status)) clearReferralClaim();
  }
}
export async function registerCustomer(data) { const result = await authRequest("/auth/register", { method: "POST", body: JSON.stringify({ ...data, device_id: getDeviceId() }) }); if (result.access_token) { saveSession(result); await attachPendingReferral(); } return result; }
// Confirma la cuenta con el código del email y deja la sesión iniciada
export async function verifyEmailCode(email, code) { const result = await authRequest("/auth/verify-email-code", { method: "POST", body: JSON.stringify({ email, code, device_id: getDeviceId() }) }); saveSession(result); await attachPendingReferral(); return result; }
export async function resendConfirmationEmail(email) { return authRequest("/auth/resend-confirmation", { method: "POST", body: JSON.stringify({ email }) }); }
// Login rechazado porque la cuenta aún no confirmó el email (el backend antiguo solo manda el texto)
export function isEmailNotConfirmed(err) { return err?.code === "email_not_confirmed" || /confirma tu email/i.test(err?.message || ""); }
export function isExistingAccount(err) { return err?.status === 409 || /ya existe una cuenta/i.test(err?.message || ""); }
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
// Mantiene ?return= al pasar entre login y registro y, si viene del checkout,
// explica por qué se pide la cuenta para cualquier compra
export function applyReturnContext() {
  const target = new URLSearchParams(location.search).get("return");
  if (!target || !safeReturnPath()) return;
  document.querySelectorAll('a[href^="./login-v25.html"], a[href^="./registro-v25.html"]').forEach(link => {
    const url = new URL(link.getAttribute("href"), location.href);
    url.searchParams.set("return", target);
    link.setAttribute("href", `./${url.pathname.split("/").pop()}${url.search}`);
  });
  if (target !== "checkout") return;
  const lead = document.querySelector(".auth-lead");
  if (!lead) return;
  const notice = document.createElement("p");
  notice.className = "auth-msg is-info auth-return-notice";
  // .auth-msg es flex: el texto va en un solo <span> para que no se parta en columnas
  notice.innerHTML = '<i class="fa-solid fa-lock" aria-hidden="true"></i><span>Para completar cualquier compra necesitas una cuenta gratuita. <strong>Tu carrito y los datos del envío se guardan</strong>: al terminar vuelves al checkout.</span>';
  lead.after(notice);
}
export async function loginCustomer(email, password) { const result = await authRequest("/auth/login", { method: "POST", body: JSON.stringify({ email, password, device_id: getDeviceId() }) }); saveSession(result); await attachPendingReferral(); const target = safeReturnPath(); if (target) location.href = target; return result; }
export async function getMyProfile() { return authRequest("/auth/profile"); }
export async function getMyOrders() { return authRequest("/account/orders"); }
export async function updateMyProfile(data) { return authRequest("/auth/profile", { method: "PATCH", body: JSON.stringify(data) }); }
export async function getMyAddresses() { return authRequest("/account/addresses"); }
export async function createMyAddress(data) { return authRequest("/account/addresses", { method: "POST", body: JSON.stringify(data) }); }
export async function updateMyAddress(id, data) { return authRequest(`/account/addresses/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) }); }
export async function deleteMyAddress(id) { return authRequest(`/account/addresses/${encodeURIComponent(id)}`, { method: "DELETE" }); }
export async function resetPassword(recoveryAccessToken, password) { const response = await fetch(`${API_BASE}/auth/reset-password`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${recoveryAccessToken}` }, body: JSON.stringify({ password }) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(response.status === 401 ? "El enlace de recuperación expiró. Solicita uno nuevo." : body.error || "No se pudo actualizar la contraseña"); return body; }

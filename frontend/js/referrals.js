import { claimReferralCode, getMyReferralSummary, getReferralProgram, trackReferralEvent as sendReferralEvent } from "./api.js?v68";
import { getValidAccessToken } from "./session.js?v68";
import { escapeHtml, showNotice } from "./notice-modal.js?v68";

// Compatibilidad con módulos que aún importen esta función desde referrals.js.
export { attachReferralClaim } from "./api.js?v68";

const REFERRAL_CLAIM_KEY = "ren_referral_claim";
const REFERRAL_WALLET_STATE_KEY = "ren_referral_wallet_state_v1";
const REFERRAL_PROMOTION_STATE_KEY = "ren_referral_promotion_state_v1";
const REFERRAL_WALLET_MODAL_SESSION_KEY = "ren_referral_wallet_modal_shown_v1";
const REFERRAL_WELCOME_MODAL_SESSION_KEY = "ren_referral_welcome_modal_shown_v1";
const REFERRAL_ANALYTICS_SESSION_KEY = "ren_referral_analytics_session_v1";
let capturePromise = null;

function analyticsSessionId() {
  try {
    const current = localStorage.getItem(REFERRAL_ANALYTICS_SESSION_KEY);
    if (current) return current;
    const generated = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(REFERRAL_ANALYTICS_SESSION_KEY, generated);
    return generated;
  } catch {
    return "";
  }
}

export function trackReferralEvent(eventType, payload = {}) {
  const claim = readClaim();
  return sendReferralEvent({
    event_type: eventType,
    placement: payload.placement || null,
    session_id: analyticsSessionId(),
    code: payload.code || claim?.code || null,
    metadata: payload.metadata || {}
  }).catch(error => {
    console.info("[referrals] no se pudo registrar la métrica", error?.message || error);
    return null;
  });
}

export function bindReferralCtaTracking(root = document) {
  if (!root || root.__renReferralCtaTracking) return;
  const listener = event => {
    const cta = event.target?.closest?.("[data-referral-cta]");
    if (!cta) return;
    trackReferralEvent("cta_click", { placement: cta.dataset.referralPlacement || "unknown" });
  };
  root.addEventListener("click", listener);
  root.__renReferralCtaTracking = listener;
}

function readClaim() {
  try {
    const value = JSON.parse(localStorage.getItem(REFERRAL_CLAIM_KEY) || "null");
    if (!value?.token || !value.expires_at || Date.parse(value.expires_at) <= Date.now()) {
      localStorage.removeItem(REFERRAL_CLAIM_KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function cleanReferralParam() {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has("ref")) return;
    url.searchParams.delete("ref");
    history.replaceState(history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // La atribución ya quedó en servidor o el navegador no permite modificar la URL.
  }
}

export function getReferralClaimToken() {
  return readClaim()?.token || "";
}

export function clearReferralClaim() {
  try { localStorage.removeItem(REFERRAL_CLAIM_KEY); } catch {}
}

function normalizeReferralWalletState(summary = {}) {
  const balance = Math.max(0, Number(summary?.balance || 0));
  const currency = String(summary?.currency || "USD").toUpperCase();
  const rewards = Array.isArray(summary?.rewards) ? summary.rewards : [];
  const referrals = Array.isArray(summary?.referrals) ? summary.referrals : [];
  return {
    hasReferralBalance: balance > 0,
    balance: Number(balance.toFixed(2)),
    currency,
    referralCode: summary?.code?.code || "",
    referralCount: referrals.length,
    rewardCount: rewards.filter(item => item.reward_type === "referrer_credit").length,
    availableRewardCount: rewards.filter(item => item.reward_type === "referrer_credit" && item.status === "available").length,
    updatedAt: new Date().toISOString()
  };
}

export function getReferralWalletState() {
  try {
    const value = JSON.parse(localStorage.getItem(REFERRAL_WALLET_STATE_KEY) || "null");
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export function saveReferralWalletState(summary) {
  const state = normalizeReferralWalletState(summary);
  try { localStorage.setItem(REFERRAL_WALLET_STATE_KEY, JSON.stringify(state)); } catch {}
  return state;
}

export function clearReferralWalletState() {
  try { localStorage.removeItem(REFERRAL_WALLET_STATE_KEY); } catch {}
}

function normalizeReferralPromotionState(summary = {}) {
  const promotion = summary?.referred_promotion || null;
  const isReferred = Boolean(summary?.referred);
  const referral = summary?.referred;
  const benefitUnused = !referral || typeof referral !== "object"
    || (!referral.discount_used_at && ["registered", "purchase_pending"].includes(referral.status));
  const rewardType = String(promotion?.reward_type || "");
  const amount = Number(promotion?.amount || 0);
  return {
    isReferred,
    active: isReferred && benefitUnused,
    rewardType,
    discountPercent: rewardType === "discount_percent" && amount > 0 ? amount : 0,
    discountAmount: rewardType !== "discount_percent" && amount > 0 ? amount : 0,
    minimumPurchase: Number(promotion?.minimum_purchase || 0),
    maximumDiscount: Number(promotion?.maximum_discount || 0),
    currency: String(promotion?.currency || "USD").toUpperCase(),
    source: summary?.source === "claim" ? "claim" : "account",
    expiresAt: summary?.source === "claim" ? summary.expires_at || null : null,
    updatedAt: new Date().toISOString()
  };
}

export function getReferralPromotionState() {
  try {
    const value = JSON.parse(localStorage.getItem(REFERRAL_PROMOTION_STATE_KEY) || "null");
    if (value?.active && value.source !== "account" && !readClaim()) {
      clearReferralPromotionState();
      return null;
    }
    if (value?.source === "claim" && (!value.expiresAt || Date.parse(value.expiresAt) <= Date.now())) {
      clearReferralPromotionState();
      return null;
    }
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export function saveReferralPromotionState(summary) {
  const state = normalizeReferralPromotionState(summary);
  try { localStorage.setItem(REFERRAL_PROMOTION_STATE_KEY, JSON.stringify(state)); } catch {}
  return state;
}

export function clearReferralPromotionState() {
  try { localStorage.removeItem(REFERRAL_PROMOTION_STATE_KEY); } catch {}
}

export function renderReferralCartNotice(subtotal = 0) {
  const el = document.getElementById("cart-referral-notice");
  if (!el) return;
  const state = getReferralPromotionState();
  if (!state?.active) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }

  const amount = Number(subtotal || 0);
  const percent = Number(state.discountPercent || 0);
  const fixed = Number(state.discountAmount || 0);
  const meetsMinimum = amount >= Number(state.minimumPurchase || 0);
  const promotionText = percent > 0
    ? `${percent}% de descuento en tu primera compra`
    : fixed > 0
      ? `${new Intl.NumberFormat("es-ES", { style: "currency", currency: state.currency || "USD" }).format(fixed)} de descuento en tu primera compra`
      : "un beneficio especial en tu primera compra";
  const estimated = meetsMinimum && percent > 0 && amount > 0
    ? Math.min(amount * percent / 100, state.maximumDiscount > 0 ? state.maximumDiscount : Number.POSITIVE_INFINITY)
    : meetsMinimum && fixed > 0 && amount > 0 ? Math.min(amount, fixed) : 0;

  el.hidden = false;
  el.innerHTML = `
    <strong>🎉 Beneficio de referido activo</strong>
    <span>Entraste con un enlace de referido: ${promotionText}.</span>
    ${estimated > 0 ? `<span class="cart-referral-notice__saving">Ahorro estimado en este carrito: −$${estimated.toFixed(2)}</span>` : ""}
    <small>El descuento final se confirma automáticamente al crear el pedido.</small>`;
}

function formatReferralBalance(state) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: state.currency || "USD" }).format(Number(state.balance || 0));
}

function referralPromotionText(state) {
  const percent = Number(state?.discountPercent || 0);
  const fixed = Number(state?.discountAmount || 0);
  if (percent > 0) return `${percent}% de descuento en tu primera compra`;
  if (fixed > 0) {
    const amount = new Intl.NumberFormat("es-ES", { style: "currency", currency: state.currency || "USD" }).format(fixed);
    return `${amount} de descuento en tu primera compra`;
  }
  return "un beneficio especial en tu primera compra";
}

export function showReferralWelcomeModal() {
  const state = getReferralPromotionState();
  const claim = readClaim();
  if (!state?.active || !claim || document.querySelector("dialog.notice-modal[open]")) return;

  const sessionKey = `${REFERRAL_WELCOME_MODAL_SESSION_KEY}:${claim.code || claim.token.slice(0, 16)}`;
  try {
    if (sessionStorage.getItem(sessionKey) === "true") return;
    sessionStorage.setItem(sessionKey, "true");
  } catch {
    // El modal sigue siendo funcional aunque el navegador bloquee sessionStorage.
  }

  const minimum = Number(state.minimumPurchase || 0);
  const maximum = Number(state.maximumDiscount || 0);
  const limitText = minimum > 0
    ? `Válido desde ${new Intl.NumberFormat("es-ES", { style: "currency", currency: state.currency || "USD" }).format(minimum)} de compra.`
    : "Se aplicará desde el checkout al confirmar tu pedido.";
  const maximumText = maximum > 0
    ? ` Ahorro máximo: ${new Intl.NumberFormat("es-ES", { style: "currency", currency: state.currency || "USD" }).format(maximum)}.`
    : "";

  showNotice({
    tone: "success",
    icon: "check",
    title: "Tu beneficio está activo",
    body: `<p>Entraste a Ready Express Now con un enlace de referido.</p><p><strong>${escapeHtml(referralPromotionText(state))}</strong></p><p>El beneficio se aplicará automáticamente al crear tu primer pedido.</p>`,
    note: escapeHtml(`${limitText}${maximumText}`),
    actions: [
      {
        id: "shop",
        label: "Ver productos",
        variant: "primary",
        onClick: control => {
          control.close();
          const products = document.querySelector("#combos");
          if (products) products.scrollIntoView({ behavior: "smooth", block: "start" });
          else location.href = "./index.html#combos";
        }
      },
      { id: "later", label: "Ahora no", variant: "link", onClick: control => control.close() }
    ]
  });
}

function showReferralWalletModal(state) {
  if (!state?.hasReferralBalance || document.getElementById("referral-wallet-modal")) return;
  try {
    if (sessionStorage.getItem(REFERRAL_WALLET_MODAL_SESSION_KEY) === "true") return;
    sessionStorage.setItem(REFERRAL_WALLET_MODAL_SESSION_KEY, "true");
  } catch {
    // Si sessionStorage no está disponible, el modal sigue siendo útil en esta visita.
  }

  const modal = document.createElement("div");
  modal.id = "referral-wallet-modal";
  modal.className = "referral-wallet-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "referral-wallet-title");
  modal.innerHTML = `
    <div class="referral-wallet-modal__sheet">
      <button type="button" class="referral-wallet-modal__close" aria-label="Cerrar">×</button>
      <div class="referral-wallet-modal__eyebrow">Tu beneficio Ready Express</div>
      <div class="referral-wallet-modal__icon" aria-hidden="true">✦</div>
      <h2 id="referral-wallet-title">Tienes saldo de referido</h2>
      <p class="referral-wallet-modal__balance">${formatReferralBalance(state)}</p>
      <p class="referral-wallet-modal__text">Puedes usarlo en tu próxima compra. Si no cubre todo el pedido, pagarás únicamente la diferencia.</p>
      <div class="referral-wallet-modal__actions">
        <a class="referral-wallet-modal__primary" href="./cuenta.html#referidos">Ver mi saldo</a>
        <button type="button" class="referral-wallet-modal__secondary">Ahora no</button>
      </div>
    </div>`;
  const close = () => { modal.remove(); };
  modal.addEventListener("click", event => { if (event.target === modal) close(); });
  modal.querySelector(".referral-wallet-modal__close")?.addEventListener("click", close);
  modal.querySelector(".referral-wallet-modal__secondary")?.addEventListener("click", close);
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add("is-visible"));
}

export async function syncReferralWalletState({ showModal = true } = {}) {
  const token = await getValidAccessToken();
  if (!token) return getReferralWalletState();
  try {
    const summary = await getMyReferralSummary();
    saveReferralPromotionState(summary);
    const state = saveReferralWalletState(summary);
    if (showModal) showReferralWalletModal(state);
    return state;
  } catch (error) {
    console.info("[referrals] no se pudo sincronizar el saldo local", error?.message || error);
    return getReferralWalletState();
  }
}

export function captureReferralFromUrl() {
  if (capturePromise) return capturePromise;
  capturePromise = (async () => {
    const existing = readClaim();
    const rawCode = new URLSearchParams(location.search).get("ref");
    if (!rawCode) return existing;

    try {
      const result = await claimReferralCode(rawCode);
      if (result?.token && result.expires_at) {
        localStorage.setItem(REFERRAL_CLAIM_KEY, JSON.stringify({
          token: result.token,
          code: result.code || rawCode,
          expires_at: result.expires_at
        }));
        try {
          const program = await getReferralProgram();
          const rule = (program?.rules || []).find(item => item.active && item.beneficiary_type === "referred_customer");
          saveReferralPromotionState({
            source: "claim",
            expires_at: result.expires_at,
            referred: true,
            referred_promotion: rule ? { ...rule, currency: program.currency } : null
          });
        } catch {
          // El aviso se mostrará con el texto genérico y se enriquecerá al iniciar sesión.
          saveReferralPromotionState({ source: "claim", expires_at: result.expires_at, referred: true, referred_promotion: null });
        }
        renderReferralCartNotice();
      }
      cleanReferralParam();
      return { ...result, captured: true };
    } catch (error) {
      console.info("[referrals] no se pudo guardar la atribución", error?.message || error);
      if ([400, 404, 409, 422].includes(error?.status)) {
        cleanReferralParam();
        showNotice({
          tone: "warning", icon: "alert",
          title: "Enlace de invitación no válido",
          body: "<p>No pudimos activar este beneficio. Puedes seguir comprando normalmente o pedirle a quien te invitó un enlace nuevo.</p>",
          actions: [{ id: "ok", label: "Entendido", onClick: control => control.close() }]
        });
      }
      return existing;
    }
  })().finally(() => { capturePromise = null; });
  return capturePromise;
}

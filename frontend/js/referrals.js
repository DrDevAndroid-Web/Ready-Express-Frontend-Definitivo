import { claimReferralCode, getMyReferralSummary, getReferralProgram } from "./api.js?v53";
import { getValidAccessToken } from "./session.js?v53";

// Compatibilidad con módulos que aún importen esta función desde referrals.js.
export { attachReferralClaim } from "./api.js?v53";

const REFERRAL_CLAIM_KEY = "ren_referral_claim";
const REFERRAL_WALLET_STATE_KEY = "ren_referral_wallet_state_v1";
const REFERRAL_PROMOTION_STATE_KEY = "ren_referral_promotion_state_v1";
const REFERRAL_WALLET_MODAL_SESSION_KEY = "ren_referral_wallet_modal_shown_v1";
let capturePromise = null;

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
  const rewardType = String(promotion?.reward_type || "");
  const amount = Number(promotion?.amount || 0);
  return {
    isReferred,
    active: isReferred,
    rewardType,
    discountPercent: rewardType === "discount_percent" && amount > 0 ? amount : 0,
    discountAmount: rewardType !== "discount_percent" && amount > 0 ? amount : 0,
    minimumPurchase: Number(promotion?.minimum_purchase || 0),
    maximumDiscount: Number(promotion?.maximum_discount || 0),
    currency: String(promotion?.currency || "USD").toUpperCase(),
    updatedAt: new Date().toISOString()
  };
}

export function getReferralPromotionState() {
  try {
    const value = JSON.parse(localStorage.getItem(REFERRAL_PROMOTION_STATE_KEY) || "null");
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
            referred: true,
            referred_promotion: rule ? { ...rule, currency: program.currency } : null
          });
        } catch {
          // El aviso se mostrará con el texto genérico y se enriquecerá al iniciar sesión.
          saveReferralPromotionState({ referred: true, referred_promotion: null });
        }
        renderReferralCartNotice();
      }
      cleanReferralParam();
      return result;
    } catch (error) {
      // No bloquear la compra por un código inválido o un fallo temporal.
      cleanReferralParam();
      console.info("[referrals] no se pudo guardar la atribución", error?.message || error);
      return existing;
    }
  })().finally(() => { capturePromise = null; });
  return capturePromise;
}

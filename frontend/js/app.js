import { initCart, getCart } from "./cart.js?v68";
import { initProducts, initProductSearch } from "./products.js?v68";
import { initCheckout, openCheckoutAtSavedStep } from "./checkout.js?v68";
import { restorePendingPaymentFromBackend, showPendingPaymentNotice } from "./payment.js?v68";
import { inicializarMetodosPago } from "./payment-methods.js?v68";
import { getLocalizaciones } from "./api.js?v68";
import { bindReferralCtaTracking, captureReferralFromUrl, getReferralPromotionState, showReferralWelcomeModal, syncReferralWalletState } from "./referrals.js?v68";
import { getAccessToken, getPendingEmailConfirmation } from "./auth.js?v68";

function displayMunicipalityName(name) {
  return String(name || "Municipio").replace(/^El Savador$/i, "El Salvador");
}

document.addEventListener("DOMContentLoaded", async () => {
  initMobileNav();
  initMobileSearchDialog();
  initProductSearch();
  const pendingEmailBanner = document.getElementById("pending-email-banner");
  const updatePendingEmailBanner = () => {
    if (pendingEmailBanner) pendingEmailBanner.hidden = Boolean(getAccessToken() || !getPendingEmailConfirmation());
  };
  updatePendingEmailBanner();
  window.addEventListener("storage", event => {
    if (["ren_access_token", "ren_pending_email_confirmation"].includes(event.key)) updatePendingEmailBanner();
  });
  const accountNavigation = new URLSearchParams(location.search);
  bindReferralCtaTracking();
  const referralCapture = await captureReferralFromUrl().catch(() => null);
  syncReferralWalletState({ showModal: accountNavigation.get("cart") !== "1" && accountNavigation.get("menu") !== "1" }).catch(() => {});
  if (await restorePendingPaymentFromBackend()) showPendingPaymentNotice();

  await inicializarMetodosPago();
  initCart();
  if (new URLSearchParams(location.search).get("cart") === "1") {
    document.getElementById("cart-btn")?.click();
    const url = new URL(location.href);
    url.searchParams.delete("cart");
    history.replaceState(history.state, "", url);
  }
  initProducts();
  initCheckout();
  if (referralCapture?.captured || getReferralPromotionState()?.source === "claim") showReferralWelcomeModal();

  // El progreso del checkout se conserva, pero solo se reabre si se pide explícitamente
  // (?checkout=1). Reabrirlo solo impedía volver a la tienda desde checkout.html.
  if (new URLSearchParams(location.search).get("checkout") === "1" && getCart().length > 0) {
    setTimeout(() => openCheckoutAtSavedStep(), 500);
  }

  initAccessibility();
  if (new URLSearchParams(location.search).get("menu") === "1") {
    document.getElementById("bottom-menu-btn")?.click();
    const url = new URL(location.href);
    url.searchParams.delete("menu");
    history.replaceState(history.state, "", url);
  }
  initDeliveryLocationsFaq();

  // Smooth scroll for nav links
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      const target = document.querySelector(link.getAttribute("href"));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
});

async function initDeliveryLocationsFaq() {
  const container = document.getElementById("faq-delivery-locations");
  if (!container) return;
  try {
    const response = await getLocalizaciones();
    const locations = Array.isArray(response?.data)
      ? response.data
      : Array.isArray(response) ? response : [];
    if (!locations.length) {
      container.innerHTML = '<span class="faq-locations-empty">Las tarifas se confirmarán durante el checkout.</span>';
      return;
    }
    container.innerHTML = locations.map(location => {
      const surcharge = Number(location.recargo || 0);
      const amount = surcharge > 0 ? `+$${surcharge.toFixed(2)}` : "Sin recargo";
      return `<div class="faq-location-row"><span>${escapeHtml(displayMunicipalityName(location.municipio))}</span><strong>${amount}</strong></div>`;
    }).join("");
  } catch (error) {
    container.innerHTML = '<span class="faq-locations-empty">Las tarifas se mostrarán automáticamente durante el checkout.</span>';
    console.warn("[faq:localizaciones]", error);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[char]));
}

// Accessibility improvements
function initAccessibility() {
  // Add aria-describedby to form fields dynamically
  const forms = document.querySelectorAll("form");
  forms.forEach(form => {
    const errorContainer = form.querySelector("[id$='-error']");
    if (errorContainer) {
      const inputs = form.querySelectorAll("input, textarea, select");
      inputs.forEach(input => {
        input.setAttribute("aria-describedby", errorContainer.id);
      });
    }
  });
}

// Mobile nav improvements
function initMobileNav() {
  const menuBtn = document.getElementById("menu-btn");
  const mobileNav = document.getElementById("mobile-nav");

  // Toggle mobile nav
  menuBtn?.addEventListener("click", () => {
    const isOpen = mobileNav?.classList.toggle("active");
    menuBtn.setAttribute("aria-expanded", isOpen);
  });

  // Close mobile nav when link is clicked
  mobileNav?.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
      mobileNav.classList.remove("active");
      menuBtn?.setAttribute("aria-expanded", "false");
      document.getElementById("bottom-menu-btn")?.setAttribute("aria-expanded", "false");
      highlightActiveMobileNav();
    });
  });

  // Highlight active nav link on page load
  highlightActiveMobileNav();
}

function initMobileSearchDialog() {
  const triggers = [...document.querySelectorAll("[data-search-trigger]")];
  const dialog = document.getElementById("mobile-search-dialog");
  const input = document.getElementById("mobile-search");
  if (!triggers.length || !dialog || !input) return;
  let activeTrigger = null;
  triggers.forEach(trigger => {
    trigger.addEventListener("click", () => {
      activeTrigger = trigger;
      document.getElementById("mobile-nav")?.classList.remove("active");
      document.getElementById("bottom-menu-btn")?.setAttribute("aria-expanded", "false");
      dialog.showModal();
      trigger.setAttribute("aria-expanded", "true");
      requestAnimationFrame(() => input.focus());
    });
  });
  document.getElementById("mobile-search-close")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => {
    triggers.forEach(trigger => trigger.setAttribute("aria-expanded", "false"));
    if (activeTrigger?.getClientRects().length) activeTrigger.focus({ preventScroll: true });
  });
}

// Highlight active mobile nav link
function highlightActiveMobileNav() {
  const currentPath = window.location.pathname.split("/").pop() || "index.html";
  const mobileNav = document.getElementById("mobile-nav");

  mobileNav?.querySelectorAll("a").forEach(link => {
    const href = link.getAttribute("href");
    const isActive =
      (href && href.includes(currentPath)) ||
      (currentPath === "" && href === "#inicio") ||
      (href === "#inicio" && currentPath === "index.html");

    if (isActive) {
      link.classList.add("active");
    } else {
      link.classList.remove("active");
    }
  });
}

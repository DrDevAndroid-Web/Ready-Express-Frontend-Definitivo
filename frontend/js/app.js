import { initCart, getCart } from "./cart.js?v27";
import { initProducts } from "./products.js?v27";
import { initCheckout, openCheckoutAtSavedStep } from "./checkout.js?v27";
import { redirectToPendingPayment } from "./payment.js?v27";
import { inicializarMetodosPago } from "./payment-methods.js?v27";
import { getLocalizaciones } from "./api.js?v27";

document.addEventListener("DOMContentLoaded", async () => {
  if (redirectToPendingPayment()) return;

  await inicializarMetodosPago();
  initCart();
  initProducts();
  initCheckout();

  // El progreso del checkout se conserva, pero solo se reabre si se pide explícitamente
  // (?checkout=1). Reabrirlo solo impedía volver a la tienda desde checkout.html.
  if (new URLSearchParams(location.search).get("checkout") === "1" && getCart().length > 0) {
    setTimeout(() => openCheckoutAtSavedStep(), 500);
  }

  initAccessibility();
  initMobileNav();
  initWhatsAppModal();
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
      return `<div class="faq-location-row"><span>${escapeHtml(location.municipio || "Municipio")}</span><strong>${amount}</strong></div>`;
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
      highlightActiveMobileNav();
    });
  });

  // Highlight active nav link on page load
  highlightActiveMobileNav();
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


// WhatsApp modal initialization
function initWhatsAppModal() {
  const modal = document.getElementById('whatsapp-modal');
  const closeBtn = document.getElementById('close-modal');

  if (!modal || !closeBtn) return;

  let modalShown = false;
  try {
    modalShown = localStorage.getItem('whatsappModalShown') === 'true';
  } catch {
    modalShown = false;
  }

  window.addEventListener('scroll', () => {
    const cartOpen = document.getElementById('cart-panel')?.classList.contains('open');
    const checkoutOpen = document.querySelector('.modal.open');
    if (cartOpen || checkoutOpen) return;

    const scrollTop = window.scrollY;
    const windowHeight = window.innerHeight;
    const documentHeight = document.body.scrollHeight;
    const scrollPercent = (scrollTop + windowHeight) / documentHeight;

    if (scrollPercent > 0.55 && !modalShown) {
      modal.classList.add('show');
      modalShown = true;
      try { localStorage.setItem('whatsappModalShown', 'true'); } catch {}
    }
  }, { passive: true });

  closeBtn.addEventListener('click', () => {
    modal.classList.remove('show');
  });
}

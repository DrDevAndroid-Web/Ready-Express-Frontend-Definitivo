import { initCart, getCart } from "./cart.js?v12";
import { initProducts } from "./products.js?v12";
import { initCheckout, openCheckoutAtSavedStep, hasSavedCheckoutStep } from "./checkout.js?v11";
import { redirectToPendingPayment } from "./payment.js?v11";
import { inicializarMetodosPago } from "./payment-methods.js?v11";

document.addEventListener("DOMContentLoaded", async () => {
  if (redirectToPendingPayment()) return;

  await inicializarMetodosPago();
  initCart();
  initProducts();
  initCheckout();

  // Restaurar checkout si hay paso guardado y carrito con items
  if (hasSavedCheckoutStep() && getCart().length > 0) {
    setTimeout(() => openCheckoutAtSavedStep(), 500);
  }

  initAccessibility();
  initMobileNav();
  initWhatsAppModal();

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

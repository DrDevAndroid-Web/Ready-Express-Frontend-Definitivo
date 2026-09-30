// Iconos de métodos de pago: una sola familia (SVG de trazo, estilo Lucide) en un recuadro uniforme.
// Si el método tiene logo (image_url) se muestra dentro del mismo recuadro, con respaldo SVG si no carga.

const SVG = {
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  transfer: '<path d="M7 7h13l-4-4M17 17H4l4 4"/>',
  bank: '<path d="M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M2 10l10-7 10 7z"/>',
  wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-4a2 2 0 0 0 0 4h4v3a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'
};

export function svgIcon(name, size = 24) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${SVG[name] || SVG.wallet}</svg>`;
}

function iconNameFor(method) {
  const name = String(method?.method_name || "").toLowerCase();
  if (method?.payment_flow === "tropipay" || name.includes("tropipay") || name.includes("tocopay") || name.includes("tarjeta")) return "card";
  if (name.includes("zelle")) return "transfer";
  if (method?.payment_flow === "assisted" || name.includes("transferencia") || name.includes("iban")) return "bank";
  return "wallet";
}

const escapeAttr = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// El nombre del método ya se muestra como texto junto al icono: el icono es decorativo (alt="").
export function methodLogoHtml(method) {
  const fallback = iconNameFor(method);
  if (method?.image_url) {
    return `<span class="method-logo" data-fallback-icon="${fallback}"><img src="${escapeAttr(method.image_url)}" alt="" width="48" height="48" decoding="async"></span>`;
  }
  return `<span class="method-logo is-icon">${svgIcon(fallback)}</span>`;
}

// Sustituye por el icono SVG cualquier logo que no cargue
export function bindMethodLogoFallback(container) {
  container?.querySelectorAll(".method-logo img").forEach(img => {
    const useFallback = () => {
      const logo = img.parentElement;
      logo.classList.add("is-icon");
      logo.innerHTML = svgIcon(logo.dataset.fallbackIcon);
    };
    if (img.complete && img.naturalWidth === 0) useFallback();
    else img.addEventListener("error", useFallback, { once: true });
  });
}

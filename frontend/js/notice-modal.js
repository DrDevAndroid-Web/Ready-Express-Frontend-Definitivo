// Modal para los avisos importantes del cliente (confirmar email, cuenta existente,
// errores que bloquean el pedido). Usa <dialog>: foco atrapado y Esc nativos.

const ICONS = {
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>'
};

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let counter = 0;

/**
 * @param {object} options
 * @param {"info"|"success"|"warning"|"error"} [options.tone]
 * @param {keyof ICONS} [options.icon]
 * @param {string} options.title
 * @param {string} options.body  HTML ya escapado
 * @param {string} [options.note] texto secundario (HTML ya escapado)
 * @param {Array<{id?:string,label:string,variant?:"primary"|"secondary"|"link",href?:string,external?:boolean,onClick?:Function}>} [options.actions]
 * @param {boolean} [options.dismissible] se puede cerrar con Esc o la X
 */
export function showNotice({ tone = "info", icon = "mail", title, body = "", note = "", actions = [], dismissible = true, onClose } = {}) {
  document.querySelector("dialog.notice-modal[open]")?.close();
  const id = `notice-${++counter}`;
  const dialog = document.createElement("dialog");
  dialog.className = `notice-modal is-${tone}`;
  dialog.setAttribute("aria-labelledby", `${id}-title`);
  dialog.setAttribute("aria-describedby", `${id}-body`);
  dialog.innerHTML = `
    ${dismissible ? `<button type="button" class="notice-modal__close" aria-label="Cerrar" data-notice-close><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>` : ""}
    <div class="notice-modal__icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon] || ICONS.alert}</svg></div>
    <h2 class="notice-modal__title" id="${id}-title">${escapeHtml(title)}</h2>
    <div class="notice-modal__body" id="${id}-body">${body}</div>
    <p class="notice-modal__status" role="status" aria-live="polite" hidden></p>
    <div class="notice-modal__actions"></div>
    ${note ? `<p class="notice-modal__note">${note}</p>` : ""}`;

  const actionsEl = dialog.querySelector(".notice-modal__actions");
  const statusEl = dialog.querySelector(".notice-modal__status");
  const controls = {};

  const ctrl = {
    el: dialog,
    close() { if (dialog.open) dialog.close(); },
    setStatus(text, type = "info") {
      statusEl.hidden = !text;
      statusEl.textContent = text || "";
      statusEl.dataset.type = type;
    },
    setBusy(actionId, busy, busyLabel) {
      const button = controls[actionId];
      if (!button) return;
      if (busy) {
        button.dataset.label = button.textContent;
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${escapeHtml(busyLabel || button.dataset.label)}`;
      } else {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        if (button.dataset.label) button.textContent = button.dataset.label;
      }
    },
    setAction(actionId, { label, disabled } = {}) {
      const button = controls[actionId];
      if (!button) return;
      if (label !== undefined) button.textContent = label;
      if (disabled !== undefined) button.disabled = disabled;
    },
    action: actionId => controls[actionId]
  };

  actions.forEach((action, index) => {
    const variant = action.variant || (index === 0 ? "primary" : "secondary");
    const el = action.href ? document.createElement("a") : document.createElement("button");
    el.className = `notice-modal__btn is-${variant}`;
    el.textContent = action.label;
    if (action.href) {
      el.href = action.href;
      if (action.external) { el.target = "_blank"; el.rel = "noopener"; }
    } else {
      el.type = "button";
    }
    if (action.onClick) el.addEventListener("click", event => action.onClick(ctrl, event));
    if (index === 0) el.setAttribute("autofocus", "");
    controls[action.id || `action-${index}`] = el;
    actionsEl.appendChild(el);
  });

  dialog.querySelector("[data-notice-close]")?.addEventListener("click", () => ctrl.close());
  dialog.addEventListener("cancel", event => { if (!dismissible) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    document.body.classList.remove("notice-open");
    dialog.remove();
    onClose?.();
  });

  document.body.appendChild(dialog);
  document.body.classList.add("notice-open");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else {
    // Navegadores sin <dialog>: se muestra igual, sin el fondo nativo
    dialog.setAttribute("open", "");
    dialog.classList.add("is-fallback");
    dialog.close = () => { dialog.removeAttribute("open"); dialog.dispatchEvent(new Event("close")); };
  }
  return ctrl;
}

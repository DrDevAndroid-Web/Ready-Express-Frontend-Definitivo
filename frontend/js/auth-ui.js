// Utilidades de UI compartidas por las páginas de cuenta (login, registro, recuperación).

export function showMessage(el, text, type = "info") {
  if (!el) return;
  el.classList.remove("is-error", "is-success", "is-info");
  el.textContent = text || "";
  if (text) el.classList.add(`is-${type}`);
}

export function setLoading(button, loading, loadingText = "Procesando...") {
  if (!button) return;
  if (loading) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${loadingText}`;
  } else {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (button.dataset.label) button.innerHTML = button.dataset.label;
  }
}

export function bindPasswordToggles(root = document) {
  root.querySelectorAll("[data-password-toggle]").forEach(toggle => {
    const input = document.getElementById(toggle.getAttribute("aria-controls"));
    if (!input) return;
    toggle.addEventListener("click", () => {
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      toggle.setAttribute("aria-pressed", String(!visible));
      toggle.setAttribute("aria-label", visible ? "Mostrar contraseña" : "Ocultar contraseña");
      toggle.innerHTML = `<i class="fa-solid ${visible ? "fa-eye" : "fa-eye-slash"}" aria-hidden="true"></i>`;
    });
  });
}

// Marca como inválido el primer campo que falle la validación nativa y le da foco
export function focusFirstInvalid(form) {
  const invalid = form.querySelector(":invalid");
  form.querySelectorAll("[aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
  if (invalid) {
    invalid.setAttribute("aria-invalid", "true");
    invalid.focus();
  }
  return !invalid;
}

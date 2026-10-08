// Utilidades de UI compartidas por las páginas de cuenta (login, registro, recuperación).
import { fieldErrorMessage } from "./field-messages.js?v40";

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

// Muestra bajo cada campo inválido un mensaje propio (field-messages.js) y da foco al primero.
// Al corregir el campo, su mensaje desaparece.
export function focusFirstInvalid(form) {
  const controls = [...form.querySelectorAll("input, select, textarea")].filter(el => el.type !== "hidden" && !el.disabled && !el.closest("[hidden]"));
  let first = null;
  controls.forEach(control => {
    const message = control.validity.valid ? "" : fieldErrorMessage(control);
    setFieldError(control, message);
    if (message) first ||= control;
  });
  first?.focus();
  return !first;
}

function setFieldError(control, message) {
  const id = `${control.id || control.name}-error`;
  let error = document.getElementById(id);
  if (!message) {
    control.removeAttribute("aria-invalid");
    error?.remove();
    return;
  }
  if (!error) {
    error = document.createElement("p");
    error.id = id;
    error.className = "auth-field-error";
    const anchor = control.closest(".auth-check, .country-select-control, .auth-password") || control;
    anchor.after(error);
    const describedBy = new Set((control.getAttribute("aria-describedby") || "").split(" ").filter(Boolean));
    describedBy.add(id);
    control.setAttribute("aria-describedby", [...describedBy].join(" "));
    const clear = () => { if (control.validity.valid) setFieldError(control, ""); };
    control.addEventListener(control.type === "checkbox" ? "change" : "input", clear);
    control.addEventListener("blur", clear);
  }
  error.textContent = message;
  control.setAttribute("aria-invalid", "true");
}

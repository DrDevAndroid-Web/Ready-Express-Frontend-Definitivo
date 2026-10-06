// Aviso de "confirma tu email" tras registrarse (o al intentar entrar sin confirmar).
// El email trae un código de 6 dígitos y un enlace. Lo principal es el código: se escribe
// aquí y el cliente sigue con su pedido sin salir de la página.
// Si usa el enlace, se detecta solo: abierto en este navegador, la otra pestaña guarda la
// sesión (evento storage); al volver a esta pestaña se reintenta el login.
import { isEmailNotConfirmed, loginCustomer, resendConfirmationEmail, safeReturnPath, verifyEmailCode } from "./auth.js?v38";
import { escapeHtml, showNotice } from "./notice-modal.js?v38";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_S = 60;
const AUTO_CHECK_GAP_MS = 20_000;
const AUTO_CHECK_MAX = 6;

const WEBMAIL = [
  { test: /^(gmail|googlemail)\.com$/, label: "Abrir Gmail", url: "https://mail.google.com/mail/u/0/#inbox" },
  { test: /^(outlook|hotmail|live|msn)\.[a-z.]+$/, label: "Abrir Outlook", url: "https://outlook.live.com/mail/" },
  { test: /^(yahoo|ymail)\.[a-z.]+$/, label: "Abrir Yahoo Mail", url: "https://mail.yahoo.com/" },
  { test: /^(icloud|me|mac)\.com$/, label: "Abrir iCloud Mail", url: "https://www.icloud.com/mail" }
];

function webmailFor(email) {
  const domain = String(email).split("@")[1]?.toLowerCase() || "";
  return WEBMAIL.find(item => item.test.test(domain)) || null;
}

function destination() {
  return safeReturnPath() || "./cuenta.html";
}

/**
 * @param {object} options
 * @param {string} options.email
 * @param {string} [options.password] solo en memoria, para entrar si confirma con el enlace
 * @param {"sent"|"pending"} [options.reason] recién registrado o login sin confirmar
 * @param {Function} [options.onChangeEmail]
 */
export function showEmailConfirmModal({ email, password = "", reason = "sent", onChangeEmail } = {}) {
  const webmail = webmailFor(email);
  const goingToCheckout = safeReturnPath() === "./checkout.html";
  const intro = reason === "sent"
    ? `Enviamos un código de ${CODE_LENGTH} dígitos a <strong>${escapeHtml(email)}</strong>.`
    : `La cuenta <strong>${escapeHtml(email)}</strong> aún no está activa. Escribe el código que te enviamos o pide uno nuevo.`;
  const body = `
    <p>${intro}</p>
    <form class="notice-modal__code" id="email-code-form" novalidate>
      <label for="email-code">Código de confirmación</label>
      <input id="email-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code"
        pattern="[0-9]*" maxlength="${CODE_LENGTH + 4}" placeholder="${"0".repeat(CODE_LENGTH)}" aria-describedby="email-code-hint" required>
      <small id="email-code-hint">También puedes pulsar el enlace del mismo email.</small>
    </form>`;

  let autoChecks = 0;
  let lastCheck = Date.now();
  let checking = false;
  let finished = false;
  let cooldownTimer = null;

  const actions = [{ id: "verify", label: goingToCheckout ? "Confirmar y volver al pedido" : "Confirmar email", variant: "primary", onClick: () => submitCode() }];
  if (webmail) actions.push({ id: "webmail", label: webmail.label, href: webmail.url, external: true, variant: "secondary" });
  actions.push({ id: "resend", label: "Reenviar código", variant: "link", onClick: resend });
  if (onChangeEmail) actions.push({ id: "change", label: "Usar otro email", variant: "link", onClick: c => { c.close(); onChangeEmail(); } });

  const ctrl = showNotice({
    icon: "mail",
    title: reason === "sent" ? "Confirma tu email" : "Falta confirmar tu email",
    body,
    note: "¿No llega? Revisa Spam o Promociones. Puede tardar un par de minutos.",
    actions,
    dismissible: true,
    onClose: cleanup
  });

  const input = ctrl.el.querySelector("#email-code");
  const form = ctrl.el.querySelector("#email-code-form");
  // El foco va al código: es lo que el cliente tiene que hacer aquí
  requestAnimationFrame(() => input.focus());
  input.addEventListener("input", () => {
    // Solo cifras (al pegar "482 913" o "482-913" también vale)
    const digits = input.value.replace(/\D/g, "");
    if (digits !== input.value) input.value = digits;
    input.removeAttribute("aria-invalid");
    if (digits.length === CODE_LENGTH) submitCode();
  });
  form.addEventListener("submit", event => { event.preventDefault(); submitCode(); });

  function finish() {
    finished = true;
    input.disabled = true;
    ctrl.setStatus(goingToCheckout ? "Email confirmado. Volviendo a tu pedido…" : "Email confirmado. Te llevamos a tu cuenta…", "success");
    setTimeout(() => { location.href = destination(); }, 900);
  }

  async function submitCode() {
    if (checking || finished) return;
    const code = input.value.replace(/\D/g, "");
    if (code.length < CODE_LENGTH) {
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return ctrl.setStatus(`Escribe los ${CODE_LENGTH} dígitos del código.`, "error");
    }
    checking = true;
    ctrl.setBusy("verify", true, "Comprobando…");
    try {
      await verifyEmailCode(email, code);
      finish();
    } catch (err) {
      input.setAttribute("aria-invalid", "true");
      input.select();
      ctrl.setStatus(err.status === 404
        ? "No pudimos comprobar el código ahora. Pulsa el enlace del email para confirmar."
        : err.message, "error");
    } finally {
      checking = false;
      if (!finished) ctrl.setBusy("verify", false);
    }
  }

  // Si confirmó con el enlace en otro navegador o dispositivo, entra con la contraseña
  async function tryLogin() {
    if (!password || checking || finished) return;
    checking = true;
    lastCheck = Date.now();
    try {
      await loginCustomer(email, password); // con ?return= redirige él mismo
      finish();
    } catch (err) {
      if (!isEmailNotConfirmed(err)) console.warn("[confirmar-email]", err.message);
    } finally {
      checking = false;
    }
  }

  async function resend() {
    ctrl.setBusy("resend", true, "Enviando…");
    try {
      await resendConfirmationEmail(email);
      ctrl.setBusy("resend", false);
      ctrl.setStatus(`Te enviamos un código nuevo a ${email}. Usa el más reciente.`, "success");
      input.value = "";
      input.focus();
      startCooldown();
    } catch (err) {
      ctrl.setBusy("resend", false);
      ctrl.setStatus(err.status === 404 ? "No pudimos reenviarlo ahora. Inténtalo en unos minutos o escríbenos por WhatsApp." : err.message, "error");
    }
  }

  function startCooldown() {
    let left = RESEND_COOLDOWN_S;
    clearInterval(cooldownTimer);
    const tick = () => {
      if (left <= 0) { clearInterval(cooldownTimer); ctrl.setAction("resend", { label: "Reenviar código", disabled: false }); return; }
      ctrl.setAction("resend", { label: `Reenviar en ${left} s`, disabled: true });
      left -= 1;
    };
    tick();
    cooldownTimer = setInterval(tick, 1000);
  }

  // El enlace abierto en otra pestaña de este navegador guarda la sesión
  function onStorage(event) {
    if (event.key === "ren_access_token" && event.newValue && !finished) finish();
  }
  // Al volver del correo sin escribir el código: comprobar si confirmó con el enlace
  function onVisible() {
    if (document.hidden || finished || input.value || autoChecks >= AUTO_CHECK_MAX || Date.now() - lastCheck < AUTO_CHECK_GAP_MS) return;
    autoChecks += 1;
    tryLogin();
  }
  function cleanup() {
    clearInterval(cooldownTimer);
    window.removeEventListener("storage", onStorage);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
  }

  window.addEventListener("storage", onStorage);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  if (reason === "sent") startCooldown();
  return ctrl;
}

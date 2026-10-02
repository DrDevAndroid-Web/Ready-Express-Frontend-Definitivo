// Datos de facturación para pagar con tarjeta (TropiPay). Se piden una vez, en el registro,
// y se editan en "Mi cuenta"; el checkout los reutiliza sin volver a pedirlos.
import { getCountryName, setupCountrySelect } from "./country-select.js?v34";

export const TROPIPAY_TERMS_URL = "https://www.tropipay.com/terms";

// Máximo permitido en el selector de fecha: hace 18 años
export function maxBirthDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 18);
  return date.toISOString().slice(0, 10);
}

// El perfil tiene todo lo que TropiPay necesita para no pedir nada en la pasarela
export function billingComplete(profile) {
  return Boolean(profile?.pais_iso && profile?.direccion_facturacion && profile?.ciudad
    && profile?.codigo_postal && profile?.fecha_nacimiento && profile?.terminos_tropipay_at);
}

export function billingSummary(profile) {
  const place = [profile.ciudad, profile.estado_region, profile.codigo_postal].filter(Boolean).join(", ");
  return `${profile.direccion_facturacion} · ${place} · ${getCountryName(profile.pais_iso) || profile.pais_iso}`;
}

// Pinta los campos en `container` (dentro de un formulario con clases auth-*) y
// devuelve el selector de país para validar/rellenar
export function renderBillingFields(container, { legend = "Datos de facturación para pagar con tarjeta" } = {}) {
  container.innerHTML = `
    <fieldset class="auth-fieldset">
      <legend>${legend}</legend>
      <p class="auth-hint">Deben coincidir con los de tu tarjeta; si no, el banco puede rechazar el pago. Así no tendrás que escribirlos en cada compra.</p>
      <div class="auth-field country-select">
        <label for="billing_country" id="billing_country-label">País de residencia<span class="auth-required" aria-hidden="true">*</span></label>
        <div class="country-select-control">
          <input type="text" id="billing_country" role="combobox" placeholder="Busca tu país" required autocomplete="off">
          <button type="button" class="country-select-toggle" id="billing_country-toggle" tabindex="-1" aria-label="Mostrar lista de países"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
        </div>
        <input type="hidden" id="billing_pais_iso" name="pais_iso">
        <ul class="country-listbox" id="billing_country-listbox" role="listbox" aria-labelledby="billing_country-label" hidden></ul>
      </div>
      <div class="auth-field"><label for="billing_direccion">Dirección (la de tu tarjeta)<span class="auth-required" aria-hidden="true">*</span></label><input id="billing_direccion" name="direccion_facturacion" autocomplete="billing street-address" placeholder="Calle y número" required></div>
      <div class="auth-row">
        <div class="auth-field"><label for="billing_ciudad">Ciudad<span class="auth-required" aria-hidden="true">*</span></label><input id="billing_ciudad" name="ciudad" autocomplete="billing address-level2" required></div>
        <div class="auth-field"><label for="billing_estado">Estado / provincia</label><input id="billing_estado" name="estado_region" autocomplete="billing address-level1"></div>
      </div>
      <div class="auth-row">
        <div class="auth-field"><label for="billing_cp">Código postal<span class="auth-required" aria-hidden="true">*</span></label><input id="billing_cp" name="codigo_postal" autocomplete="billing postal-code" required aria-describedby="billing_cp-hint"><small id="billing_cp-hint" class="auth-hint">Si tu país no usa, escribe 00000.</small></div>
        <div class="auth-field"><label for="billing_nacimiento">Fecha de nacimiento<span class="auth-required" aria-hidden="true">*</span></label><input id="billing_nacimiento" name="fecha_nacimiento" type="date" autocomplete="bday" required max="${maxBirthDate()}" min="1900-01-01"></div>
      </div>
      <label class="auth-check" for="billing_terminos"><input type="checkbox" id="billing_terminos" name="acepta_terminos_tropipay" required><span>Acepto los <a href="${TROPIPAY_TERMS_URL}" target="_blank" rel="noopener">términos y condiciones de TropiPay</a><span class="auth-required" aria-hidden="true">*</span></span></label>
    </fieldset>`;

  const countrySelect = setupCountrySelect({
    input: container.querySelector("#billing_country"),
    hidden: container.querySelector("#billing_pais_iso"),
    listbox: container.querySelector("#billing_country-listbox"),
    toggle: container.querySelector("#billing_country-toggle")
  });

  return {
    // Antes de validar el formulario: marca el país como inválido si no se eligió de la lista
    syncValidity: () => countrySelect?.syncValidity(),
    fill(profile) {
      if (!profile) return;
      if (profile.pais_iso) countrySelect?.select(profile.pais_iso, { silent: true });
      const values = { billing_direccion: profile.direccion_facturacion, billing_ciudad: profile.ciudad, billing_estado: profile.estado_region, billing_cp: profile.codigo_postal, billing_nacimiento: profile.fecha_nacimiento };
      for (const [id, value] of Object.entries(values)) container.querySelector(`#${id}`).value = value || "";
      container.querySelector("#billing_terminos").checked = Boolean(profile.terminos_tropipay_at);
    }
  };
}

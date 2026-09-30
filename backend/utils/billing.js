import { createBadRequest } from "./http-error.js";

const MIN_AGE = 18;
const MAX_AGE = 120;

// Fecha de nacimiento YYYY-MM-DD de un adulto (TropiPay la envía como dateOfBirth al banco)
export function parseBirthDate(value, { required = true } = {}) {
  const text = String(value ?? "").trim();
  if (!text) {
    if (required) throw createBadRequest("La fecha de nacimiento es requerida para pagar con tarjeta");
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!date || date.toISOString().slice(0, 10) !== text) throw createBadRequest("La fecha de nacimiento no es valida");

  const today = new Date();
  let age = today.getUTCFullYear() - date.getUTCFullYear();
  const beforeBirthday = today.getUTCMonth() < date.getUTCMonth()
    || (today.getUTCMonth() === date.getUTCMonth() && today.getUTCDate() < date.getUTCDate());
  if (beforeBirthday) age -= 1;
  if (age < MIN_AGE) throw createBadRequest("Debes ser mayor de edad para pagar con tarjeta");
  if (age > MAX_AGE) throw createBadRequest("La fecha de nacimiento no es valida");
  return text;
}

export function parseCountryIso(value, message = "El pais es requerido") {
  const iso = String(value ?? "").trim().toUpperCase();
  if (!iso) throw createBadRequest(message);
  if (!/^[A-Z]{2}$/.test(iso)) throw createBadRequest("El pais no es valido");
  return iso;
}

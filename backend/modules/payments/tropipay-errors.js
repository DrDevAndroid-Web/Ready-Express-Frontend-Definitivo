import { HttpError } from "../../utils/http-error.js";

const SUPPORT = "Puedes pagar con otro método o escribirnos por WhatsApp.";

// TropiPay producción rechaza con TOO_LOW_AMOUNT por debajo de ~15 USD (medido el
// 2026-10-01: 14 USD falla, 15 USD pasa); en sandbox no hay mínimo.
export function tropipayMinAmount() {
  const value = Number(process.env.TROPIPAY_MIN_AMOUNT);
  return Number.isFinite(value) && value >= 0 ? value : 15;
}

export function minAmountMessage(min = tropipayMinAmount()) {
  return `El pago con tarjeta requiere un pedido de al menos $${min.toFixed(2)}. ${SUPPORT}`;
}

// Error con texto para el cliente y un `code` estable que el frontend usa para decidir qué mostrar
export function paymentError(status, code, message, extra = {}) {
  const error = new HttpError(status, message);
  error.expose = { code, ...extra };
  return error;
}

// Campos del objeto `client` que TropiPay valida y cómo se llaman en el formulario
const PAYER_FIELDS = {
  name: "nombre", lastName: "apellidos", email: "email", phone: "teléfono",
  address: "dirección de facturación", city: "ciudad", state: "estado o provincia",
  postCode: "código postal", countryIso: "país", countryId: "país",
  dateOfBirth: "fecha de nacimiento", termsAndConditions: "aceptación de los términos"
};

function payerField(details) {
  for (const detail of Array.isArray(details) ? details : []) {
    const param = String(detail?.param || "").replace(/^client\./, "");
    if (PAYER_FIELDS[param]) return { param, label: PAYER_FIELDS[param] };
  }
  return null;
}

// Clasifica un fallo al crear el enlace a partir de la respuesta de TropiPay ({ error: { code, message, details } }).
// Sin respuesta reconocible (credenciales, token, cuenta bloqueada, caída o red) no es culpa del cliente.
export function classifyCreateFailure(providerBody) {
  const body = providerBody?.error && typeof providerBody.error === "object" ? providerBody.error : {};
  const code = String(body.code || "").toUpperCase();
  if (code === "TOO_LOW_AMOUNT") return { status: 422, code: "CARD_MIN_AMOUNT", message: minAmountMessage(), extra: { min_amount: tropipayMinAmount() } };
  if (/INVALID_PARAM/.test(code) && /amount/i.test(String(body.message || ""))) {
    return { status: 422, code: "CARD_INVALID_AMOUNT", message: `El importe de este pedido no se puede cobrar con tarjeta. ${SUPPORT}` };
  }
  const field = /INVALID_PARAM/.test(code) ? payerField(body.details) : null;
  if (field) {
    return { status: 422, code: "CARD_PAYER_DATA", message: `La pasarela de pago no aceptó tu ${field.label}. Revísalo en tus datos de facturación (deben coincidir con los de la tarjeta) e inténtalo de nuevo.`, extra: { field: field.param } };
  }
  return { status: 503, code: "CARD_UNAVAILABLE", message: `El pago con tarjeta no está disponible en este momento. No se te ha cobrado nada. ${SUPPORT}` };
}

// Traduce un fallo al crear el enlace a un HttpError legible. El detalle técnico queda en el
// log y en raw_payload. Nunca se reenvía un 401 de TropiPay como 401: el frontend lo tomaría
// como sesión caducada del cliente.
export function toTropipayHttpError(error) {
  if (error instanceof HttpError) return error;
  const failure = classifyCreateFailure(error?.providerBody);
  if (failure.status >= 500) console.error("[tropipay:create]", { status: error?.status ?? null, code: error?.providerBody?.error?.code || null, message: error?.message });
  return paymentError(failure.status, failure.code, failure.message, failure.extra);
}

// Motivo de rechazo de la tarjeta. TropiPay lo manda en `errorReason` (del pago o de cada
// intento en `charges`); el aviso KO mínimo no lo trae y entonces se usa el texto genérico.
const DECLINE_REASONS = [
  [/insufficient|fondos|funds|saldo|balance/i, "CARD_INSUFFICIENT_FUNDS", "Tu tarjeta no tiene fondos suficientes. Prueba con otra tarjeta o con otro método de pago."],
  [/expir|caduc|vencid/i, "CARD_EXPIRED", "La tarjeta está caducada. Prueba con otra tarjeta."],
  [/3ds|3-d|3d secure|authenticat|autentic/i, "CARD_AUTHENTICATION_FAILED", "No se completó la verificación de seguridad de tu banco (3D Secure). Vuelve a intentarlo y confirma el pago en la app o el SMS de tu banco."],
  [/security code|cvv|cvc|cv2/i, "CARD_SECURITY_CODE", "El código de seguridad (CVV) no es correcto. Revísalo e inténtalo de nuevo."],
  [/address|postcode|post code|avs/i, "CARD_BILLING_MISMATCH", "Los datos de facturación no coinciden con los de la tarjeta. Revísalos en Mi cuenta e inténtalo de nuevo."],
  [/limit|exceed/i, "CARD_LIMIT_EXCEEDED", "La operación supera el límite de tu tarjeta. Prueba con otra tarjeta o consulta con tu banco."],
  [/fraud|risk|stolen|lost|restricted|blocked|bloque/i, "CARD_BLOCKED", "Tu banco bloqueó el pago por seguridad. Consulta con tu banco o prueba con otra tarjeta."],
  [/declin|denied|denegad|rechaz|refus|not authori|do not honou?r/i, "CARD_DECLINED", "Tu banco rechazó el pago. Prueba con otra tarjeta o consulta con tu banco."]
];

export const GENERIC_DECLINE = {
  code: "CARD_PAYMENT_FAILED",
  message: "No se pudo cobrar la tarjeta. Suele deberse a fondos insuficientes, a la verificación de seguridad del banco (3D Secure) o a un dato de la tarjeta. No se te ha cobrado nada."
};

function errorReasons(payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload || {};
  const sources = [data, data.paymentcard, ...(Array.isArray(data.charges) ? data.charges : [])];
  return sources.map(item => String(item?.errorReason || "").trim()).filter(Boolean);
}

export function describeDecline(payload) {
  for (const reason of errorReasons(payload)) {
    const match = DECLINE_REASONS.find(([pattern]) => pattern.test(reason));
    if (match) return { code: match[1], message: match[2] };
  }
  return GENERIC_DECLINE;
}

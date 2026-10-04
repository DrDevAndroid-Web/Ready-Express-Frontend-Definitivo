// Mensajes de validación propios, en español y con cómo corregir el campo. Los del
// navegador salen en su idioma ("Please fill out this field.") y no orientan.

const MISSING = {
  // Checkout
  receiver_name: "Escribe el nombre de quien recibe el pedido.",
  delivery_municipality: "Elige el municipio de entrega.",
  customer_address: "Escribe la dirección de entrega: calle, número y reparto.",
  receiver_phone: "Escribe el teléfono de quien recibe, por ejemplo +53 5XXX XXXX.",
  sender_first_name: "Escribe tu nombre.",
  sender_last_name: "Escribe tus apellidos.",
  sender_phone: "Escribe tu teléfono o WhatsApp para avisarte del pedido.",
  customer_email: "Escribe tu email.",
  payer_country: "Elige tu país de la lista.",
  payer_address: "Escribe la dirección asociada a tu tarjeta.",
  payer_city: "Escribe tu ciudad.",
  payer_postcode: "Escribe tu código postal. Si tu país no usa, pon 00000.",
  payer_birth_date: "Indica tu fecha de nacimiento.",
  payer_terms: "Acepta los términos de TropiPay para pagar con tarjeta.",
  // Registro, login y facturación
  nombre: "Escribe tu nombre.",
  apellidos: "Escribe tus apellidos.",
  email: "Escribe tu email.",
  telefono: "Escribe tu teléfono o WhatsApp.",
  password: "Escribe tu contraseña.",
  billing_country: "Elige tu país de la lista.",
  billing_direccion: "Escribe la dirección asociada a tu tarjeta.",
  billing_ciudad: "Escribe tu ciudad.",
  billing_cp: "Escribe tu código postal. Si tu país no usa, pon 00000.",
  billing_nacimiento: "Indica tu fecha de nacimiento.",
  billing_terminos: "Acepta los términos de TropiPay para pagar con tarjeta."
};

export function fieldErrorMessage(field) {
  const key = field.name && MISSING[field.name] ? field.name : field.id;
  const v = field.validity;
  if (v.valid) return "";
  if (v.customError) return field.validationMessage;
  if (v.valueMissing) return MISSING[key] || "Completa este campo.";
  if (v.typeMismatch && field.type === "email") return "Revisa el email: debe tener el formato nombre@correo.com.";
  if (v.tooShort) return `Usa al menos ${field.minLength} caracteres.`;
  if (v.rangeOverflow && field.type === "date") return "Debes ser mayor de 18 años para pagar con tarjeta.";
  if (v.rangeUnderflow && field.type === "date") return "Revisa la fecha de nacimiento.";
  if (v.badInput) return "El formato no es válido.";
  return "Revisa este campo.";
}

const API_BASE = "https://readyexpressnowbackend.versabold.com/api";
const SUPPORT_PHONE = "+53 5 8324155";
const SUPPORT_MSG = `\n\nSi el problema persiste, contacta a nuestro equipo de soporte:\n📱 WhatsApp: ${SUPPORT_PHONE}`;

function getUserFriendlyError(error, status) {
  const message = error?.error || error?.message || "";

  // Comprobante duplicado (409)
  if (status === 409 || message.includes("comprobante ya fue enviado") || message.includes("ya fue enviado")) {
    return `⚠️ Este comprobante ya fue enviado anteriormente. Si acabas de hacer el pago, espera unos minutos mientras lo revisamos.\n\nSi crees que es un error, contáctanos: 📱 WhatsApp: ${SUPPORT_PHONE}`;
  }

  // Errores de Supabase RLS (acceso denegado)
  if (message.includes("42501") || message.includes("RLS") || message.includes("permission denied")) {
    return `⚠️ Estamos realizando mantenimiento en nuestros servidores.\n\nIntenta nuevamente en unos minutos.${SUPPORT_MSG}`;
  }

  // Errores de validación
  if (message.includes("item") || message.includes("cantidad")) {
    return `❌ Por favor verifica que hayas seleccionado al menos un producto.`;
  }

  if (message.includes("total") || message.includes("monto")) {
    return `❌ Hay un problema con el monto del pedido. Intenta de nuevo.`;
  }

  if (message.includes("nombre") || message.includes("remitente")) {
    return `❌ Por favor completa el nombre de la persona que envía.`;
  }

  if (message.includes("teléfono") || message.includes("telefono")) {
    return `❌ Por favor ingresa un teléfono válido.`;
  }

  if (message.includes("dirección") || message.includes("direccion")) {
    return `❌ Por favor completa la dirección de entrega.`;
  }

  if (message.includes("receptor")) {
    return `❌ Por favor completa los datos de la persona que recibe.`;
  }

  if (message.includes("imagen") || message.includes("comprobante")) {
    return `❌ Por favor sube una imagen clara del comprobante de pago.`;
  }

  if (message.includes("metodo") || message.includes("pago")) {
    return `❌ Por favor selecciona un método de pago.`;
  }

  // Errores de conexión
  if (message.includes("Failed to fetch") || message.includes("network")) {
    return `📡 No hay conexión a internet. Verifica tu conexión y intenta de nuevo.`;
  }

  // Errores del servidor
  if (message.includes("500") || message.includes("Internal Server Error")) {
    return `⚠️ Estamos experimentando problemas técnicos temporales.\n\nIntenta nuevamente en unos minutos.${SUPPORT_MSG}`;
  }

  // Otros errores con servidor
  if (message.includes("504") || message.includes("503") || message.includes("502")) {
    return `⚠️ El servidor está temporalmente fuera de servicio.\n\nIntenta nuevamente en unos minutos.${SUPPORT_MSG}`;
  }

  // Errores de timeout
  if (message.includes("timeout")) {
    return `⏱️ La solicitud tardó demasiado. Verifica tu conexión e intenta de nuevo.`;
  }

  // Errores de autenticación
  if (message.includes("401") || message.includes("sesion")) {
    return `📱 Tu sesión ha expirado. Por favor recarga la página e intenta de nuevo.`;
  }

  // Fallback para otros errores
  return `❌ Algo salió mal. Por favor intenta de nuevo.${SUPPORT_MSG}`;
}

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

async function request(path, options = {}) {
  try {
    const res = await fetchWithTimeout(`${API_BASE}${path}`, options, 10000);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const userMessage = getUserFriendlyError(err, res.status);
      const error = new Error(userMessage);
      error.status = res.status;
      error.originalError = err;
      throw error;
    }
    return res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("⏱️ La solicitud tardó demasiado. Verifica tu conexión e intenta de nuevo.");
    }
    if (err.message?.includes("⚠️") || err.message?.includes("❌") || err.message?.includes("📡") || err.message?.includes("⏱️") || err.message?.includes("📱")) {
      throw err;
    }
    const userMessage = getUserFriendlyError(err);
    const error = new Error(userMessage);
    error.originalError = err;
    throw error;
  }
}

export const getCombos = () => request("/food-combos");
export const getProductos = () => request("/productos");
export const getElectrodomesticos = () => request("/electrodomesticos");
export const getInfo = () => request("/info");
export const createOrder = (data) =>
  request("/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

export const cancelOrder = (orderId) =>
  request(`/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: "PATCH",
  });

export async function uploadPayment(formData) {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/payments/upload`, {
      method: "POST",
      body: formData,
    }, 30000);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const userMessage = getUserFriendlyError(err, res.status);
      const error = new Error(userMessage);
      error.status = res.status;
      error.originalError = err;
      throw error;
    }
    return res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("⏱️ El envío tardó demasiado. Verifica tu conexión e intenta de nuevo.");
    }
    if (err.message?.includes("⚠️") || err.message?.includes("❌") || err.message?.includes("📡") || err.message?.includes("⏱️") || err.message?.includes("📱")) {
      throw err;
    }
    const userMessage = getUserFriendlyError(err);
    const error = new Error(userMessage);
    error.originalError = err;
    throw error;
  }
}

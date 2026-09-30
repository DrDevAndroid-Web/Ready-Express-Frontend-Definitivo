import { supabase } from "../../config/supabase.js";
import { sendEmail, sendCancelledOrderEmail } from "../email/email.service.js";
import { sendPrintableOrderEmail } from "../email/resend.js";
import { notifyNewOrder, notifyOrderCancelled } from "../telegram/telegram.service.js";
import { NotificationManager } from "../notifications/notifications.service.js";
import { createBadRequest, createConflict, createNotFound, throwIfSupabaseError } from "../../utils/http-error.js";
import { notifyOrderSMS } from "../sms/sms.service.js";
import { getDeliveryLocation } from "../locations/locations.service.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { priceItemsFromCatalog } from "./pricing.js";
import { parseBirthDate } from "../../utils/billing.js";

export async function createOrder(data, customerId = null) {
  const orderInput = await normalizeOrderInput(data, customerId);

  let { data: order, error } = await supabase
    .from("orders")
    .insert(orderInput)
    .select()
    .single();

  // Red de seguridad si el backend se despliega antes que la migración
  // 20260923_order_sender_split_payer_details.sql: guarda la orden sin las columnas nuevas.
  if (error?.code === "PGRST204" && EXTENDED_ORDER_COLUMNS.some(column => error.message?.includes(column))) {
    console.error("[orders] Falta la migración de remitente/pagador; se guarda la orden sin esos campos");
    const legacyInput = { ...orderInput };
    EXTENDED_ORDER_COLUMNS.forEach(column => delete legacyInput[column]);
    ({ data: order, error } = await supabase.from("orders").insert(legacyInput).select().single());
  }

  throwIfSupabaseError(error, "No se pudo crear la orden");

  // Con TropiPay la orden aún no está pagada: los avisos (APK, email, Telegram, SMS)
  // esperan a que el webhook confirme el pago (ver notifyConfirmedOrder).
  if (data.payment_flow === PAYMENT_FLOW_TROPIPAY) return order;

  announceOrder(order);
  return order;
}

// Emitir SSE de inmediato. El email puede tardar o fallar,
// pero la APK admin debe enterarse apenas la orden existe.
function announceOrder(order) {
  NotificationManager.broadcastOrderCreated(order);
  notifyOrderCreated(order).catch((err) => {
    console.error("[orders:notify]", err?.message || err);
  });
}

// Avisos diferidos de una orden TropiPay: se llaman cuando el webhook confirma el pago
export async function notifyConfirmedOrder(orderId) {
  const { data: order, error } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  throwIfSupabaseError(error, "No se pudo cargar la orden confirmada");
  if (order) announceOrder(order);
}

async function notifyOrderCreated(order) {
  const results = await Promise.allSettled([
    sendEmail(order),
    notifyNewOrder(order),
    notifyOrderSMS(order),
  ]);

  const labels = ["email", "telegram", "sms"];
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(
        `[orders:notify:${labels[i]}]`,
        result.reason?.message || result.reason
      );
    }
  });
}

function tokensMatch(expected, received) {
  if (!expected || !received) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(received));
  return a.length === b.length && timingSafeEqual(a, b);
}

// Acceso a una orden: quien la creó (checkout_token), su cliente registrado o un admin.
// Sin acceso se responde 404 para no revelar qué IDs existen.
export function assertOrderAccess(order, { checkoutToken = null, customerId = null, isAdmin = false } = {}) {
  const allowed = isAdmin
    || tokensMatch(order?.checkout_token, checkoutToken)
    || Boolean(customerId && order?.customer_id === customerId);
  if (!order || !allowed) throw createNotFound("Orden no encontrada");
}

export async function cancelOrder(orderId, access = {}) {
  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  throwIfSupabaseError(fetchError, "No se pudo cargar la orden");
  assertOrderAccess(order, access);

  if (order.status !== "pending") {
    throw createConflict("Solo se pueden cancelar ordenes en estado pendiente");
  }

  // Condición sobre status para que dos cancelaciones simultáneas no notifiquen dos veces
  const { data: cancelled, error: updateError } = await supabase
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", orderId)
    .eq("status", "pending")
    .select("id");

  throwIfSupabaseError(updateError, "No se pudo cancelar la orden");
  if (!cancelled?.length) throw createConflict("Solo se pueden cancelar ordenes en estado pendiente");

  NotificationManager.broadcastOrderCancelled(order);

  Promise.allSettled([
    sendCancelledOrderEmail(order),
    notifyOrderCancelled(order)
  ]).then(results => {
    const labels = ["email", "telegram"];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`[orders:cancel:${labels[i]}]`, r.reason?.message || r.reason);
      }
    });
  });

  return { status: "cancelled", orderId };
}

export async function printOrder(orderId) {
  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  throwIfSupabaseError(error, "No se pudo cargar la orden para imprimir");
  if (!order) throw createNotFound("Orden no encontrada");

  await sendPrintableOrderEmail(order);

  return {
    status: "printed",
    orderId,
    message: "Orden enviada a imprimir"
  };
}

const EXTENDED_ORDER_COLUMNS = ["sender_first_name", "sender_last_name", "payer_details"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const PAYMENT_FLOW_TROPIPAY = "tropipay";

// Datos del pagador que TropiPay exige en `client` (name, lastName, email, phone,
// address, countryIso, termsAndConditions). city/state/post_code ayudan a la validación de la tarjeta.
export function normalizePayer(data = {}) {
  const payer = data.payer && typeof data.payer === "object" ? data.payer : {};
  const email = requireText(data.customer_email, "El email es requerido para pagar con TropiPay").toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw createBadRequest("El email no es valido");

  const countryIso = requireText(payer.country_iso, "El pais del pagador es requerido para TropiPay").toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryIso)) throw createBadRequest("El pais del pagador no es valido");

  if (payer.terms_accepted !== true) {
    throw createBadRequest("Debes aceptar los terminos y condiciones de TropiPay");
  }

  return {
    email,
    details: {
      country_iso: countryIso,
      address: requireText(payer.address, "La direccion del pagador es requerida para TropiPay"),
      city: requireText(payer.city, "La ciudad del pagador es requerida para TropiPay"),
      state: optionalText(payer.state),
      // El formulario de tarjeta de TropiPay exige código postal y fecha de nacimiento;
      // enviarlos evita que el cliente tenga que escribirlos en la pasarela
      post_code: requireText(payer.post_code, "El codigo postal del pagador es requerido para TropiPay"),
      birth_date: parseBirthDate(payer.birth_date),
      terms_accepted_at: new Date().toISOString()
    }
  };
}

async function normalizeOrderInput(data = {}, customerId = null) {
  const items = Array.isArray(data.items) ? data.items : [];
  const requestedTotal = Number(data.total);

  if (!items.length) throw createBadRequest("La orden debe incluir al menos un item");
  if (!Number.isFinite(requestedTotal) || requestedTotal <= 0) {
    throw createBadRequest("El total de la orden debe ser mayor que cero");
  }

  // Nombre y apellidos separados; sender_name/customer_name se aceptan por compatibilidad (APK, clientes viejos)
  const senderFirstName = optionalText(data.sender_first_name);
  const senderLastName = optionalText(data.sender_last_name);
  if (senderFirstName && !senderLastName) throw createBadRequest("Los apellidos del remitente son requeridos");
  const senderName = requireText(
    senderFirstName ? `${senderFirstName} ${senderLastName}` : (data.sender_name || data.customer_name),
    "El nombre del remitente es requerido"
  );
  const senderPhone = requireText(data.sender_phone || data.customer_phone, "El telefono del remitente es requerido");
  const payer = data.payment_flow === PAYMENT_FLOW_TROPIPAY ? normalizePayer(data) : null;
  const receiverName = requireText(data.receiver_name, "El nombre del receptor es requerido");
  const receiverPhone = requireText(data.receiver_phone, "El telefono del receptor es requerido");
  const address = requireText(data.customer_address, "La direccion de entrega es requerida");
  // Precios, nombres y componentes salen del catálogo; el total enviado por el navegador se ignora
  const normalizedItems = await priceItemsFromCatalog(items.map(normalizeItem));
  const productsSubtotal = roundMoney(normalizedItems.reduce((sum, item) => sum + item.precio_total, 0));
  let location = null;
  if (data.delivery_location_id) location = await getDeliveryLocation(data.delivery_location_id);
  const deliverySurcharge = roundMoney(location?.es_base ? 0 : Number(location?.recargo || 0));
  const total = roundMoney(productsSubtotal + deliverySurcharge);

  const status = data.status === "awaiting_manual_payment" ? "awaiting_manual_payment" : "pending";

  return {
    order_reference: createOrderReference(),
    checkout_token: randomBytes(24).toString("hex"),
    customer_id: customerId || null,
    customer_name: senderName,
    customer_email: payer?.email || optionalText(data.customer_email),
    customer_phone: senderPhone,
    customer_address: address,
    sender_name: senderName,
    sender_first_name: senderFirstName,
    sender_last_name: senderLastName,
    sender_phone: senderPhone,
    payer_details: payer?.details || null,
    receiver_name: receiverName,
    receiver_phone: receiverPhone,
    delivery_notes: optionalText(data.delivery_notes),
    delivery_location_id: location?.id || null,
    delivery_municipality: location?.municipio || optionalText(data.delivery_municipality),
    products_subtotal: productsSubtotal,
    delivery_surcharge: deliverySurcharge,
    items: normalizedItems,
    total,
    status
  };
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function createOrderReference() {
  const now = new Date();
  const date = [String(now.getFullYear()).slice(-2), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("");
  return `REN-${date}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

function normalizeItem(item = {}) {
  const name = String(item.nombre || item.name || item.item || "").trim();
  const precio = Number(item.precio ?? item.price ?? 0);
  const cantidad = Number(item.cantidad ?? item.qty ?? item.quantity ?? 1);

  if (!name) throw createBadRequest("Cada item debe tener nombre");
  if (!Number.isFinite(precio) || precio < 0) throw createBadRequest("Cada item debe tener un precio valido");
  if (!Number.isFinite(cantidad) || cantidad <= 0) throw createBadRequest("Cada item debe tener una cantidad valida");
  if (!Number.isInteger(cantidad) || cantidad > 100) throw createBadRequest("La cantidad de cada item debe ser un numero entero entre 1 y 100");

  return {
    ...item,
    nombre: name,
    precio,
    cantidad,
    precio_total: Number(item.precio_total ?? precio * cantidad)
  };
}

function requireText(value, message) {
  const text = String(value ?? "").trim();
  if (!text) throw createBadRequest(message);
  return text;
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

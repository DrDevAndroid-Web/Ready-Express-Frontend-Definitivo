import { supabase } from "../../config/supabase.js";
import { sendEmail, sendCancelledOrderEmail } from "../email/email.service.js";
import { notifyNewOrder, notifyOrderCancelled } from "../telegram/telegram.service.js";
import { NotificationManager } from "../notifications/notifications.service.js";
import { createBadRequest, createConflict, createNotFound, throwIfSupabaseError } from "../../utils/http-error.js";
import { notifyOrderSMS } from "../sms/sms.service.js";

export async function createOrder(data) {
  const orderInput = normalizeOrderInput(data);

  const { data: order, error } = await supabase
    .from("orders")
    .insert(orderInput)
    .select()
    .single();

  throwIfSupabaseError(error, "No se pudo crear la orden");

  // Emitir SSE de inmediato. El email puede tardar o fallar,
  // pero la APK admin debe enterarse apenas la orden existe.
  NotificationManager.broadcastOrderCreated(order);

  notifyOrderCreated(order).catch((err) => {
    console.error("[orders:notify]", err?.message || err);
  });

  return order;
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

export async function cancelOrder(orderId) {
  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  throwIfSupabaseError(fetchError, "No se pudo cargar la orden");
  if (!order) throw createNotFound("Orden no encontrada");

  if (order.status !== "pending") {
    throw createConflict("Solo se pueden cancelar ordenes en estado pendiente");
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", orderId);

  throwIfSupabaseError(updateError, "No se pudo cancelar la orden");

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

function normalizeOrderInput(data = {}) {
  const items = Array.isArray(data.items) ? data.items : [];
  const total = Number(data.total);

  if (!items.length) throw createBadRequest("La orden debe incluir al menos un item");
  if (!Number.isFinite(total) || total <= 0) {
    throw createBadRequest("El total de la orden debe ser mayor que cero");
  }

  const senderName = requireText(data.sender_name || data.customer_name, "El nombre del remitente es requerido");
  const senderPhone = requireText(data.sender_phone || data.customer_phone, "El telefono del remitente es requerido");
  const receiverName = requireText(data.receiver_name, "El nombre del receptor es requerido");
  const receiverPhone = requireText(data.receiver_phone, "El telefono del receptor es requerido");
  const address = requireText(data.customer_address, "La direccion de entrega es requerida");

  return {
    customer_name: senderName,
    customer_email: optionalText(data.customer_email),
    customer_phone: senderPhone,
    customer_address: address,
    sender_name: senderName,
    sender_phone: senderPhone,
    receiver_name: receiverName,
    receiver_phone: receiverPhone,
    delivery_notes: optionalText(data.delivery_notes),
    items: items.map(normalizeItem),
    total,
    status: data.status || "pending"
  };
}

function normalizeItem(item = {}) {
  const name = String(item.nombre || item.name || item.item || "").trim();
  const precio = Number(item.precio ?? item.price ?? 0);
  const cantidad = Number(item.cantidad ?? item.qty ?? item.quantity ?? 1);

  if (!name) throw createBadRequest("Cada item debe tener nombre");
  if (!Number.isFinite(precio) || precio < 0) throw createBadRequest("Cada item debe tener un precio valido");
  if (!Number.isFinite(cantidad) || cantidad <= 0) throw createBadRequest("Cada item debe tener una cantidad valida");

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

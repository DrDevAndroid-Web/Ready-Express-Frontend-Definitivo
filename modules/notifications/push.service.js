import { supabase } from "../../config/supabase.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_BATCH_SIZE = 100;

export async function registerAdminPushToken({ token, platform, deviceName, user }) {
  if (!isExpoPushToken(token)) {
    const error = new Error("Token push de Expo invalido");
    error.status = 400;
    throw error;
  }

  const payload = {
    token,
    platform: platform || "unknown",
    device_name: deviceName || null,
    user_id: user?.id || null,
    user_email: user?.email || null,
    is_active: true,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("admin_push_tokens")
    .upsert(payload, { onConflict: "token" })
    .select("id, token, platform, device_name, updated_at")
    .single();

  if (error) {
    error.message = `${error.message}. Verifica que exista la tabla admin_push_tokens`;
    throw error;
  }

  return data;
}

export async function sendAdminPushNotification(type, data = {}) {
  const { data: tokens, error } = await supabase
    .from("admin_push_tokens")
    .select("token")
    .eq("is_active", true);

  if (error) {
    console.error("[push] No se pudieron cargar tokens admin:", error.message);
    return { sent: 0, errors: [error.message] };
  }

  const uniqueTokens = [...new Set((tokens ?? []).map(row => row.token).filter(isExpoPushToken))];
  if (!uniqueTokens.length) return { sent: 0, errors: [] };

  const title = getPushTitle(type);
  const body = getPushBody(type, data);
  const chunks = chunk(uniqueTokens, MAX_BATCH_SIZE);
  let sent = 0;
  const errors = [];

  for (const tokenChunk of chunks) {
    const messages = tokenChunk.map(token => ({
      to: token,
      title,
      body,
      sound: "default",
      priority: "high",
      data: {
        type,
        orderId: data.orderId || "",
        paymentId: data.paymentId || "",
        senderName: data.senderName || "",
        reason: data.reason || ""
      }
    }));

    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(messages)
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        errors.push(result?.errors?.[0]?.message || `Expo Push HTTP ${response.status}`);
        continue;
      }

      const tickets = Array.isArray(result?.data) ? result.data : [];
      sent += tickets.filter(ticket => ticket.status === "ok").length;
      tickets
        .filter(ticket => ticket.status === "error")
        .forEach(ticket => errors.push(ticket.message || ticket.details?.error || "Expo Push error"));
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (errors.length) console.warn("[push] errores enviando push admin", errors);
  console.info(`[push] ${type} enviado a ${sent}/${uniqueTokens.length} dispositivos`);
  return { sent, errors };
}

function isExpoPushToken(token) {
  return typeof token === "string" && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}

function getPushTitle(type) {
  const titles = {
    order_created:          "🛒 Nueva orden",
    order_delivered:        "✅ Orden entregada",
    payment_received:       "💳 Nuevo comprobante",
    payment_approved:       "✅ Pago aprobado",
    payment_rejected:       "❌ Pago rechazado",
    test:                   "🔔 Prueba de notificaciones",
    chat_session_started:   "💬 Nuevo cliente en el chat",
    chat_client_message:    "💬 Mensaje de cliente",
    chat_message_pending:   "⏳ Cliente esperando atención",
    chat_handoff_needed:    "🚨 Cliente pide atención humana",
    chat_contact_received:  "📞 Cliente dejó su contacto",
  };
  return titles[type] || "ReadyExpress Admin";
}

function getPushBody(type, data = {}) {
  // Eventos de chat — usar lastMessage como cuerpo si está disponible
  if (type === "chat_client_message" || type === "chat_message_pending") {
    if (data.lastMessage) return truncate(data.lastMessage, 100);
    return "El cliente envió un mensaje";
  }
  if (type === "chat_session_started") {
    return "Un cliente inició una nueva conversación";
  }
  if (type === "chat_handoff_needed") {
    if (data.lastMessage) return truncate(data.lastMessage, 100);
    return "El cliente necesita hablar con una persona";
  }
  if (type === "chat_contact_received") {
    return data.contact ? `Contacto: ${data.contact}` : "El cliente compartió su contacto";
  }

  // Eventos de órdenes y pagos
  if (type === "order_created") return data.customerName ? `De: ${data.customerName}` : "Nueva orden recibida";
  if (type === "payment_received") return data.senderName ? `De: ${data.senderName}` : "Nuevo comprobante recibido";
  if (data.orderId) return `Orden ${String(data.orderId).slice(0, 8)}`;
  return "Evento recibido desde ReadyExpress";
}

function truncate(str, max) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

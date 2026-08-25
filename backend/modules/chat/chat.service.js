import { supabase } from "../../config/supabase.js";
import { NotificationManager } from "../notifications/notifications.service.js";

const AI_API_URL = "https://hostingclan.com/api/ai/chat/completions";
const AI_MODEL = "openai/gpt-5-nano";
const AI_API_KEY = process.env.CHAT_AI_API_KEY;

// ─── Supabase helpers ────────────────────────────────────────────────────────

export async function createSession() {
  const { data, error } = await supabase
    .from("chat_sessions")
    .insert({ status: "ai" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getSession(sessionId) {
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();
  if (error) throw error;
  return data;
}

export async function getAllSessions() {
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getSessionMessages(sessionId) {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function saveMessage(sessionId, role, content) {
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({ session_id: sessionId, role, content })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setSessionStatus(sessionId, status) {
  const { error } = await supabase
    .from("chat_sessions")
    .update({ status })
    .eq("id", sessionId);
  if (error) throw error;
}

export async function saveClientContact(sessionId, contact) {
  const { error } = await supabase
    .from("chat_sessions")
    .update({ client_contact: contact })
    .eq("id", sessionId);
  if (error) throw error;
}

// ─── Contexto de productos desde Supabase ───────────────────────────────────

async function buildProductContext() {
  const [combosRes, productosRes, infoRes] = await Promise.allSettled([
    supabase.from("food_combos").select("nombre,precio,detalles,disponible").eq("disponible", true),
    supabase.from("Productos").select("nombre,precio,disponible").eq("disponible", true),
    supabase.from("informacion_cambiante").select("*").limit(1).single()
  ]);

  const combos = combosRes.status === "fulfilled" ? (combosRes.value.data ?? []) : [];
  const productos = productosRes.status === "fulfilled" ? (productosRes.value.data ?? []) : [];
  const info = infoRes.status === "fulfilled" ? infoRes.value.data : {};

  const combosText = combos.map(c => {
    const items = Object.entries(c.detalles || {})
      .map(([k, v]) => `  - ${k}: ${v}`)
      .join("\n");
    return `• ${c.nombre} — $${c.precio} USD\n${items}`;
  }).join("\n\n");

  const productosText = productos.map(p =>
    `• ${p.nombre}${p.precio ? ` — $${p.precio} USD` : ""}`
  ).join("\n");

  return `
COMBOS DISPONIBLES HOY:
${combosText || "No hay combos disponibles en este momento."}

PRODUCTOS SUELTOS DISPONIBLES:
${productosText || "No hay productos sueltos disponibles en este momento."}

INFORMACIÓN DEL NEGOCIO:
- Horario: ${info?.horario || "Consultar por WhatsApp"}
- WhatsApp: ${info?.whatsapp || "No disponible"}
- Entregas únicamente en Guantánamo, Cuba
- Métodos de pago (solo mencionar si el cliente pregunta): Zelle y TocoPay
- Tarjetas (solo mencionar si el cliente pregunta por Visa/Mastercard): no se aceptan por restricciones bancarias hacia Cuba
`.trim();
}

// ─── Detección de handoff ────────────────────────────────────────────────────

const HANDOFF_TRIGGERS = [
  "hablar con", "agente", "persona", "humano", "gerente", "no puedo pagar",
  "no tengo", "no funciona", "problema", "ayuda urgente", "quiero hablar"
];

export function needsHandoff(text) {
  const lower = text.toLowerCase();
  return HANDOFF_TRIGGERS.some(t => lower.includes(t));
}

// ─── Detección de contacto del cliente ──────────────────────────────────────

export function extractContact(text) {
  const phone = text.match(/(\+?[\d\s\-().]{7,20})/);
  const email = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  return phone?.[0]?.trim() || email?.[0]?.trim() || null;
}

// ─── Llamada a la IA ─────────────────────────────────────────────────────────

export async function callAI(messages, productContext) {
  if (!AI_API_KEY) throw new Error("CHAT_AI_API_KEY no configurada");

  const systemPrompt = `Eres el asistente de ventas de ReadyExpressNow, servicio de envíos a Guantánamo, Cuba desde el exterior.

Tu personalidad:
- Cálido, directo y confiable — como alguien que ya conoce el proceso por dentro
- Hablas en español latinoamericano informal pero respetuoso
- Usas emojis con moderación (máximo 1 por mensaje)
- Respuestas cortas (máximo 3 oraciones). Nunca hagas dos preguntas a la vez.

El cliente que habla contigo sabe que existen los envíos a Cuba pero todavía no confía del todo en nosotros. Tu trabajo es generar confianza primero, venta después. No empujes — acompaña.

Tus capacidades:
- Ayudar al cliente a elegir qué enviar según lo que necesita su familia
- Informar sobre combos y productos disponibles HOY con precios exactos
- Cuando el cliente confirme su pedido, añadirlo al carrito y guiarlo al checkout
- Si no puedes resolver algo técnico o de soporte, ofrecer conectar con Ernesto

Reglas estrictas:
- NUNCA inventes productos, precios o disponibilidad — usa solo los datos del contexto
- NUNCA menciones métodos de pago a menos que el cliente pregunte
- Si preguntan cómo pagar: Zelle o TocoPay. Nada más.
- Si preguntan por Visa/Mastercard: explica que no aplican por restricciones bancarias hacia Cuba
- Responde solo lo que te preguntan. Sin información extra no solicitada.
- Si el cliente duda o tiene un problema técnico: ofrece conectarlo con Ernesto
- Cuando el cliente deje su contacto, confirma que se lo pasaste a Ernesto
- Si el mensaje es exactamente "__assistant_start__": responde SOLO "¿Qué necesitan en casa? Cuéntame y te ayudo a armar el pedido 🛒"

FLUJO DE PEDIDO — MUY IMPORTANTE:
Paso 1 — Cuando el cliente diga qué quiere pedir: muestra el resumen con precios y pregunta SIEMPRE: "¿Confirmas que quieres añadir esto al carrito?"
Paso 2 — Solo cuando el cliente confirme explícitamente (diga "sí", "ok", "confirmo", "adelante", "dale" o similar): responde con este formato EXACTO (sin texto adicional antes ni después):
CART_ACTION:{"items":[{"nombre":"Nombre exacto del producto","cantidad":1,"precio":0.00},...],"mensaje":"Listo, lo agregué al carrito 🛒 Ahora completa tus datos y sube el comprobante de pago — en menos de 24h lo confirmamos."}
- Usa los nombres exactos de los productos tal como aparecen en el contexto
- El precio es el precio unitario
- NUNCA emitas CART_ACTION sin que el cliente haya confirmado explícitamente

DATOS ACTUALIZADOS DE LA TIENDA:
${productContext}`;

  const res = await fetch(AI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AI_API_KEY}`
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ]
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Chat AI error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? "Lo siento, no pude procesar tu mensaje. Intenta de nuevo.";

  // Detectar CART_ACTION en la respuesta
  const cartMatch = raw.match(/CART_ACTION:(\{[\s\S]*\})/);
  if (cartMatch) {
    try {
      const parsed = JSON.parse(cartMatch[1]);
      return { __cart: true, items: parsed.items, reply: parsed.mensaje };
    } catch { }
  }

  return raw;
}

// ─── SMS de alerta ───────────────────────────────────────────────────────────

export async function notifyChatStarted(sessionId) {
  const VERSABOLD_SMS_URL = process.env.VERSABOLD_SMS_URL;
  const VERSABOLD_API_KEY = process.env.VERSABOLD_API_KEY;
  const recipients = (process.env.SMS_NOTIFY_PHONES ?? "").split(",").map(p => p.trim()).filter(Boolean);

  if (!VERSABOLD_SMS_URL || !VERSABOLD_API_KEY || !recipients.length) return;

  const mstext = `💬 Cliente en chat - ReadyExpressNow\nSesión ${sessionId}`;

  await Promise.allSettled(recipients.map(r =>
    fetch(VERSABOLD_SMS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": VERSABOLD_API_KEY },
      body: JSON.stringify({ recipient: r, mstext })
    })
  ));
}

// ─── Flujo principal de mensaje ──────────────────────────────────────────────

export async function processMessage(sessionId, userText) {
  const session = await getSession(sessionId);

  await saveMessage(sessionId, "user", userText);

  // Si está en modo handoff, el admin responde — no invocamos la IA
  if (session.status === "handoff") {
    return { handoff: true, reply: null };
  }

  // Detectar si el mensaje activa handoff
  if (needsHandoff(userText)) {
    await setSessionStatus(sessionId, "handoff");
    NotificationManager.sendNotification("chat_handoff_needed", {
      sessionId,
      lastMessage: userText,
      message: `Cliente necesita atención en sesión ${sessionId}`
    });
  }

  // Detectar si dejó su contacto
  const contact = extractContact(userText);
  if (contact && !session.client_contact) {
    await saveClientContact(sessionId, contact);
    NotificationManager.sendNotification("chat_contact_received", {
      sessionId,
      contact,
      message: `Cliente dejó contacto: ${contact}`
    });
  }

  const [messages, productContext] = await Promise.all([
    getSessionMessages(sessionId),
    buildProductContext()
  ]);

  const aiMessages = messages.map(m => ({ role: m.role === "admin" ? "assistant" : m.role, content: m.content }));

  const aiResult = await callAI(aiMessages, productContext);

  // La IA devolvió un CART_ACTION
  if (aiResult?.__cart) {
    await saveMessage(sessionId, "assistant", aiResult.reply);
    return { handoff: session.status === "handoff", reply: aiResult.reply, cartItems: aiResult.items };
  }

  await saveMessage(sessionId, "assistant", aiResult);
  return { handoff: session.status === "handoff", reply: aiResult };
}

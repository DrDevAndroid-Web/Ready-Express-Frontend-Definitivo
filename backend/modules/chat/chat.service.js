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
- Métodos de pago aceptados: Zelle y TocoPay
- No se aceptan tarjetas de crédito/débito (Visa, Mastercard) por restricciones bancarias hacia Cuba
- Entregas únicamente en Guantánamo, Cuba
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

  const systemPrompt = `Eres el asistente virtual de ReadyExpressNow, una tienda de envíos a Guantánamo, Cuba desde el exterior.

Tu personalidad:
- Amigable, cálido y paciente
- Hablas en español latinoamericano informal pero respetuoso
- Usas emojis con moderación (1-2 por mensaje)
- Respuestas cortas y directas (máximo 4 oraciones)

Tus capacidades:
- Informar sobre productos, combos y precios disponibles HOY
- Explicar cómo funciona el proceso de pedido y pago
- Ayudar al cliente a elegir el combo más adecuado
- Si no puedes resolver algo, ofrecer conectar con Ernesto (gerente de ventas)

Reglas estrictas:
- NUNCA inventes productos, precios o disponibilidad que no estén en el contexto
- Si el cliente pregunta por Visa, Mastercard u otras formas de pago, explica que solo aceptamos Zelle y TocoPay por restricciones bancarias hacia Cuba
- Si detectas que el cliente tiene un problema de pago o solicita hablar con alguien, di que lo vas a conectar con Ernesto nuestro gerente de ventas
- Cuando el cliente deje su contacto (WhatsApp o email), confirma que se lo pasaste a Ernesto

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
  return data.choices?.[0]?.message?.content ?? "Lo siento, no pude procesar tu mensaje. Intenta de nuevo.";
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

  const reply = await callAI(aiMessages, productContext);
  await saveMessage(sessionId, "assistant", reply);

  return { handoff: session.status === "handoff", reply };
}

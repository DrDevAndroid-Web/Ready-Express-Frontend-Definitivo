import { supabase } from "../../config/supabase.js";
import { NotificationManager } from "../notifications/notifications.service.js";
import { notifyChatStartedTelegram } from "../telegram/telegram.service.js";

const AI_API_URL = "https://hostingclan.com/api/ai/chat/completions";
const AI_MODEL = "openai/gpt-5-nano";
const AI_API_KEY = process.env.CHAT_AI_API_KEY;
const SUPPORT_WHATSAPP = "+53 56189395";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Supabase helpers ────────────────────────────────────────────────────────

export async function getOrCreateClient(clientId = null) {
  const candidateId = String(clientId || "").trim();
  const normalizedId = UUID_RE.test(candidateId) ? candidateId : "";

  if (normalizedId) {
    const { data: existing, error: existingError } = await supabase
      .from("chat_clients")
      .select("*")
      .eq("id", normalizedId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      await touchClient(existing.id);
      return existing;
    }
  }

  const insertPayload = normalizedId ? { id: normalizedId } : {};
  const { data, error } = await supabase
    .from("chat_clients")
    .insert(insertPayload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function touchClient(clientId, patch = {}) {
  if (!clientId) return;
  const { error } = await supabase
    .from("chat_clients")
    .update({ last_seen_at: new Date().toISOString(), ...patch })
    .eq("id", clientId);
  if (error) throw error;
}

export async function findReusableSession(clientId) {
  if (!clientId) return null;
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("client_id", clientId)
    .in("status", ["ai", "handoff"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function assignSessionClient(sessionId, clientId) {
  const { data, error } = await supabase
    .from("chat_sessions")
    .update({ client_id: clientId })
    .eq("id", sessionId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

const WELCOME_MESSAGE =
  "Hola, soy el asistente virtual de ReadyExpressNow. Entiendo que enviar desde el exterior puede generar dudas — estoy aquí para ayudarte. Un agente real revisará tu caso muy pronto. ¿Qué necesitas hoy? 🛒";

export async function createSession(clientId = null) {
  const { data, error } = await supabase
    .from("chat_sessions")
    .insert({ status: "ai", client_id: clientId })
    .select()
    .single();
  if (error) throw error;

  // Guardar el mensaje de bienvenida del asistente como primer mensaje
  await saveMessage(data.id, "assistant", WELCOME_MESSAGE).catch(err =>
    console.error("[chat] Error guardando mensaje de bienvenida:", err.message)
  );

  return data;
}

export async function startOrResumeSession(clientId = null, sessionId = null) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (normalizedSessionId) {
    try {
      const existingSession = await getSession(normalizedSessionId);
      const client = await getOrCreateClient(existingSession.client_id || clientId);
      const session = existingSession.client_id
        ? existingSession
        : await assignSessionClient(existingSession.id, client.id);
      const messages = await getSessionMessages(session.id);
      return { client, session, messages, reused: true };
    } catch {
      // Si la sesión guardada en el navegador ya no existe, se crea una nueva.
    }
  }

  const client = await getOrCreateClient(clientId);
  const reusableSession = await findReusableSession(client.id);
  const session = reusableSession || await createSession(client.id);
  const messages = await getSessionMessages(session.id);

  return { client, session, messages, reused: Boolean(reusableSession) };
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

export function toChatMessagePayload(message) {
  if (!message) return null;
  return {
    id: message.id,
    sessionId: message.session_id,
    role: message.role,
    content: message.content,
    createdAt: message.created_at
  };
}

export async function setSessionStatus(sessionId, status) {
  const patch = { status };
  if (status === "handoff") patch.handoff_triggered_at = new Date().toISOString();
  const { error } = await supabase
    .from("chat_sessions")
    .update(patch)
    .eq("id", sessionId);
  if (error) throw error;
}

// Devuelve sesiones en handoff donde el admin no ha respondido en más de `maxMinutes`
export async function getAbandonedHandoffSessions(maxMinutes = 8) {
  const cutoff = new Date(Date.now() - maxMinutes * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("id, handoff_triggered_at")
    .eq("status", "handoff")
    .lt("handoff_triggered_at", cutoff);
  if (error) throw error;
  return data ?? [];
}

export async function deleteSession(sessionId) {
  const { error: msgErr } = await supabase
    .from("chat_messages")
    .delete()
    .eq("session_id", sessionId);
  if (msgErr) throw msgErr;

  const { error: sessErr } = await supabase
    .from("chat_sessions")
    .delete()
    .eq("id", sessionId);
  if (sessErr) throw sessErr;
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
- WhatsApp: ${SUPPORT_WHATSAPP}
- Entregas únicamente en Guantánamo, Cuba
- Métodos de pago directos con comprobante (solo mencionar si el cliente pregunta): Zelle y TocoPay
- Métodos de pago asistidos (solo mencionar si el cliente pregunta o si dice que paga desde esos lugares): transferencia desde Mexico, transferencia desde Brazil e IBAN Europa. En estos casos el equipo contacta al cliente por WhatsApp para darle los datos de transferencia y validar el comprobante manualmente.
- IBAN Europa puede demorar mas en confirmarse segun el banco emisor.
- Tarjetas (solo mencionar si el cliente pregunta por Visa/Mastercard): no se aceptan por restricciones bancarias hacia Cuba
`.trim();
}

// ─── Detección de handoff ────────────────────────────────────────────────────

// Frases que inequívocamente piden hablar con una persona
const HANDOFF_STRONG = [
  "hablar con", "habla con", "hablar con alguien", "habla con alguien",
  "quiero hablar", "necesito hablar", "quiero un agente", "necesito un agente",
  "quiero un humano", "necesito un humano", "quiero una persona", "necesita una persona",
  "agente humano", "persona real",
  "ayuda urgente", "urgente", "emergencia"
];

// Señales de frustración — solo escalan si van acompañadas de puntuación fuerte
const HANDOFF_FRUSTRATION_RE = /[!?]{2,}|[A-ZÁÉÍÓÚÑ]{4,}/;

// Frases de problema que por sí solas NO deben escalar (requieren refuerzo)
const HANDOFF_SOFT = [
  "no puedo pagar", "no funciona", "problema con", "error en",
  "no me llega", "no recibí", "no aparece", "algo está mal"
];

export function needsHandoff(text) {
  const lower = text.toLowerCase();

  // Disparo inmediato — frases explícitas de escalación
  if (HANDOFF_STRONG.some(t => lower.includes(t))) return true;

  // Frases de problema + marcador de frustración (mayúsculas sostenidas o !! / ??)
  if (HANDOFF_SOFT.some(t => lower.includes(t)) && HANDOFF_FRUSTRATION_RE.test(text)) return true;

  return false;
}

// Detecta si el cliente repitió una pregunta muy similar (señal de frustración)
export function isRepeatedQuestion(newText, history) {
  if (!history?.length) return false;
  const recent = history.slice(-6).filter(m => m.role === "user").map(m => m.content.toLowerCase());
  const newLower = newText.toLowerCase().slice(0, 60);
  return recent.filter(prev => prev.slice(0, 60) === newLower || similarity(prev, newLower) > 0.82).length >= 2;
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (!longer.length) return 1;
  const matches = shorter.split("").filter((c, i) => longer[i] === c).length;
  return matches / longer.length;
}

// ─── Detección de contacto del cliente ──────────────────────────────────────

export function extractContact(text) {
  const phone = text.match(/(\+?[\d\s\-().]{7,20})/);
  const email = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  return phone?.[0]?.trim() || email?.[0]?.trim() || null;
}

// ─── Llamada a la IA ─────────────────────────────────────────────────────────

export async function callAI(messages, productContext, checkoutContext = null) {
  if (!AI_API_KEY) throw new Error("CHAT_AI_API_KEY no configurada");

  const checkoutPrompt = buildCheckoutPrompt(checkoutContext);

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
- Si no puedes resolver algo técnico o de soporte, ofrecer que un agente de ventas lo contacte
- Si el cliente no estará pendiente del chat o necesita seguimiento manual, pedirle su WhatsApp y decirle que un agente de ventas le responderá por esa vía cuando revise el caso

Reglas estrictas:
- NUNCA inventes productos, precios o disponibilidad — usa solo los datos del contexto
- NUNCA menciones métodos de pago a menos que el cliente pregunte
- Si preguntan cómo pagar: explica brevemente que hay pagos directos por Zelle o TocoPay y pagos asistidos por WhatsApp para Mexico, Brazil e IBAN Europa.
- Si el cliente quiere pagar desde Mexico, Brazil o Europa: dile que puede elegir ese metodo en checkout y que el equipo le escribira por WhatsApp para enviarle los datos. No pidas datos bancarios por el chat.
- Si pregunta por IBAN Europa: aclara que puede demorar mas en confirmarse segun el banco emisor.
- Si preguntan por Visa/Mastercard: explica que no aplican por restricciones bancarias hacia Cuba
- Responde solo lo que te preguntan. Sin información extra no solicitada.
- Si el cliente duda, tiene un problema técnico o pide ayuda humana: ofrece seguimiento manual con un agente de ventas por WhatsApp
- No prometas notificaciones automáticas al cliente fuera del navegador; de momento el seguimiento fuera del chat es manual
- Cuando el cliente deje su contacto, confirma que se lo pasaste a un agente de ventas y que le responderán manualmente por WhatsApp
- Si el mensaje es exactamente "__assistant_start__": responde SOLO "¿Qué necesitan en casa? Cuéntame y te ayudo a armar el pedido 🛒"

FLUJO DE PEDIDO — MUY IMPORTANTE:
Paso 1 — Cuando el cliente diga qué quiere pedir: muestra el resumen con precios y pregunta SIEMPRE: "¿Confirmas que quieres añadir esto al carrito?"
Paso 2 — Solo cuando el cliente confirme explícitamente (diga "sí", "ok", "confirmo", "adelante", "dale" o similar): responde con este formato EXACTO (sin texto adicional antes ni después):
CART_ACTION:{"items":[{"nombre":"Nombre exacto del producto","cantidad":1,"precio":0.00},...],"mensaje":"Listo, lo agregué al carrito 🛒 Ahora completa tus datos y elige el metodo de pago en checkout."}
- Usa los nombres exactos de los productos tal como aparecen en el contexto
- El precio es el precio unitario
- NUNCA emitas CART_ACTION sin que el cliente haya confirmado explícitamente

DATOS ACTUALIZADOS DE LA TIENDA:
${productContext}

${checkoutPrompt}`;

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

  const mstext = `💬 Cliente escribió en chat - ReadyExpressNow\nSesión ${sessionId}`;

  await Promise.allSettled(recipients.map(r =>
    fetch(VERSABOLD_SMS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": VERSABOLD_API_KEY },
      body: JSON.stringify({ recipient: r, mstext })
    })
  ));
}

// ─── Flujo principal de mensaje ──────────────────────────────────────────────

export async function processMessage(sessionId, userText, context = null) {
  const session = await getSession(sessionId);
  let handoffActive = session.status === "handoff";
  const isFirstClientMessage = !session.last_client_message_at;

  const userMessage = await saveMessage(sessionId, "user", userText);

  if (isFirstClientMessage) {
    Promise.allSettled([
      notifyChatStarted(sessionId),
      notifyChatStartedTelegram(sessionId)
    ]).then(results => {
      const labels = ["sms", "telegram"];
      results.forEach((result, i) => {
        if (result.status === "rejected") {
          console.error(`[chat] Error enviando alerta por ${labels[i]}:`, result.reason?.message || result.reason);
        }
      });
    });
  }

  if (session.client_id) {
    touchClient(session.client_id, { last_message_at: new Date().toISOString() })
      .catch(err => console.error("[chat] Error actualizando cliente:", err.message));
  }

  // Si está en modo handoff, el admin responde — no invocamos la IA
  if (handoffActive) {
    return { handoff: true, reply: null, userMessage };
  }

  // Detectar si el mensaje activa handoff (por keywords o por pregunta repetida)
  const historyForRepeat = await getSessionMessages(sessionId);
  if (!handoffActive && (needsHandoff(userText) || isRepeatedQuestion(userText, historyForRepeat))) {
    await setSessionStatus(sessionId, "handoff");
    handoffActive = true;
    NotificationManager.sendNotification("chat_handoff_needed", {
      sessionId,
      lastMessage: userText,
      chatMessage: toChatMessagePayload(userMessage),
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

  const aiResult = await callAI(aiMessages, productContext, normalizeCheckoutContext(context));

  // La IA devolvió un CART_ACTION
  if (aiResult?.__cart) {
    const assistantMessage = await saveMessage(sessionId, "assistant", aiResult.reply);
    return {
      handoff: handoffActive,
      reply: aiResult.reply,
      cartItems: aiResult.items,
      userMessage,
      assistantMessage
    };
  }

  const assistantMessage = await saveMessage(sessionId, "assistant", aiResult);
  return { handoff: handoffActive, reply: aiResult, userMessage, assistantMessage };
}

function normalizeCheckoutContext(context) {
  if (!context || context.surface !== "checkout") return null;
  const methods = Array.isArray(context.availablePaymentMethods)
    ? context.availablePaymentMethods.slice(0, 12).map(method => ({
      name: String(method.name || "").slice(0, 80),
      flow: String(method.flow || "").slice(0, 40)
    }))
    : [];

  return {
    surface: "checkout",
    step: String(context.step || "").slice(0, 40),
    cartTotal: Number(context.cartTotal) || null,
    selectedPaymentMethod: context.selectedPaymentMethod ? String(context.selectedPaymentMethod).slice(0, 80) : null,
    selectedPaymentFlow: context.selectedPaymentFlow ? String(context.selectedPaymentFlow).slice(0, 40) : null,
    availablePaymentMethods: methods
  };
}

function buildCheckoutPrompt(context) {
  if (!context) return "";
  const methods = context.availablePaymentMethods
    .map(method => `- ${method.name} (${method.flow === "assisted" ? "pago asistido por WhatsApp" : "pago directo con comprobante"})`)
    .join("\n");

  return `
CONTEXTO ACTUAL DEL CHECKOUT:
- El cliente está dentro del checkout, no en la etapa de venta.
- Paso actual: ${context.step || "desconocido"}
- Total del carrito: ${context.cartTotal ? `$${context.cartTotal} USD` : "no disponible"}
- Método seleccionado: ${context.selectedPaymentMethod || "ninguno"}
- Flujo seleccionado: ${context.selectedPaymentFlow || "ninguno"}
- Métodos disponibles:
${methods || "- No disponible"}

REGLAS PARA CHECKOUT:
- Responde solo dudas del checkout, pago, datos de entrega o qué sucede después.
- No agregues productos al carrito y no emitas CART_ACTION mientras el cliente esté en checkout.
- Si el cliente no tiene Zelle o TocoPay, recomiéndale elegir un método asistido según su país.
- Si necesita ayuda humana o no entiende cómo pagar, ofrece que un agente de ventas lo contacte.
- Si el cliente no va a quedarse en la página esperando, pídele su WhatsApp para seguimiento manual con un agente de ventas.
- No digas que recibirá SMS, email o aviso automático cuando un agente responda; fuera del chat el contacto es manual por WhatsApp.
- Mantén la respuesta corta, clara y accionable.
`.trim();
}

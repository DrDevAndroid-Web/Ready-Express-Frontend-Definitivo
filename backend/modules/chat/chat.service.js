import { supabase } from "../../config/supabase.js";
import { NotificationManager } from "../notifications/notifications.service.js";
import { notifyChatStartedTelegram } from "../telegram/telegram.service.js";
import { isMuted } from "../../utils/mute.js";
import { DEFAULT_PRICING, withStorePrices } from "../../utils/store-pricing.js";
import { getPricingSettings } from "../settings/pricing-settings.service.js";

const AI_API_URL = "https://hostingclan.com/api/ai/chat/completions";
const AI_MODEL = "openai/gpt-5-nano";
const AI_API_KEY = process.env.CHAT_AI_API_KEY;
const SUPPORT_WHATSAPP = "+53 56189395";
const HELP_URL = "https://www.readyexpressnow.com/ayuda";

// Conocimiento fijo del agente sobre el pago con tarjeta (procesado por TropiPay)
export const CARD_PAYMENT_KNOWLEDGE = `
PAGO CON TARJETA (lo que debes saber; responde solo la parte que pregunten):
- En la tienda aparece como "Tarjeta de débito o crédito". Acepta Visa y Mastercard, de débito o crédito, habilitadas para compras por internet. El cobro es en dólares (USD) por el total del pedido.
- Lo procesa TropiPay, una pasarela de pago segura. Nosotros nunca vemos ni guardamos los datos de la tarjeta. Si el cliente tiene saldo en TropiPay, también puede usarlo en la pasarela.
- Requiere cuenta: el cliente debe iniciar sesión o crear su cuenta gratis. Si elige tarjeta sin sesión, la tienda le muestra "Iniciar sesión" y "Crear cuenta gratis"; el carrito y los datos del envío se guardan y al terminar vuelve al pago.
- Crear cuenta: nombre, apellidos, email, teléfono, contraseña de mínimo 8 caracteres, dirección de entrega en Guantánamo y datos de facturación del titular de la tarjeta (país, dirección, ciudad, estado, código postal, fecha de nacimiento; debe ser mayor de 18) y aceptar los términos de TropiPay. A veces debe confirmar el email antes de iniciar sesión.
- Datos de facturación: son los del titular de la tarjeta en su país, no la dirección de Cuba. El banco los usa para validar el pago.
- Pasos: en el checkout, paso "Quién paga y cómo", elegir "Tarjeta de débito o crédito" → revisar datos del titular → "Pagar con tarjeta" → en la pasarela escribir número, vencimiento y CVV → el banco puede pedir un código (3D Secure) → vuelve a la tienda con "Pago confirmado" y el pedido pasa a preparación.
- Si el pago se rechaza: no se cobra nada. Causas comunes: fondos insuficientes, verificación 3D Secure sin completar, CVV o datos mal escritos, tarjeta sin compras internacionales o por internet. Puede reintentar con "Reintentar pago con tarjeta" o desde Mi cuenta → Pedidos → "Reintentar pago", usar otra tarjeta o elegir "Pagar con otro método".
- Si pagó y dice "Tu pago aún no está confirmado": esperar unos minutos y tocar "Comprobar de nuevo"; no pagar otra vez sin revisar Mi cuenta. Si pasa más de una hora, ofrecer seguimiento con un agente.
- Olvidó la contraseña: en "Iniciar sesión" tocar "¿Olvidaste tu contraseña?"; le llega un enlace por email válido una hora (revisar spam).
- Mi cuenta: ver estado de pago y entrega de cada pedido, reintentar pagos, guardar direcciones y editar datos de facturación.
`.trim();
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

  // El asistente cita el precio final de la tienda (con recargo), no el configurado
  const pricing = await getPricingSettings().catch(() => DEFAULT_PRICING);
  const combos = withStorePrices(combosRes.status === "fulfilled" ? (combosRes.value.data ?? []) : [], pricing);
  const productos = withStorePrices(productosRes.status === "fulfilled" ? (productosRes.value.data ?? []) : [], pricing);
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
- Métodos de pago (solo mencionar si el cliente pregunta):
  1. Tarjeta de débito o crédito: pago en línea, el pedido se confirma al instante.
  2. Zelle y TocoPay: pago directo; el cliente sube la captura del comprobante.
  3. Pago asistido por WhatsApp: transferencia desde México, Brasil o IBAN Europa. El equipo le escribe por WhatsApp con los datos y valida el comprobante manualmente. IBAN Europa puede demorar más según el banco emisor.
- Ayuda completa para el cliente: ${HELP_URL}

${CARD_PAYMENT_KNOWLEDGE}
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
  const zelleSafetyPrompt = `
REGLA ESPECIFICA PARA DUDAS DE ZELLE:
- Si el cliente teme que su banco bloquee una transferencia o pide otro numero personal, valida brevemente su preocupacion.
- No des ni sugieras numeros personales alternativos y no recomiendes transferir a un destinatario no confirmado.
- Ofrece estas dos opciones: llamar o escribir por WhatsApp al numero oficial ${SUPPORT_WHATSAPP} para confirmar los datos de Zelle, o dejar su propio numero de WhatsApp con codigo de pais para que un agente lo contacte manualmente.
- Pregunta cual opcion prefiere y no repitas toda la explicacion que el cliente ya dio.
`.trim();

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
- Si preguntan cómo pagar: explica brevemente que puede pagar con tarjeta de débito o crédito (necesita iniciar sesión), con Zelle o TocoPay subiendo el comprobante, o con pago asistido por WhatsApp desde México, Brasil o IBAN Europa.
- Si preguntan por tarjeta, Visa, Mastercard o TropiPay: SÍ se aceptan. Explica el pago con tarjeta según la sección PAGO CON TARJETA y recuerda que debe iniciar sesión o crear su cuenta gratis.
- Si el cliente quiere pagar desde México, Brasil o Europa: dile que puede elegir ese metodo en checkout y que el equipo le escribira por WhatsApp para enviarle los datos. No pidas datos bancarios por el chat.
- Si pregunta por IBAN Europa: aclara que puede demorar mas en confirmarse segun el banco emisor.
- NUNCA pidas ni aceptes números de tarjeta, CVV, contraseñas ni códigos del banco por el chat. Si el cliente los escribe, dile que no los comparta y que solo los ponga en la pasarela de pago.
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

${zelleSafetyPrompt}

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
  if (isMuted("sms")) return;
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

const CHECKOUT_FLOW_LABELS = {
  tropipay: "pago en línea con tarjeta; requiere iniciar sesión",
  assisted: "pago asistido por WhatsApp",
  proof_upload: "pago directo con comprobante"
};

export function buildCheckoutPrompt(context) {
  if (!context) return "";
  const methods = context.availablePaymentMethods
    .map(method => `- ${method.name} (${CHECKOUT_FLOW_LABELS[method.flow] || CHECKOUT_FLOW_LABELS.proof_upload})`)
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
- Si el cliente no tiene Zelle o TocoPay, recomiéndale pagar con tarjeta de débito o crédito (con su cuenta) o un método asistido según su país.
- Si eligió tarjeta y no puede continuar porque no ha iniciado sesión, dile que toque "Iniciar sesión" o "Crear cuenta gratis" en la misma opción de tarjeta; no pierde el carrito.
- Si necesita ayuda humana o no entiende cómo pagar, ofrece que un agente de ventas lo contacte.
- Si el cliente no va a quedarse en la página esperando, pídele su WhatsApp para seguimiento manual con un agente de ventas.
- No digas que recibirá SMS, email o aviso automático cuando un agente responda; fuera del chat el contacto es manual por WhatsApp.
- Mantén la respuesta corta, clara y accionable.
`.trim();
}

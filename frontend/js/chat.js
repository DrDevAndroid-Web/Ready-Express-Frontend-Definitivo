import { addItem } from "./cart.js?v61";
import { API_BASE } from "./api.js?v61";

const CHAT_API = API_BASE;
let productCache = null;
const CLIENT_KEY = "ren_chat_client";
const SESSION_KEY = "ren_chat_session";
const TRANSCRIPT_KEY = "ren_chat_messages";
const MAX_STORED_MESSAGES = 80;

let sessionId = null;
let open = false;
let sending = false;
let sseSource = null;

// ─── Persistencia ─────────────────────────────────────────────────────────────
function saveSession(id) {
  try {
    localStorage.setItem(SESSION_KEY, id);
    sessionStorage.removeItem(SESSION_KEY);
  } catch { }
}
function saveClient(id) { try { if (id) localStorage.setItem(CLIENT_KEY, id); } catch { } }
function loadClient() { try { return localStorage.getItem(CLIENT_KEY); } catch { return null; } }
function loadSession() {
  try {
    const saved = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
    if (saved) saveSession(saved);
    return saved;
  } catch { return null; }
}
function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(TRANSCRIPT_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch { }
}
function loadTranscript() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRANSCRIPT_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function saveTranscriptMessage(message) {
  try {
    const messages = loadTranscript();
    if (message.id && messages.some(item => String(item.id) === String(message.id))) return;
    messages.push(message);
    localStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
  } catch { }
}

// ─── Catálogo (caché liviano para match de productos) ─────────────────────────
async function getProductCatalog() {
  if (productCache) return productCache;
  const [combosRes, productosRes] = await Promise.all([
    fetch(`${CHAT_API}/food-combos`).then(r => r.json()).catch(() => []),
    fetch(`${CHAT_API}/productos`).then(r => r.json()).catch(() => [])
  ]);
  productCache = [
    ...(Array.isArray(combosRes) ? combosRes : []).map(c => ({ ...c, source: "combo", category: "combo", imagen: c.img ?? c.imagen })),
    ...(Array.isArray(productosRes) ? productosRes : []).map(p => ({ ...p, source: "producto", category: "producto", imagen: p.img ?? p.imagen }))
  ];
  return productCache;
}

async function addCartItems(items) {
  const catalog = await getProductCatalog();
  for (const item of items) {
    const found = catalog.find(p =>
      p.nombre?.toLowerCase().includes(item.nombre?.toLowerCase()) ||
      item.nombre?.toLowerCase().includes(p.nombre?.toLowerCase())
    );
    if (found) {
      addItem(found, item.cantidad ?? 1);
    }
  }
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function apiStartSession() {
  const clientId = loadClient();
  const savedSessionId = loadSession();
  const res = await fetch(`${CHAT_API}/chat/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, sessionId: savedSessionId })
  });
  if (!res.ok) throw new Error("No se pudo crear sesión");
  return res.json();
}

async function apiSendMessage(text) {
  const res = await fetch(`${CHAT_API}/chat/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message: text })
  });
  if (!res.ok) {
    // Sesión expirada — limpiar para que la próxima vez cree una nueva
    clearSession();
    sessionId = null;
    throw new Error("Sesión inválida");
  }
  return res.json();
}

// ─── SSE (solo para respuestas del admin en handoff) ─────────────────────────
let sseSessionId = null;

function connectSSE() {
  if (!sessionId) return;
  if (sseSource && sseSessionId === sessionId) return;
  sseSource?.close();
  // El backend solo reenvía a este canal los eventos de esta sesión de chat
  sseSessionId = sessionId;
  sseSource = new EventSource(`${CHAT_API}/notifications/subscribe?chatSessionId=${encodeURIComponent(sessionId)}`);
  sseSource.addEventListener("message", e => {
    try {
      const n = JSON.parse(e.data);
      if (n.type === "chat_admin_reply" && n.data?.sessionId === sessionId) {
        setTyping(false);
        appendMessage("assistant", n.data.chatMessage?.content || n.data.message, n.data.chatMessage?.id);
      }
    } catch { }
  });
  const source = sseSource;
  source.addEventListener("error", () => {
    source.close();
    if (sseSource !== source) return;
    sseSource = null;
    setTimeout(connectSSE, 10000);
  });
}

// ─── Abrir / cerrar chat ──────────────────────────────────────────────────────
function openChat() {
  open = true;
  document.body.classList.add("ren-chat-open");
  document.getElementById("ren-chat-box").classList.add("open");
  clearBadge();
  if (!sessionId) initSession();
  else document.getElementById("ren-chat-input")?.focus();
}

function closeChat() {
  open = false;
  document.body.classList.remove("ren-chat-open");
  document.getElementById("ren-chat-box").classList.remove("open");
}

function toggleChat() {
  if (open) closeChat(); else openChat();
}

// ─── Iniciar sesión y mostrar saludo ─────────────────────────────────────────
async function initSession() {
  setTyping(true);
  try {
    const localSession = loadSession();
    const sessionData = await apiStartSession();
    sessionId = sessionData.sessionId || localSession;
    saveClient(sessionData.clientId);
    saveSession(sessionId);
    if (Array.isArray(sessionData.messages) && sessionData.messages.length) {
      clearMessages();
      sessionData.messages.forEach(msg => appendMessage(msg.role, msg.content, msg.id, false));
    }
    connectSSE();
    setTyping(false);
    if (document.querySelectorAll(".ren-msg").length === 0) {
      const transcript = loadTranscript();
      if (transcript.length) {
        transcript.forEach(msg => appendMessage(msg.role, msg.text, msg.id, false));
      } else {
        appendMessage("assistant", "¡Hola! ¿En qué te puedo ayudar hoy? 😊");
        appendMessage("assistant", "Puedo contarte sobre nuestros combos, cómo funciona el envío, los métodos de pago o cualquier duda que tengas.");
      }
    }
  } catch {
    setTyping(false);
    appendMessage("assistant", "No pudimos conectar. Verifica tu conexión e intenta de nuevo.");
  }
  document.getElementById("ren-chat-input")?.focus();
}

// ─── Enviar mensaje ───────────────────────────────────────────────────────────
async function handleSend() {
  const input = document.getElementById("ren-chat-input");
  const text = input?.value?.trim();
  if (!text || sending || !sessionId) return;

  sending = true;
  input.value = "";
  input.style.height = "auto";
  document.getElementById("ren-chat-send").disabled = true;

  appendMessage("user", text);
  setTyping(true);

  try {
    const data = await apiSendMessage(text);
    setTyping(false);
    if (data.assistantMessage?.content) appendMessage("assistant", data.assistantMessage.content, data.assistantMessage.id);
    else if (data.reply) appendMessage("assistant", data.reply);
    if (data.cartItems?.length) {
      await addCartItems(data.cartItems);
      // Cerrar el chat y abrir el carrito para que el cliente continúe
      setTimeout(closeChat, 1000);
      setTimeout(() => document.getElementById("cart-btn")?.click(), 2000);
    }
  } catch {
    setTyping(false);
    appendMessage("assistant", "No pude procesar tu mensaje. Intenta de nuevo.");
  } finally {
    sending = false;
    document.getElementById("ren-chat-send").disabled = false;
    input?.focus();
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function appendMessage(role, text, id = null, persist = true) {
  if (!text) return;
  const container = document.getElementById("ren-chat-messages");
  const typing = document.getElementById("ren-typing");
  if (id && Array.from(container.querySelectorAll(".ren-msg")).some(msg => msg.dataset.messageId === String(id))) return;
  const div = document.createElement("div");
  div.className = `ren-msg ren-msg-${role === "user" ? "user" : "assistant"}`;
  if (id) div.dataset.messageId = String(id);
  div.textContent = text;
  container.insertBefore(div, typing);
  if (persist) saveTranscriptMessage({ id, role, text, at: new Date().toISOString() });
  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
  if (role === "assistant" && !open) showBadge();
}

function setTyping(visible) {
  const el = document.getElementById("ren-typing");
  if (el) el.style.display = visible ? "block" : "none";
  const c = document.getElementById("ren-chat-messages");
  if (c) setTimeout(() => { c.scrollTop = c.scrollHeight; }, 50);
}

function clearMessages() {
  const container = document.getElementById("ren-chat-messages");
  if (!container) return;
  container.querySelectorAll(".ren-msg").forEach(msg => msg.remove());
}

function clearBadge() {
  const b = document.getElementById("ren-chat-badge");
  if (b) { b.style.display = "none"; b.textContent = ""; }
  const fb = document.getElementById("ren-fab-badge");
  if (fb) { fb.style.display = "none"; fb.textContent = ""; }
}

function showBadge() {
  if (open) return;
  const b = document.getElementById("ren-chat-badge");
  if (b) { b.style.display = "flex"; b.textContent = "1"; }
  const fb = document.getElementById("ren-fab-badge");
  if (fb) { fb.style.display = "flex"; fb.textContent = "1"; }
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 90) + "px";
}

// ─── Render del widget ────────────────────────────────────────────────────────
function createWidget() {
  const style = document.createElement("style");
  style.textContent = `
    #ren-chat-box {
      position: fixed; top: 68px; right: 16px; z-index: 9999;
      width: 340px; max-width: calc(100vw - 32px);
      background: #fff; border-radius: 16px;
      box-shadow: 0 8px 32px rgba(13,71,161,.18);
      display: none; flex-direction: column; overflow: hidden;
      font-family: 'Source Sans 3', 'Segoe UI', sans-serif;
    }
    #ren-chat-box.open { display: flex; }

    .ren-chat-header {
      background: var(--navy, #0D47A1); color: #fff;
      padding: 14px 16px; display: flex; align-items: center; gap: 10px;
    }
    .ren-chat-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(255,255,255,.2);
      display: flex; align-items: center; justify-content: center; font-size: 18px;
    }
    .ren-chat-header-info { flex: 1; }
    .ren-chat-header-name { font-weight: 700; font-size: 14px; }
    .ren-chat-header-status { font-size: 11px; opacity: .8; }
    .ren-chat-close {
      background: none; border: none; color: #fff;
      font-size: 20px; cursor: pointer; padding: 4px; line-height: 1;
    }

    .ren-chat-invite {
      position: relative; margin: 10px 12px 0; padding: 12px 38px 12px 12px;
      border: 1px solid #c7ead5; border-radius: 12px;
      background: #f1fbf4; color: #123b2a; font-size: 12px; line-height: 1.45;
    }
    .ren-chat-invite[hidden] { display: none; }
    .ren-chat-invite strong { display: block; margin-bottom: 3px; font-size: 13px; }
    .ren-chat-invite p { margin: 0 0 7px; }
    .ren-chat-invite a { color: #12532d; font-weight: 800; text-decoration: underline; }
    .ren-chat-invite button { position: absolute; top: 5px; right: 5px; width: 32px; height: 32px; border: 0; border-radius: 50%; background: transparent; color: #12532d; font-size: 18px; cursor: pointer; }

    .ren-chat-messages {
      flex: 1; overflow-y: auto; padding: 14px 12px;
      display: flex; flex-direction: column; gap: 8px;
      max-height: 340px; min-height: 200px; background: #f8fafc;
    }
    .ren-msg {
      max-width: 82%; padding: 9px 12px; border-radius: 12px;
      font-size: 13px; line-height: 1.5; word-break: break-word;
    }
    .ren-msg-user {
      align-self: flex-end; background: var(--navy, #0D47A1);
      color: #fff; border-bottom-right-radius: 4px;
    }
    .ren-msg-assistant {
      align-self: flex-start; background: #fff; color: #1e293b;
      border: 1px solid #e2e8f0; border-bottom-left-radius: 4px;
    }

    .ren-typing {
      align-self: flex-start; background: #fff; border: 1px solid #e2e8f0;
      border-radius: 12px; border-bottom-left-radius: 4px;
      padding: 10px 14px; display: none;
    }
    .ren-typing span {
      display: inline-block; width: 7px; height: 7px;
      background: #94a3b8; border-radius: 50%; margin: 0 2px;
      animation: ren-bounce .9s infinite;
    }
    .ren-typing span:nth-child(2) { animation-delay: .15s; }
    .ren-typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes ren-bounce {
      0%,60%,100% { transform: translateY(0); }
      30% { transform: translateY(-5px); }
    }

    .ren-chat-footer {
      padding: 10px 12px; background: #fff;
      border-top: 1px solid #e2e8f0;
      display: flex; gap: 8px; align-items: flex-end;
    }
    .ren-chat-input {
      flex: 1; border: 1px solid #e2e8f0; border-radius: 10px;
      padding: 9px 12px; font-size: 13px; resize: none; outline: none;
      font-family: inherit; max-height: 90px; line-height: 1.4;
      color: #1e293b; background: #f8fafc;
    }
    .ren-chat-input:focus { border-color: var(--navy, #0D47A1); background: #fff; }
    .ren-chat-send {
      width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
      background: var(--navy, #0D47A1); color: #fff;
      border: none; cursor: pointer; font-size: 16px;
      display: flex; align-items: center; justify-content: center;
      transition: opacity .2s;
    }
    .ren-chat-send:disabled { opacity: .45; cursor: default; }

    @media (max-width: 480px) {
      #ren-chat-box { right: 8px; left: 8px; width: auto; top: 64px; }
    }

    /* ── Botón flotante de chat ── */
    #ren-chat-fab {
      display: flex;
      align-items: center;
      justify-content: center;
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9998;
      width: 62px;
      height: 62px;
      border-radius: 50%;
      background: #22c55e;
      color: #fff;
      border: none;
      cursor: pointer;
      font-size: 28px;
      box-shadow: 0 4px 20px rgba(34,197,94,.45);
      transition: background .3s ease, box-shadow .3s ease, transform .15s ease;
      animation: ren-fab-pulse 2.6s ease-in-out infinite;
    }
    #ren-chat-fab.fab-scrolled {
      background: #0D47A1;
      box-shadow: 0 4px 20px rgba(13,71,161,.40);
      animation: ren-fab-pulse-blue 2.6s ease-in-out infinite;
    }
    body.modal-open #ren-chat-fab {
      display: none !important;
    }
    #ren-chat-fab .ren-fab-badge {
      position: absolute;
      top: -2px;
      right: -2px;
      background: #ef4444;
      color: #fff;
      border-radius: 50%;
      width: 18px;
      height: 18px;
      font-size: 10px;
      font-weight: 700;
      display: none;
      align-items: center;
      justify-content: center;
    }
    @keyframes ren-fab-pulse {
      0%, 100% { box-shadow: 0 4px 20px rgba(34,197,94,.45); }
      50%       { box-shadow: 0 6px 30px rgba(34,197,94,.70); }
    }
    @keyframes ren-fab-pulse-blue {
      0%, 100% { box-shadow: 0 4px 20px rgba(13,71,161,.40); }
      50%       { box-shadow: 0 6px 30px rgba(13,71,161,.65); }
    }
    @media (max-width: 900px) {
      #ren-chat-fab {
        bottom: calc(80px + env(safe-area-inset-bottom));
        right: 20px;
      }
    }
  `;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "ren-chat-box";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Asistente de compra");
  box.innerHTML = `
    <div class="ren-chat-header">
      <div class="ren-chat-avatar">💬</div>
      <div class="ren-chat-header-info">
        <div class="ren-chat-header-name">Asistente de compra</div>
        <div class="ren-chat-header-status">En línea</div>
      </div>
      <button class="ren-chat-close" id="ren-chat-close" aria-label="Cerrar">×</button>
    </div>
    <div class="ren-chat-invite" id="ren-chat-invite">
      <button type="button" id="ren-chat-invite-close" aria-label="Cerrar invitación al grupo">×</button>
      <strong>Únete a nuestro grupo de WhatsApp</strong>
      <p>Recibe ofertas, nuevos combos y seguimiento de pedidos directamente por WhatsApp.</p>
      <a href="https://chat.whatsapp.com/LNjqfO8oiToLM5N1e2Ox51?mode=gi_t" target="_blank" rel="noopener noreferrer">Unirme al grupo</a>
    </div>
    <div class="ren-chat-messages" id="ren-chat-messages">
      <div class="ren-typing" id="ren-typing">
        <span></span><span></span><span></span>
      </div>
    </div>
    <div class="ren-chat-footer">
      <textarea class="ren-chat-input" id="ren-chat-input"
        placeholder="Escribe tu pregunta..." rows="1" maxlength="500"></textarea>
      <button class="ren-chat-send" id="ren-chat-send" aria-label="Enviar" disabled>➤</button>
    </div>
  `;
  document.body.appendChild(box);

  // FAB mobile
  const fab = document.createElement("button");
  fab.id = "ren-chat-fab";
  fab.setAttribute("aria-label", "Abrir chat de asistencia");
  fab.innerHTML = `<i class="fa-regular fa-comment-dots"></i><span class="ren-fab-badge" id="ren-fab-badge"></span>`;
  document.body.appendChild(fab);
  fab.addEventListener("click", toggleChat);

  // Cambio de color al salir del hero
  const heroEl = document.getElementById("inicio");
  function updateFabColor() {
    if (!heroEl) return;
    const heroBottom = heroEl.getBoundingClientRect().bottom;
    fab.classList.toggle("fab-scrolled", heroBottom <= 0);
  }
  window.addEventListener("scroll", updateFabColor, { passive: true });
  updateFabColor();
  document.getElementById("ren-chat-close").addEventListener("click", closeChat);
  document.getElementById("ren-chat-invite-close").addEventListener("click", () => {
    document.getElementById("ren-chat-invite").hidden = true;
  });
  document.getElementById("ren-chat-send").addEventListener("click", handleSend);
  document.getElementById("ren-chat-input").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
  document.getElementById("ren-chat-input").addEventListener("input", e => {
    document.getElementById("ren-chat-send").disabled = !e.target.value.trim() || sending;
    autoResize(e.target);
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", createWidget);
} else {
  createWidget();
}

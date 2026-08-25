import { addItem } from "./cart.js?v14";

const CHAT_API = "https://readyexpressnowbackend.versabold.com/api";
let productCache = null;
const PROACTIVE_DELAY = 10000;
const SESSION_KEY = "ren_chat_session";
const PROACTIVE_KEY = "ren_chat_proactive_shown";

let sessionId = null;
let open = false;
let sending = false;
let sseSource = null;

// ─── Persistencia ─────────────────────────────────────────────────────────────
function saveSession(id) { try { sessionStorage.setItem(SESSION_KEY, id); } catch { } }
function loadSession() { try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; } }
function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch { } }
function proactiveAlreadyShown() { try { return !!localStorage.getItem(PROACTIVE_KEY); } catch { return false; } }
function markProactiveShown() { try { localStorage.setItem(PROACTIVE_KEY, "1"); } catch { } }

// ─── Catálogo (caché liviano para match de productos) ─────────────────────────
async function getProductCatalog() {
  if (productCache) return productCache;
  const [combosRes, productosRes] = await Promise.all([
    fetch(`${CHAT_API}/food-combos`).then(r => r.json()).catch(() => []),
    fetch(`${CHAT_API}/productos`).then(r => r.json()).catch(() => [])
  ]);
  productCache = [
    ...(Array.isArray(combosRes) ? combosRes : []).map(c => ({ ...c, category: "combo", imagen: c.img ?? c.imagen })),
    ...(Array.isArray(productosRes) ? productosRes : []).map(p => ({ ...p, category: "producto", imagen: p.img ?? p.imagen }))
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
  const res = await fetch(`${CHAT_API}/chat/session`, { method: "POST" });
  if (!res.ok) throw new Error("No se pudo crear sesión");
  const data = await res.json();
  return data.sessionId;
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
function connectSSE() {
  if (sseSource) return;
  sseSource = new EventSource(`${CHAT_API}/notifications/subscribe`);
  sseSource.addEventListener("message", e => {
    try {
      const n = JSON.parse(e.data);
      if (n.type === "chat_admin_reply" && n.data?.sessionId === sessionId) {
        setTyping(false);
        appendMessage("assistant", n.data.message);
      }
    } catch { }
  });
  sseSource.addEventListener("error", () => {
    sseSource.close();
    sseSource = null;
    setTimeout(connectSSE, 10000);
  });
}

// ─── Burbuja proactiva ────────────────────────────────────────────────────────
function showProactiveBubble() {
  if (proactiveAlreadyShown() || open) return;

  const bubble = document.createElement("div");
  bubble.id = "ren-proactive-bubble";
  bubble.innerHTML = `
    <button class="ren-bubble-close" id="ren-bubble-close" aria-label="Cerrar">×</button>
    <p class="ren-bubble-text">Llevamos años enviando a Guantánamo 🇨🇺<br>¿Le mandas algo a tu familia hoy?</p>
    <button class="ren-bubble-cta" id="ren-bubble-cta">Sí, quiero enviar algo</button>
    <label class="ren-bubble-nag">
      <input type="checkbox" id="ren-bubble-noshown"> No volver a mostrar
    </label>
  `;
  document.body.appendChild(bubble);
  requestAnimationFrame(() => bubble.classList.add("visible"));

  document.getElementById("ren-bubble-cta").addEventListener("click", () => {
    markProactiveShown();
    removeBubble();
    openChat();
  });
  document.getElementById("ren-bubble-close").addEventListener("click", () => {
    if (document.getElementById("ren-bubble-noshown")?.checked) markProactiveShown();
    removeBubble();
  });
}

function removeBubble() {
  const b = document.getElementById("ren-proactive-bubble");
  if (!b) return;
  b.classList.remove("visible");
  setTimeout(() => b.remove(), 300);
}

// ─── Abrir / cerrar chat ──────────────────────────────────────────────────────
function openChat() {
  open = true;
  document.getElementById("ren-chat-box").classList.add("open");
  document.getElementById("ren-chat-nav-btn")?.setAttribute("aria-expanded", "true");
  removeBubble();
  clearBadge();
  if (!sessionId) initSession();
  else document.getElementById("ren-chat-input")?.focus();
}

function closeChat() {
  open = false;
  document.getElementById("ren-chat-box").classList.remove("open");
  document.getElementById("ren-chat-nav-btn")?.setAttribute("aria-expanded", "false");
}

function toggleChat() {
  if (open) closeChat(); else openChat();
}

// ─── Iniciar sesión y mostrar saludo ─────────────────────────────────────────
async function initSession() {
  setTyping(true);
  try {
    const saved = loadSession();
    if (saved) {
      sessionId = saved;
    } else {
      sessionId = await apiStartSession();
      saveSession(sessionId);
      connectSSE();
    }
    setTyping(false);
    if (document.querySelectorAll(".ren-msg").length === 0) {
      appendMessage("assistant", "¡Hola! ¿En qué te puedo ayudar hoy? 😊");
      appendMessage("assistant", "Puedo contarte sobre nuestros combos, cómo funciona el envío, los métodos de pago o cualquier duda que tengas.");
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
    if (data.reply) appendMessage("assistant", data.reply);
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
function appendMessage(role, text) {
  const container = document.getElementById("ren-chat-messages");
  const typing = document.getElementById("ren-typing");
  const div = document.createElement("div");
  div.className = `ren-msg ren-msg-${role === "user" ? "user" : "assistant"}`;
  div.textContent = text;
  container.insertBefore(div, typing);
  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
  if (role === "assistant" && !open) showBadge();
}

function setTyping(visible) {
  const el = document.getElementById("ren-typing");
  if (el) el.style.display = visible ? "block" : "none";
  const c = document.getElementById("ren-chat-messages");
  if (c) setTimeout(() => { c.scrollTop = c.scrollHeight; }, 50);
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
    .navbar-chat-btn {
      position: relative;
      background: #e0f2fe; border: none; border-radius: 50%;
      width: 40px; height: 40px; cursor: pointer; color: #0D47A1;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; transition: background .2s, transform .2s;
    }
    .navbar-chat-btn:hover { background: #bae6fd; transform: scale(1.08); }
    .ren-chat-badge {
      position: absolute; top: -3px; right: -3px;
      background: #ef4444; color: #fff; border-radius: 50%;
      width: 16px; height: 16px; font-size: 9px; font-weight: 700;
      display: none; align-items: center; justify-content: center;
    }

    #ren-proactive-bubble {
      position: fixed; top: 70px; right: 16px; z-index: 9997;
      width: 260px; background: #fff; border-radius: 14px;
      box-shadow: 0 6px 24px rgba(13,71,161,.18);
      padding: 14px 14px 12px; font-family: 'Source Sans 3','Segoe UI',sans-serif;
      opacity: 0; transform: translateY(10px) scale(.97);
      transition: opacity .3s ease, transform .3s ease; pointer-events: none;
    }
    #ren-proactive-bubble.visible { opacity: 1; transform: none; pointer-events: auto; }
    .ren-bubble-close {
      position: absolute; top: 8px; right: 10px;
      background: none; border: none; color: #94a3b8;
      font-size: 18px; cursor: pointer; line-height: 1; padding: 0;
    }
    .ren-bubble-text { font-size: 13px; color: #1e293b; margin: 0 0 10px; line-height: 1.5; padding-right: 16px; }
    .ren-bubble-cta {
      width: 100%; padding: 9px; border-radius: 8px; border: none; cursor: pointer;
      background: var(--navy, #0D47A1); color: #fff;
      font-size: 13px; font-weight: 700; font-family: inherit; transition: opacity .2s;
    }
    .ren-bubble-cta:hover { opacity: .88; }
    .ren-bubble-nag {
      display: flex; align-items: center; gap: 6px; margin-top: 8px;
      font-size: 11px; color: #94a3b8; cursor: pointer; user-select: none;
    }
    .ren-bubble-nag input { cursor: pointer; accent-color: var(--navy, #0D47A1); }

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
      #ren-proactive-bubble { right: 8px; width: calc(100vw - 16px); top: 64px; }
    }

    /* ── Botón flotante de chat (solo mobile) ── */
    #ren-chat-fab {
      display: none;
    }
    @media (max-width: 768px) {
      #ren-chat-fab {
        display: flex;
        align-items: center;
        justify-content: center;
        position: fixed;
        bottom: 80px;
        right: 20px;
        z-index: 9998;
        width: 58px;
        height: 58px;
        border-radius: 50%;
        background: #0D47A1;
        color: #fff;
        border: none;
        cursor: pointer;
        font-size: 26px;
        box-shadow: 0 4px 18px rgba(13,71,161,.38);
        animation: ren-fab-pulse 2.8s ease-in-out infinite;
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
        0%, 100% { box-shadow: 0 4px 18px rgba(13,71,161,.38); transform: scale(1); }
        50%       { box-shadow: 0 4px 28px rgba(13,71,161,.60); transform: scale(1.07); }
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

  document.getElementById("ren-chat-nav-btn")?.addEventListener("click", toggleChat);
  document.getElementById("ren-chat-close").addEventListener("click", closeChat);
  document.getElementById("ren-chat-send").addEventListener("click", handleSend);
  document.getElementById("ren-chat-input").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
  document.getElementById("ren-chat-input").addEventListener("input", e => {
    document.getElementById("ren-chat-send").disabled = !e.target.value.trim() || sending;
    autoResize(e.target);
  });

  if (!proactiveAlreadyShown()) {
    setTimeout(showProactiveBubble, PROACTIVE_DELAY);
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
  try { localStorage.removeItem(PROACTIVE_KEY); } catch { }
  try { sessionStorage.removeItem(SESSION_KEY); } catch { }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", createWidget);
} else {
  createWidget();
}

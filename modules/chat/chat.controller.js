import {
  createSession,
  getSession,
  getAllSessions,
  getSessionMessages,
  saveMessage,
  setSessionStatus,
  deleteSession,
  processMessage,
  notifyChatStarted
} from "./chat.service.js";
import { NotificationManager } from "../notifications/notifications.service.js";
import { sendError } from "../../utils/http-error.js";

// POST /api/chat/session — cliente inicia una nueva sesión
export async function startSessionController(req, res) {
  try {
    const session = await createSession();
    notifyChatStarted(session.id).catch(err =>
      console.error("[chat] Error enviando SMS de alerta:", err.message)
    );
    NotificationManager.sendNotification("chat_session_started", {
      sessionId: session.id,
      message: "Nuevo cliente en el chat"
    });
    res.json({ sessionId: session.id });
  } catch (err) {
    sendError(res, err);
  }
}

// POST /api/chat/message — cliente envía un mensaje
export async function clientMessageController(req, res) {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message?.trim()) {
      return res.status(400).json({ error: "sessionId y message son requeridos" });
    }

    const result = await processMessage(sessionId, message.trim());

    // Si está en handoff, notificar al admin vía SSE
    if (result.handoff) {
      NotificationManager.sendNotification("chat_message_pending", {
        sessionId,
        lastMessage: message.trim(),
        message: `Mensaje pendiente de atención humana en sesión ${sessionId}`
      });
    }

    res.json({ reply: result.reply, handoff: result.handoff, cartItems: result.cartItems ?? null });
  } catch (err) {
    sendError(res, err);
  }
}

// GET /api/chat/sessions — admin lista todas las sesiones
export async function listSessionsController(req, res) {
  try {
    const sessions = await getAllSessions();
    res.json({ sessions });
  } catch (err) {
    sendError(res, err);
  }
}

// GET /api/chat/sessions/:id/messages — admin lee el historial de una sesión
export async function getMessagesController(req, res) {
  try {
    const { id } = req.params;
    const [session, messages] = await Promise.all([
      getSession(id),
      getSessionMessages(id)
    ]);
    res.json({ session, messages });
  } catch (err) {
    sendError(res, err);
  }
}

// POST /api/chat/sessions/:id/reply — admin responde manualmente
export async function adminReplyController(req, res) {
  try {
    const { id } = req.params;
    const { message } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ error: "message es requerido" });
    }

    const msg = await saveMessage(id, "admin", message.trim());

    // Notificar al cliente vía SSE (el frontend del cliente escucha)
    NotificationManager.sendNotification("chat_admin_reply", {
      sessionId: id,
      message: message.trim()
    });

    res.json({ message: msg });
  } catch (err) {
    sendError(res, err);
  }
}

// PATCH /api/chat/sessions/:id/takeover — admin toma el control
export async function takeoverController(req, res) {
  try {
    const { id } = req.params;
    await setSessionStatus(id, "handoff");
    NotificationManager.sendNotification("chat_takeover", {
      sessionId: id,
      message: "Admin tomó control del chat"
    });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
}

// PATCH /api/chat/sessions/:id/resolve — admin marca como resuelta
export async function resolveSessionController(req, res) {
  try {
    const { id } = req.params;
    await setSessionStatus(id, "resolved");
    NotificationManager.sendNotification("chat_resolved", {
      sessionId: id,
      message: "Sesión de chat resuelta"
    });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
}

// PATCH /api/chat/sessions/:id/release — admin devuelve control a la IA
export async function releaseController(req, res) {
  try {
    const { id } = req.params;
    await setSessionStatus(id, "ai");
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
}

// DELETE /api/chat/sessions/:id — elimina sesión y mensajes de Supabase
export async function deleteSessionController(req, res) {
  try {
    const { id } = req.params;
    await deleteSession(id);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
}

import {
  getSession,
  getAllSessions,
  getSessionMessages,
  saveMessage,
  setSessionStatus,
  deleteSession,
  processMessage,
  startOrResumeSession,
  toChatMessagePayload
} from "./chat.service.js";
import { NotificationManager } from "../notifications/notifications.service.js";
import { sendError } from "../../utils/http-error.js";

// POST /api/chat/session — cliente inicia una nueva sesión
export async function startSessionController(req, res) {
  try {
    const { clientId, sessionId } = req.body || {};
    const { client, session, messages, reused } = await startOrResumeSession(clientId, sessionId);
    if (!reused) {
      NotificationManager.sendNotification("chat_session_started", {
        sessionId: session.id,
        clientId: client.id,
        message: "Nuevo cliente en el chat"
      });
    }
    res.json({ clientId: client.id, sessionId: session.id, messages, reused });
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
    const userMessage = toChatMessagePayload(result.userMessage);

    NotificationManager.sendNotification("chat_client_message", {
      sessionId,
      lastMessage: message.trim(),
      chatMessage: userMessage,
      message: `Nuevo mensaje de cliente en sesión ${sessionId}`
    });

    // Si está en handoff, notificar al admin vía SSE
    if (result.handoff) {
      NotificationManager.sendNotification("chat_message_pending", {
        sessionId,
        lastMessage: message.trim(),
        chatMessage: userMessage,
        message: `Mensaje pendiente de atención humana en sesión ${sessionId}`
      });
    }

    res.json({
      reply: result.reply,
      handoff: result.handoff,
      cartItems: result.cartItems ?? null,
      userMessage,
      assistantMessage: toChatMessagePayload(result.assistantMessage)
    });
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
      message: message.trim(),
      chatMessage: toChatMessagePayload(msg)
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
    // Notificar al admin (APK)
    NotificationManager.sendNotification("chat_takeover", {
      sessionId: id,
      message: "Admin tomó control del chat"
    });
    // Notificar al cliente vía SSE para que el frontend muestre el cambio
    NotificationManager.sendNotification("chat_agent_joined", {
      sessionId: id,
      agentMessage: "Un agente se unió a la conversación y te atenderá en breve."
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
    // Informar al cliente que el bot retoma
    NotificationManager.sendNotification("chat_bot_resumed", {
      sessionId: id,
      agentMessage: "El asistente virtual retoma la conversación. Escríbeme cuando quieras 🛒"
    });
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

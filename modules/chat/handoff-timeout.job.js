import {
  getAbandonedHandoffSessions,
  setSessionStatus,
  saveMessage
} from "./chat.service.js";
import { NotificationManager } from "../notifications/notifications.service.js";

const TIMEOUT_MINUTES = 8;
const CHECK_INTERVAL_MS = 2 * 60 * 1000; // revisar cada 2 minutos

const TIMEOUT_BOT_MESSAGE =
  "Nuestro equipo no pudo atenderte en este momento. Retomo yo para ayudarte mientras — si prefieres, déjame tu número o correo y Ernesto te contactará.";

async function checkAbandonedHandoffs() {
  try {
    const sessions = await getAbandonedHandoffSessions(TIMEOUT_MINUTES);
    for (const session of sessions) {
      await setSessionStatus(session.id, "ai");
      await saveMessage(session.id, "assistant", TIMEOUT_BOT_MESSAGE);
      NotificationManager.sendNotification("chat_handoff_timeout", {
        sessionId: session.id,
        message: `Sesión ${session.id} devuelta al bot por inactividad del admin`
      });
      console.info(`[handoff-timeout] Sesión ${session.id} devuelta al bot`);
    }
  } catch (err) {
    console.error("[handoff-timeout] Error en revisión de handoffs:", err.message);
  }
}

export function startHandoffTimeoutJob() {
  setInterval(checkAbandonedHandoffs, CHECK_INTERVAL_MS);
  console.info(`[handoff-timeout] Job activo — timeout ${TIMEOUT_MINUTES} min`);
}

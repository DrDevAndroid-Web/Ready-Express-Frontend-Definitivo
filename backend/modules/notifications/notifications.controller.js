import { NotificationManager } from "./notifications.service.js";
import { registerAdminPushToken } from "./push.service.js";
import { sendError } from "../../utils/http-error.js";

let clientCounter = 0;
let locationClientCounter = 0;

export function subscribeToNotifications(req, res) {
  const clientId = `client-${++clientCounter}-${Date.now()}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  NotificationManager.addClient(clientId, res);

  res.write(`data: ${JSON.stringify({
    type: "connection_established",
    clientId,
    timestamp: new Date().toISOString(),
    message: "Conectado al sistema de notificaciones"
  })}\n\n`);

  // Heartbeat como evento SSE real (no comentario) para que proxies y React Native lo procesen
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${Date.now()}\n\n`);
    } catch {
      cleanup();
    }
  }, 20000);

  function cleanup() {
    clearInterval(heartbeatInterval);
    NotificationManager.removeClient(clientId);
  }

  req.on("close", cleanup);
  req.on("error", (err) => {
    console.error(`[SSE] Error en cliente ${clientId}:`, err.message);
    cleanup();
  });
}

export function getConnectionStats(req, res) {
  res.json({
    connectedClients: NotificationManager.getConnectedCount(),
    timestamp: new Date().toISOString()
  });
}

export function subscribeToLocationChanges(req, res) {
  const clientId = `location-${++locationClientCounter}-${Date.now()}`;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  NotificationManager.addLocationClient(clientId, res);
  res.write(`data: ${JSON.stringify({ type: "location_connection_established", timestamp: new Date().toISOString() })}\n\n`);

  const heartbeat = setInterval(() => {
    try { res.write(`event: ping\ndata: ${Date.now()}\n\n`); } catch { cleanup(); }
  }, 20000);
  function cleanup() {
    clearInterval(heartbeat);
    NotificationManager.removeLocationClient(clientId);
  }
  req.on("close", cleanup);
  req.on("error", cleanup);
}

export function testNotification(req, res) {
  const sent = NotificationManager.sendNotification("test", {
    message: "Notificacion de prueba desde backend",
    user: req.user?.email || req.user?.id || "unknown"
  });

  res.json({
    ok: true,
    sent,
    connectedClients: NotificationManager.getConnectedCount(),
    timestamp: new Date().toISOString()
  });
}

export async function registerPushToken(req, res) {
  try {
    const token = await registerAdminPushToken({
      token: req.body?.token,
      platform: req.body?.platform,
      deviceName: req.body?.deviceName,
      user: req.user
    });

    res.json({
      ok: true,
      token
    });
  } catch (err) {
    sendError(res, err);
  }
}

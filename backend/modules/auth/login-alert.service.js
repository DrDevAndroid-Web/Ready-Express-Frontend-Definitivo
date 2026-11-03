import { createHash } from "node:crypto";
import { Resend } from "resend";
import { supabase } from "../../config/supabase.js";
import { isMuted } from "../../utils/mute.js";

const TABLE = "customer_known_devices";

// Repositorio y envío de email inyectables: los tests no tocan Supabase ni Resend
const defaultDeps = {
  async findDevices(userId) {
    const { data, error } = await supabase.from(TABLE).select("device_hash").eq("user_id", userId);
    if (error) throw error;
    return data || [];
  },
  async touchDevice(userId, deviceHash, { userAgent, ip }) {
    const { error } = await supabase.from(TABLE).update({ last_seen_at: new Date().toISOString(), user_agent: userAgent, ip }).eq("user_id", userId).eq("device_hash", deviceHash);
    if (error) throw error;
  },
  // false si otra petición simultánea ya lo registró: así solo sale un email
  async insertDevice(userId, deviceHash, { userAgent, ip }) {
    const { data, error } = await supabase.from(TABLE)
      .upsert({ user_id: userId, device_hash: deviceHash, user_agent: userAgent, ip }, { onConflict: "user_id,device_hash", ignoreDuplicates: true })
      .select("device_hash");
    if (error) throw error;
    return Boolean(data?.length);
  },
  sendEmail: sendWithResend
};

export function deviceHash(userId, deviceId, userAgent) {
  // El id del navegador (localStorage) distingue dos equipos con el mismo navegador;
  // sin él (APK, dashboard) se usa el user agent
  const source = String(deviceId || "").trim().slice(0, 100) || `ua:${userAgent || "desconocido"}`;
  return createHash("sha256").update(`${userId}:${source}`).digest("hex");
}

// Navegador y sistema operativo legibles a partir del user agent (sin dependencias)
export function describeUserAgent(userAgent = "") {
  const ua = String(userAgent);
  const browser =
    /Edg(e|A|iOS)?\//.test(ua) ? "Microsoft Edge"
      : /OPR\/|Opera/.test(ua) ? "Opera"
        : /SamsungBrowser\//.test(ua) ? "Samsung Internet"
          : /Firefox\/|FxiOS\//.test(ua) ? "Firefox"
            : /Chrome\/|CriOS\//.test(ua) ? "Chrome"
              : /Safari\//.test(ua) && /Version\//.test(ua) ? "Safari"
                : /okhttp|Dalvik/i.test(ua) ? "App Android"
                  : null;
  const os =
    /iPhone/.test(ua) ? "iPhone"
      : /iPad/.test(ua) ? "iPad"
        : /Android/.test(ua) ? "Android"
          : /Windows NT/.test(ua) ? "Windows"
            : /Mac OS X|Macintosh/.test(ua) ? "macOS"
              : /CrOS/.test(ua) ? "ChromeOS"
                : /Linux/.test(ua) ? "Linux"
                  : null;
  if (browser && os) return `${browser} en ${os}`;
  return browser || os || "Dispositivo desconocido";
}

function formatWhen(date) {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short", timeZone: "America/Havana" }).format(date) + " (hora de Cuba)";
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}

export function buildLoginAlertEmail({ device, ip, userAgent, when }) {
  const site = String(process.env.FRONTEND_PUBLIC_URL || "https://www.readyexpressnow.com").replace(/\/$/, "");
  const resetUrl = `${site}/recuperar-password.html`;
  const rows = [["Dispositivo", device], ["Fecha", formatWhen(when)], ["Dirección IP", ip || "No disponible"], ["Detalle técnico", userAgent || "No disponible"]];
  const text = [
    "Nuevo inicio de sesión en tu cuenta de Ready Express Now",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Si fuiste tú, no tienes que hacer nada.",
    `Si no reconoces este acceso, cambia tu contraseña ahora: ${resetUrl}`,
    "y escríbenos por WhatsApp al +53 56189395."
  ].join("\n");

  const rowsHtml = rows.map(([label, value]) => `
                <tr>
                  <td style="padding:8px 12px 8px 0; font-size:14px; color:#777777; width:34%; vertical-align:top;">${label}</td>
                  <td style="padding:8px 0; font-size:14px; color:#333333; word-break:break-word;">${escapeHtml(value)}</td>
                </tr>`).join("");

  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Nuevo inicio de sesión</title></head>
<body style="margin:0; padding:0; background-color:#f5f6f8;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">Se inició sesión en tu cuenta desde ${escapeHtml(device)}.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f6f8;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr><td align="center" style="padding:0 0 20px;">
          <a href="${site}" style="text-decoration:none;"><img src="${site}/images/logo-512.png" width="56" height="56" alt="Ready Express Now" style="display:block; border:0; border-radius:12px;"></a>
        </td></tr>
        <tr><td style="background-color:#ffffff; border-radius:16px; padding:36px 32px; border:1px solid #e3e6ea; font-family:'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#333333;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" style="font-size:24px; line-height:32px; font-weight:700; color:#0D47A1; padding-bottom:12px;">Nuevo inicio de sesión</td></tr>
            <tr><td align="center" style="font-size:16px; line-height:24px; color:#555555; padding-bottom:24px;">Se inició sesión en tu cuenta de Ready Express Now desde un dispositivo que no habíamos visto antes.</td></tr>
            <tr><td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #eeeeee; border-bottom:1px solid #eeeeee; margin-bottom:24px;">${rowsHtml}
              </table>
            </td></tr>
            <tr><td style="font-size:15px; line-height:22px; color:#555555; padding-bottom:20px;"><strong>Si fuiste tú</strong>, no tienes que hacer nada.<br><strong>Si no reconoces este acceso</strong>, cambia tu contraseña ahora y escríbenos por WhatsApp.</td></tr>
            <tr><td align="center" style="padding-bottom:8px;">
              <a href="${resetUrl}" style="display:inline-block; background-color:#0D47A1; color:#ffffff; text-decoration:none; font-weight:700; font-size:16px; padding:14px 28px; border-radius:10px;">Cambiar mi contraseña</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:20px 8px 0; font-family:'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size:12px; line-height:18px; color:#888888;">
          Recibes este aviso por seguridad de tu cuenta. WhatsApp: +53 56189395
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject: "Nuevo inicio de sesión en tu cuenta de Ready Express Now", html, text };
}

async function sendWithResend({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) throw new Error("RESEND_API_KEY o RESEND_FROM no configurados");
  const fromRaw = process.env.RESEND_FROM.trim();
  const from = fromRaw.includes("<") ? fromRaw : `Ready Express Now <${fromRaw}>`;
  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({ from, to, subject, html, text });
  if (error) throw new Error(error.message || "Error enviando email con Resend");
}

// Registra el dispositivo y, si el usuario ya tenía otros y este es nuevo, le avisa por email.
// El primer dispositivo de una cuenta (registro, o primer login tras activar el aviso) no avisa.
// Nunca lanza: un fallo aquí no debe afectar al login.
export async function notifyNewDeviceLogin({ user, deviceId, userAgent, ip }, deps = defaultDeps) {
  try {
    if (!user?.id || !user?.email) return { sent: false, reason: "NO_USER" };
    const ua = String(userAgent || "").slice(0, 400);
    const hash = deviceHash(user.id, deviceId, ua);
    const meta = { userAgent: ua || null, ip: ip || null };

    const known = await deps.findDevices(user.id);
    if (known.some(device => device.device_hash === hash)) {
      await deps.touchDevice(user.id, hash, meta);
      return { sent: false, reason: "KNOWN_DEVICE" };
    }
    const inserted = await deps.insertDevice(user.id, hash, meta);
    if (!inserted) return { sent: false, reason: "KNOWN_DEVICE" };
    if (!known.length) return { sent: false, reason: "FIRST_DEVICE" };
    if (isMuted("email")) return { sent: false, reason: "MUTED" };

    await deps.sendEmail({ to: user.email, ...buildLoginAlertEmail({ device: describeUserAgent(ua), ip, userAgent: ua, when: new Date() }) });
    return { sent: true };
  } catch (error) {
    // Sin la migración 20261002_customer_known_devices.sql la tabla no existe: el login sigue igual
    console.warn("[auth:login-alert]", error?.code || "", error?.message || error);
    return { sent: false, reason: "ERROR" };
  }
}

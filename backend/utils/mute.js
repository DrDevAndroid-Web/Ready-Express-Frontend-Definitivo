// Canales de aviso silenciados para pruebas locales, p. ej. MUTE_NOTIFICATIONS=sms,email,print
// No se define en producción: sin la variable todo se envía con normalidad.
export function isMuted(channel) {
  const muted = String(process.env.MUTE_NOTIFICATIONS || "").toLowerCase().split(",").map(c => c.trim());
  if (!muted.includes(channel) && !muted.includes("all")) return false;
  console.log(`[mute] Aviso por ${channel} silenciado (MUTE_NOTIFICATIONS)`);
  return true;
}

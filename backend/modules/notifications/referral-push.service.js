import webpush from "web-push";
import { supabase } from "../../config/supabase.js";
import { createBadRequest, createServiceUnavailable, throwIfSupabaseError } from "../../utils/http-error.js";

const PREFERENCES_TABLE = "customer_notification_preferences";
const SUBSCRIPTIONS_TABLE = "customer_push_subscriptions";

function configured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

function configure() {
  if (!configured()) throw createServiceUnavailable("Las notificaciones push no están configuradas todavía");
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

function normalizeSubscription(subscription = {}) {
  const endpoint = String(subscription.endpoint || "").trim();
  const p256dh = String(subscription.keys?.p256dh || "").trim();
  const auth = String(subscription.keys?.auth || "").trim();
  if (!/^https:\/\//i.test(endpoint) || !p256dh || !auth) throw createBadRequest("La suscripción push no es válida");
  return { endpoint, p256dh, auth };
}

async function getCustomerId(userId) {
  const { data, error } = await supabase.from("customer_profiles").select("id").eq("auth_user_id", userId).maybeSingle();
  throwIfSupabaseError(error, "No se pudo cargar el perfil del cliente");
  if (!data?.id) throw createBadRequest("Perfil de cliente no encontrado");
  return data.id;
}

export function getReferralPushPublicKey() {
  return { enabled: configured(), public_key: configured() ? process.env.VAPID_PUBLIC_KEY : null };
}

export async function getReferralPushPreferences(userId) {
  const customerId = await getCustomerId(userId);
  const { data, error } = await supabase.from(PREFERENCES_TABLE).select("referral_purchase_push_enabled,updated_at").eq("customer_id", customerId).maybeSingle();
  throwIfSupabaseError(error, "No se pudieron cargar las preferencias de notificaciones");
  return { enabled: configured(), referral_purchase_push_enabled: Boolean(data?.referral_purchase_push_enabled), updated_at: data?.updated_at || null };
}

export async function updateReferralPushPreferences(userId, input = {}) {
  const customerId = await getCustomerId(userId);
  const pushEnabled = input.referral_purchase_push_enabled === true;
  if (pushEnabled) configure();

  if (pushEnabled && input.subscription) {
    const subscription = normalizeSubscription(input.subscription);
    const { error: subscriptionError } = await supabase.from(SUBSCRIPTIONS_TABLE).upsert({
      customer_id: customerId,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      user_agent: String(input.user_agent || "").slice(0, 500) || null,
      is_active: true,
      updated_at: new Date().toISOString()
    }, { onConflict: "endpoint" });
    throwIfSupabaseError(subscriptionError, "No se pudo guardar la suscripción push");
  }

  const { data, error } = await supabase.from(PREFERENCES_TABLE).upsert({
    customer_id: customerId,
    referral_purchase_push_enabled: pushEnabled,
    updated_at: new Date().toISOString()
  }, { onConflict: "customer_id" }).select("referral_purchase_push_enabled,updated_at").single();
  throwIfSupabaseError(error, "No se pudo guardar la preferencia de notificaciones");

  if (!pushEnabled) {
    const { error: disableError } = await supabase.from(SUBSCRIPTIONS_TABLE).update({ is_active: false, updated_at: new Date().toISOString() }).eq("customer_id", customerId);
    throwIfSupabaseError(disableError, "No se pudieron desactivar las suscripciones push");
  }
  return { enabled: configured(), ...data };
}

export async function notifyReferralPurchase({ referrerCustomerId, amount, currency = "USD", orderReference }) {
  if (!configured() || !referrerCustomerId) return { sent: 0, skipped: true };
  const preference = await supabase.from(PREFERENCES_TABLE).select("referral_purchase_push_enabled").eq("customer_id", referrerCustomerId).maybeSingle();
  throwIfSupabaseError(preference.error, "No se pudo consultar la preferencia push del referente");
  if (!preference.data?.referral_purchase_push_enabled) return { sent: 0, skipped: true };

  const subscriptions = await supabase.from(SUBSCRIPTIONS_TABLE).select("id,endpoint,p256dh,auth").eq("customer_id", referrerCustomerId).eq("is_active", true);
  throwIfSupabaseError(subscriptions.error, "No se pudieron cargar las suscripciones push");
  configure();
  let sent = 0;
  for (const row of subscriptions.data || []) {
    try {
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify({
        title: "🎉 Compra por tu enlace",
        body: `Tu referido completó una compra. Ganaste ${Number(amount || 0).toFixed(2)} ${currency}.`,
        url: "./cuenta.html#referidos",
        order_reference: orderReference || ""
      }));
      sent++;
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) {
        await supabase.from(SUBSCRIPTIONS_TABLE).update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", row.id);
      } else console.error("[referral-push]", error.message);
    }
  }
  return { sent, skipped: false };
}


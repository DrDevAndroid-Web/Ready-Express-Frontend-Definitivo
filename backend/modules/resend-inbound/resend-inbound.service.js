import { Resend } from "resend";
import sanitizeHtml from "sanitize-html";
import { supabase } from "../../config/supabase.js";
import { notifyInboundEmailSMS } from "../sms/sms.service.js";
import { HttpError, createBadRequest, createConflict, createNotFound, createServiceUnavailable } from "../../utils/http-error.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailAddress = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
const cleanAddress = value => String(value || "").match(/<([^<>]+)>/)?.[1] || String(value || "");
const DELIVERY_EVENTS = ["email.sent", "email.delivered", "email.delivery_delayed", "email.bounced", "email.suppressed", "email.failed"];
const FAILURE_EVENTS = new Set(["email.bounced", "email.suppressed", "email.failed"]);

function client() {
  if (!process.env.RESEND_API_KEY) throw createServiceUnavailable("Resend no está configurado");
  return new Resend(process.env.RESEND_API_KEY);
}

function checked(result) {
  if (result?.error) {
    if (result.error.statusCode === 404 || result.error.status === 404) throw createNotFound("Email no encontrado");
    throw new HttpError(502, "Resend no respondió correctamente");
  }
  if (!result?.data) throw new HttpError(502, "Respuesta incompleta de Resend");
  return result.data;
}

function db(result) {
  if (result.error) throw new HttpError(503, "No se pudo guardar el estado del email");
  return result.data;
}

export function verifyInbound(rawBody, headers, resend = client()) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret?.startsWith("whsec_")) throw createServiceUnavailable("Webhook Resend no configurado");
  if (!Buffer.isBuffer(rawBody) || !headers.id || !headers.timestamp || !headers.signature) {
    throw createBadRequest("Firma de webhook ausente");
  }
  try {
    return resend.webhooks.verify({
      payload: rawBody.toString("utf8"),
      headers,
      webhookSecret: secret
    });
  } catch {
    throw createBadRequest("Firma de webhook inválida");
  }
}

export async function receiveInbound(rawBody, headers, { resend = client(), store = supabase, sms = notifyInboundEmailSMS } = {}) {
  const event = verifyInbound(rawBody, headers, resend);
  if (typeof event?.type === "string" && event.type.startsWith("email.") && event.type !== "email.received") {
    return recordOutboundEvent(event, headers.id, store);
  }
  if (event?.type !== "email.received") return { received: false };
  const mail = event.data;
  if (!uuid.test(mail?.email_id || "")) throw createBadRequest("Evento sin email_id válido");

  const inserted = await store.from("resend_inbound_emails").insert({
    email_id: mail.email_id,
    webhook_id: headers.id,
    sender: String(mail.from || "").slice(0, 320),
    subject: String(mail.subject || "").slice(0, 1000),
    received_at: mail.created_at || event.created_at || new Date().toISOString()
  });
  if (inserted.error && inserted.error.code !== "23505") db(inserted);

  // UPDATE condicional: solo una petición concurrente puede reclamar el SMS.
  const claimed = db(await store.from("resend_inbound_emails")
    .update({ sms_status: "processing", sms_claimed_at: new Date().toISOString() })
    .eq("email_id", mail.email_id).eq("sms_status", "pending").select("email_id"));
  if (!claimed?.length) return { received: true, duplicate: true };

  let status;
  try {
    const sentRows = db(await store.from("resend_inbound_sms_alerts").select("recipient").eq("email_id", mail.email_id));
    status = await sms(mail, {
      sentRecipients: (sentRows || []).map(row => row.recipient),
      onSent: async recipient => db(await store.from("resend_inbound_sms_alerts").insert({ email_id: mail.email_id, recipient }))
    });
  } catch (error) {
    if (!error?.deliveryUncertain) {
      await store.from("resend_inbound_emails").update({ sms_status: "pending", sms_claimed_at: null })
        .eq("email_id", mail.email_id).eq("sms_status", "processing");
    }
    throw new HttpError(503, "No se pudo notificar por SMS");
  }
  // Si esta escritura falla, queda processing para revisión manual: no repetimos
  // automáticamente un SMS que el proveedor podría haber aceptado.
  db(await store.from("resend_inbound_emails").update({ sms_status: status === "sent" ? "sent" : "skipped", sms_claimed_at: null })
    .eq("email_id", mail.email_id).eq("sms_status", "processing"));
  return { received: true, duplicate: false };
}

async function recordOutboundEvent(event, webhookId, store) {
  const mail = event.data;
  if (!uuid.test(mail?.email_id || "")) throw createBadRequest("Evento sin email_id válido");
  const recipients = Array.isArray(mail.to) && mail.to.length ? mail.to : [""];
  const rows = [...new Set(recipients.map(value => String(value || "").toLowerCase()))].map(recipient => ({
    webhook_id: webhookId,
    email_id: mail.email_id,
    recipient: recipient.slice(0, 320),
    event_type: event.type.slice(0, 80),
    occurred_at: event.created_at || mail.created_at || new Date().toISOString(),
    message_id: String(mail.message_id || "").slice(0, 550) || null,
    reason: String(mail.bounce?.message || mail.failed?.reason || mail.failed?.message || mail.error?.message || mail.suppressed?.reason || mail.suppressed?.message || "").slice(0, 1000) || null
  }));
  const result = await store.from("resend_email_events").upsert(rows, { onConflict: "webhook_id,recipient", ignoreDuplicates: true });
  db(result);
  return { received: true, event: event.type };
}

function pageOptions({ limit = "20", after } = {}) {
  const parsedLimit = Number(limit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) throw createBadRequest("limit debe estar entre 1 y 100");
  if (after !== undefined && !uuid.test(after)) throw createBadRequest("after inválido");
  return { limit: parsedLimit, ...(after ? { after } : {}) };
}

function page(data) {
  const rows = Array.isArray(data.data) ? data.data : [];
  return { data: rows, has_more: Boolean(data.has_more), next_cursor: data.has_more ? rows.at(-1)?.id || null : null };
}

export async function listInbound({ limit = "20", after } = {}, { resend = client() } = {}) {
  return page(checked(await resend.emails.receiving.list(pageOptions({ limit, after }))));
}

function deliveryFor(email, events) {
  const providerEvent = String(email.last_event || "");
  const fallback = ["opened", "clicked", "complained"].includes(providerEvent) ? "delivered"
    : ["sent", "delivered", "delivery_delayed", "bounced", "suppressed", "failed", "scheduled"].includes(providerEvent) ? providerEvent : "unknown";
  const latest = new Map();
  for (const event of events) {
    if (!DELIVERY_EVENTS.includes(event.event_type)) continue;
    const recipient = event.recipient || "";
    const existing = latest.get(recipient);
    if (!existing || Date.parse(event.occurred_at) > Date.parse(existing.occurred_at)) latest.set(recipient, event);
  }
  const recipients = (Array.isArray(email.to) ? email.to : []).map(value => {
    const event = latest.get(String(value).toLowerCase());
    return {
      email: value,
      status: event?.event_type?.slice(6) || (email.to?.length === 1 ? fallback : "unknown"),
      occurred_at: event?.occurred_at || null,
      reason: event?.reason || null
    };
  });
  const statuses = recipients.map(item => item.status);
  const overall = new Set(statuses).size === 1 ? (statuses[0] === "unknown" ? fallback : statuses[0]) : statuses.length ? (statuses.some(status => FAILURE_EVENTS.has(`email.${status}`)) ? "mixed_failure" : "mixed") : fallback;
  return { ...email, delivery_status: overall, recipient_statuses: recipients };
}

export async function listSent({ limit = "20", after } = {}, { resend = client(), store = supabase } = {}) {
  const sent = page(checked(await resend.emails.list(pageOptions({ limit, after }))));
  const ids = sent.data.map(item => item.id).filter(value => uuid.test(value));
  if (!ids.length) return sent;
  const events = db(await store.from("resend_email_events")
    .select("email_id,recipient,event_type,occurred_at,reason")
    .in("email_id", ids).in("event_type", DELIVERY_EVENTS).order("occurred_at", { ascending: false }).limit(1000));
  return { ...sent, data: sent.data.map(item => deliveryFor(item, events || [])) };
}

export async function getSent(id, { resend = client(), store = supabase } = {}) {
  if (!uuid.test(id || "")) throw createBadRequest("ID de email inválido");
  const mail = checked(await resend.emails.get(id));
  const events = db(await store.from("resend_email_events")
    .select("recipient,event_type,occurred_at,reason,message_id")
    .eq("email_id", id).order("occurred_at", { ascending: false }).limit(1000));
  return { ...deliveryFor(mail, events || []), html: mail.html ? sanitizeHtml(mail.html) : null, events: events || [] };
}

export async function getInbound(id, { resend = client(), store = supabase } = {}) {
  if (!uuid.test(id || "")) throw createBadRequest("ID de email inválido");
  const mail = checked(await resend.emails.receiving.get(id));
  const [attachmentsResult, repliesResult, inboundResult] = await Promise.all([
    resend.emails.receiving.attachments.list({ emailId: id }),
    store.from("resend_email_replies").select("id,resend_email_id,recipient,cc,bcc,subject,text,html,sent_at,sent_by")
      .eq("inbound_email_id", id).order("sent_at", { ascending: true }),
    store.from("resend_inbound_emails").select("sms_status,sms_claimed_at")
      .eq("email_id", id).maybeSingle()
  ]);
  const attachments = checked(attachmentsResult);
  const replies = db(repliesResult);
  const safeReplies = (replies || []).map(reply => ({
    ...reply, html: reply.html ? sanitizeHtml(reply.html) : null
  }));
  const smsState = db(inboundResult);
  return { ...mail, html: mail.html ? sanitizeHtml(mail.html) : null, attachments: attachments.data || [], replies: safeReplies,
    sms_status: smsState?.sms_status || null, sms_claimed_at: smsState?.sms_claimed_at || null };
}

function addresses(values, field) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 20 || values.some(value => typeof value !== "string" || !emailAddress.test(value))) {
    throw createBadRequest(`${field} debe ser una lista de emails válidos`);
  }
  return [...new Set(values.map(value => value.toLowerCase()))];
}

export async function replyInbound(id, body, adminId, { resend = client(), store = supabase, idempotencyKey } = {}) {
  if (!uuid.test(id || "")) throw createBadRequest("ID de email inválido");
  if (!body || typeof body !== "object" || Array.isArray(body)) throw createBadRequest("Respuesta inválida");
  const { text, html, subject } = body;
  if ((typeof text !== "string" || !text.trim()) && (typeof html !== "string" || !html.trim())) {
    throw createBadRequest("Escribe text o html");
  }
  if (text !== undefined && (typeof text !== "string" || text.length > 100000)) throw createBadRequest("text inválido");
  if (html !== undefined && (typeof html !== "string" || html.length > 100000)) throw createBadRequest("html inválido");
  if (subject !== undefined && (typeof subject !== "string" || !subject.trim() || subject.length > 250 || /[\r\n]/.test(subject))) throw createBadRequest("subject inválido");
  const cc = addresses(body.cc, "cc");
  const bcc = addresses(body.bcc, "bcc");
  if (idempotencyKey !== undefined && !/^[A-Za-z0-9_-]{8,120}$/.test(idempotencyKey)) throw createBadRequest("Idempotency-Key inválida");
  const mail = checked(await resend.emails.receiving.get(id));
  const recipient = cleanAddress(mail.reply_to?.[0] || mail.from).trim().toLowerCase();
  if (!emailAddress.test(recipient)) throw createBadRequest("El remitente no tiene una dirección válida para responder");
  const from = String(process.env.RESEND_FROM || "").trim();
  if (!from || !emailAddress.test(cleanAddress(from).trim()) || !cleanAddress(from).toLowerCase().endsWith("@versabold.com")) {
    throw createServiceUnavailable("RESEND_FROM no está configurado con un dominio verificado");
  }
  const originalSubject = String(mail.subject || "(sin asunto)").replace(/[\r\n]/g, " ").slice(0, 240);
  const replySubject = subject?.trim() || (/^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`);
  const messageId = String(mail.message_id || mail.headers?.["message-id"] || "").trim();
  const safeMessageId = /^<[^<>\r\n]{1,500}>$/.test(messageId) ? messageId : null;
  const safeHtml = html ? sanitizeHtml(html) : null;
  if (!text?.trim() && !safeHtml?.trim()) throw createBadRequest("El HTML no contiene contenido permitido");
  const payload = {
    from, to: [recipient], subject: replySubject,
    ...(text?.trim() ? { text } : {}), ...(safeHtml?.trim() ? { html: safeHtml } : {}),
    ...(cc.length ? { cc } : {}), ...(bcc.length ? { bcc } : {}),
    ...(safeMessageId ? { headers: { "In-Reply-To": safeMessageId, References: safeMessageId } } : {})
  };
  const selection = "id,resend_email_id,recipient,cc,bcc,subject,text,html,sent_at,sent_by,request_key";
  if (idempotencyKey) {
    const existing = db(await store.from("resend_email_replies").select(selection)
      .eq("inbound_email_id", id).eq("request_key", idempotencyKey).maybeSingle());
    if (existing) {
      if (existing.recipient !== recipient || existing.subject !== replySubject || existing.text !== (text || null)
        || existing.html !== safeHtml || JSON.stringify(existing.cc) !== JSON.stringify(cc) || JSON.stringify(existing.bcc) !== JSON.stringify(bcc)) {
        throw createConflict("Idempotency-Key ya usada con otra respuesta");
      }
      return existing;
    }
  }
  const sent = checked(await resend.emails.send(payload, idempotencyKey ? { idempotencyKey: `reply-${id}-${idempotencyKey}` } : {}));
  const record = {
    inbound_email_id: id, resend_email_id: sent.id, recipient, cc, bcc,
    subject: replySubject, text: text || null, html: safeHtml, sent_by: adminId,
    request_key: idempotencyKey || null
  };
  const inserted = await store.from("resend_email_replies").insert(record).select(selection).single();
  if (inserted.error?.code === "23505" && idempotencyKey) {
    return db(await store.from("resend_email_replies").select(selection)
      .eq("inbound_email_id", id).eq("request_key", idempotencyKey).single());
  }
  return db(inserted);
}

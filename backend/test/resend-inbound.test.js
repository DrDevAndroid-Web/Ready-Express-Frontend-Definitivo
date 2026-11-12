import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { Webhook } from "svix";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.test";
process.env.SUPABASE_ANON_KEY ||= "anon-key";
process.env.RESEND_API_KEY ||= "re_test";
process.env.RESEND_FROM ||= "Ready Express Now <support@versabold.com>";
process.env.RESEND_WEBHOOK_SECRET = "whsec_" + Buffer.from("test-signing-secret-32-bytes-long!!").toString("base64");

const { default: app } = await import("../app.js");
const { receiveInbound, listInbound, getInbound, replyInbound } = await import("../modules/resend-inbound/resend-inbound.service.js");

const id = "87b5d68a-7c2e-4c93-9698-c90e691f168a";
const event = { type: "email.received", created_at: new Date().toISOString(), data: { email_id: id, from: "Alice <alice@example.com>", subject: "Consulta", created_at: new Date().toISOString() } };
const raw = Buffer.from(JSON.stringify(event));
const timestamp = String(Math.floor(Date.now() / 1000));
const headers = { id: "msg_inbound_1", timestamp, signature: new Webhook(process.env.RESEND_WEBHOOK_SECRET).sign("msg_inbound_1", new Date(Number(timestamp) * 1000), raw.toString()) };

function memoryStore() {
  let row;
  const sentAlerts = new Set();
  const store = {
    from(table) {
      if (table === "resend_inbound_sms_alerts") return {
        select: () => ({ eq: async () => ({ data: [...sentAlerts].map(recipient => ({ recipient })), error: null }) }),
        insert: async value => { sentAlerts.add(value.recipient); return { data: null, error: null }; }
      };
      assert.equal(table, "resend_inbound_emails");
      return {
        async insert(value) {
          if (row) return { error: { code: "23505" } };
          row = { ...value, sms_status: "pending" };
          return { data: row, error: null };
        },
        update(value) {
          let wantedStatus;
          return {
            eq(field, expected) {
              if (field === "sms_status") wantedStatus = expected;
              return this;
            },
            or() { return this; },
            async select() {
              if (!row || (wantedStatus && row.sms_status !== wantedStatus) || (value.sms_status === "processing" && row.sms_status !== "pending")) return { data: [], error: null };
              row = { ...row, ...value };
              return { data: [row], error: null };
            },
            then(resolve) {
              if (row) row = { ...row, ...value };
              return Promise.resolve({ data: row, error: null }).then(resolve);
            }
          };
        }
      };
    },
    get row() { return row; },
    get sentAlerts() { return sentAlerts; }
  };
  return store;
}

let server;
let base;
before(() => { server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

test("admin emails requiere sesión para lista, detalle y respuesta", async () => {
  for (const [method, path] of [["GET", "/api/admin/emails"], ["GET", `/api/admin/emails/${id}`], ["POST", `/api/admin/emails/${id}/reply`], ["GET", "/api/admin/emails/sent"], ["GET", `/api/admin/emails/sent/${id}`]]) {
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? "{}" : undefined });
    assert.equal(response.status, 401);
  }
});

test("eventos salientes firmados se guardan sin enviar SMS; estado por destinatario", async () => {
  const outbound = Buffer.from(JSON.stringify({ type: "email.bounced", created_at: new Date().toISOString(), data: { email_id: id, to: ["one@example.com"], message_id: "<out@example.com>", bounce: { message: "Mailbox rejected" } } }));
  const outboundHeaders = { id: "msg_bounce_1", timestamp, signature: new Webhook(process.env.RESEND_WEBHOOK_SECRET).sign("msg_bounce_1", new Date(Number(timestamp) * 1000), outbound.toString()) };
  const records = [];
  const store = { from: table => {
    assert.equal(table, "resend_email_events");
    return { upsert: async rows => { records.push(...rows); return { data: rows, error: null }; } };
  } };
  let smsCalled = false;
  const outcome = await receiveInbound(outbound, outboundHeaders, { store, sms: async () => { smsCalled = true; } });
  assert.deepEqual(outcome, { received: true, event: "email.bounced" });
  assert.equal(smsCalled, false);
  assert.equal(records[0].recipient, "one@example.com");
  assert.equal(records[0].reason, "Mailbox rejected");
  const resend = { emails: {
    list: async () => ({ data: { data: [{ id, to: ["one@example.com", "two@example.com"], last_event: "sent" }], has_more: false } }),
    get: async () => ({ data: { id, to: ["one@example.com", "two@example.com"], html: "<b>Ok</b><script>bad()</script>" } })
  } };
  const statusStore = { from: () => ({ select: () => ({ in: () => ({ in: () => ({ order: () => ({ limit: async () => ({ data: records, error: null }) }) }) }), eq: () => ({ order: () => ({ limit: async () => ({ data: records, error: null }) }) }) }) }) };
  const { listSent, getSent } = await import("../modules/resend-inbound/resend-inbound.service.js");
  const page = await listSent({}, { resend, store: statusStore });
  assert.equal(page.data[0].delivery_status, "mixed_failure");
  assert.equal(page.data[0].recipient_statuses[0].status, "bounced");
  assert.equal(page.data[0].recipient_statuses[1].status, "unknown");
  const detail = await getSent(id, { resend, store: statusStore });
  assert.equal(detail.html, "<b>Ok</b>");
  assert.equal(detail.events.length, 1);
});

test("webhook exige firma Svix y body original", async () => {
  const bad = await fetch(base + "/api/webhooks/resend", { method: "POST", headers: { "Content-Type": "application/json", "svix-id": headers.id, "svix-timestamp": timestamp, "svix-signature": "v1,bad" }, body: raw });
  assert.equal(bad.status, 400);
  const missing = await fetch(base + "/api/webhooks/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: raw });
  assert.equal(missing.status, 400);
});

test("webhook firmado solo notifica una vez al repetir email.received", async () => {
  const store = memoryStore();
  let smsCount = 0;
  const deps = { store, sms: async () => { smsCount++; return "sent"; } };
  assert.deepEqual(await receiveInbound(raw, headers, deps), { received: true, duplicate: false });
  assert.deepEqual(await receiveInbound(raw, headers, deps), { received: true, duplicate: true });
  assert.equal(smsCount, 1);
  assert.equal(store.row.sms_status, "sent");
});

test("fallo de SMS reintenta sin repetir destinatarios ya confirmados", async () => {
  const store = memoryStore();
  let attempts = 0;
  const sms = async (_mail, { sentRecipients, onSent }) => {
    attempts++;
    if (attempts === 1) {
      await onSent("+10000000000");
      throw new Error("Proveedor rechazó el segundo teléfono");
    }
    assert.deepEqual(sentRecipients, ["+10000000000"]);
    await onSent("+20000000000");
    return "sent";
  };
  await assert.rejects(receiveInbound(raw, headers, { store, sms }), { status: 503 });
  assert.equal(store.row.sms_status, "pending");
  const result = await receiveInbound(raw, headers, { store, sms });
  assert.equal(result.duplicate, false);
  assert.equal(attempts, 2);
  assert.equal(store.sentAlerts.size, 2);
  assert.equal(store.row.sms_status, "sent");
});

test("resultado SMS incierto queda retenido para no reenviarlo", async () => {
  const store = memoryStore();
  let calls = 0;
  const sms = async () => { calls++; const error = new Error("No se pudo registrar SMS aceptado"); error.deliveryUncertain = true; throw error; };
  await assert.rejects(receiveInbound(raw, headers, { store, sms }), { status: 503 });
  assert.equal(store.row.sms_status, "processing");
  const replay = await receiveInbound(raw, headers, { store, sms });
  assert.equal(replay.duplicate, true);
  assert.equal(calls, 1);
});

test("lista valida paginación; detalle sanea HTML y devuelve adjuntos", async () => {
  const resend = { emails: { receiving: {
    list: async options => ({ data: { data: [{ id }], has_more: true, options } }),
    get: async () => ({ data: { id, from: "alice@example.com", html: '<p>Hola</p><script>alert(1)</script>' } }),
    attachments: { list: async () => ({ data: { data: [{ filename: "foto.png", download_url: "https://example.com/file" }] } }) }
  } } };
  const page = await listInbound({ limit: "5", after: id }, { resend });
  assert.equal(page.next_cursor, id);
  assert.equal(page.has_more, true);
  await assert.rejects(listInbound({ limit: "101" }, { resend }), { status: 400 });
  const store = {
    from(table) {
      return {
        select() {
          return {
            eq() {
              return table === "resend_inbound_emails"
                ? { maybeSingle: async () => ({ data: { sms_status: "sent", sms_claimed_at: null }, error: null }) }
                : { order: async () => ({ data: [], error: null }) };
            }
          };
        }
      };
    }
  };
  const detail = await getInbound(id, { resend, store });
  assert.equal(detail.html, "<p>Hola</p>");
  assert.equal(detail.attachments[0].filename, "foto.png");
  assert.equal(detail.sms_status, "sent");
});

test("respuesta usa Message-ID para hilo y valida destinatarios", async () => {
  let sentPayload;
  const resend = { emails: {
    receiving: { get: async () => ({ data: { from: "Alice <alice@example.com>", reply_to: ["reply@example.com"], subject: "Consulta", message_id: "<original@example.com>" } }) },
    send: async payload => { sentPayload = payload; return { data: { id } }; }
  } };
  const store = { from: () => ({ insert: value => ({ select: () => ({ single: async () => ({ data: { ...value, id: "reply-1" }, error: null }) }) }) }) };
  const reply = await replyInbound(id, { text: "Gracias", cc: ["copy@example.com"], html: "<p>Gracias</p><script>alert(1)</script>" }, "admin-1", { resend, store });
  assert.equal(sentPayload.to[0], "reply@example.com");
  assert.equal(sentPayload.headers["In-Reply-To"], "<original@example.com>");
  assert.equal(sentPayload.headers.References, "<original@example.com>");
  assert.equal(sentPayload.html, "<p>Gracias</p>");
  assert.equal(reply.resend_email_id, id);
  await assert.rejects(replyInbound(id, { text: "ok", bcc: ["invalid"] }, "admin-1", { resend, store }), { status: 400 });
});

test("respuesta con Idempotency-Key reutiliza el envío y rechaza contenido diferente", async () => {
  let sentCount = 0;
  let recorded = null;
  const resend = { emails: {
    receiving: { get: async () => ({ data: { from: "alice@example.com", subject: "Consulta", message_id: "<original@example.com>" } }) },
    send: async (_payload, options) => {
      sentCount++;
      assert.match(options.idempotencyKey, /^reply-/);
      return { data: { id } };
    }
  } };
  const store = { from: () => ({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: recorded, error: null }) }) }) }),
    insert: value => ({ select: () => ({ single: async () => { recorded = { ...value, id: "reply-2" }; return { data: recorded, error: null }; } }) })
  }) };
  const deps = { resend, store, idempotencyKey: "request_12345678" };
  await replyInbound(id, { text: "Gracias" }, "admin-1", deps);
  await replyInbound(id, { text: "Gracias" }, "admin-1", deps);
  assert.equal(sentCount, 1);
  await assert.rejects(replyInbound(id, { text: "Otro texto" }, "admin-1", deps), { status: 409 });
});

test("estado enviado usa la fecha del evento, no su orden de llegada", async () => {
  const events = [
    { email_id: id, recipient: "alice@example.com", event_type: "email.delivered", occurred_at: "2026-11-12T12:05:00Z" },
    { email_id: id, recipient: "alice@example.com", event_type: "email.sent", occurred_at: "2026-11-12T12:00:00Z" }
  ];
  const resend = { emails: { list: async () => ({ data: { data: [{ id, to: ["alice@example.com"], last_event: "sent" }], has_more: false } }) } };
  const store = { from: () => ({ select: () => ({ in: () => ({ in: () => ({ order: () => ({ limit: async () => ({ data: events.toReversed(), error: null }) }) }) }) }) }) };
  const { listSent } = await import("../modules/resend-inbound/resend-inbound.service.js");
  const result = await listSent({}, { resend, store });
  assert.equal(result.data[0].delivery_status, "delivered");
  assert.equal(result.next_cursor, null);
});

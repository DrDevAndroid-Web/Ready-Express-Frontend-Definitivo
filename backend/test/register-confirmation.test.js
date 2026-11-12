import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCIsImlzcyI6InN1cGFiYXNlIn0",
  "test-signature"
].join(".");
process.env.SUPABASE_ANON_KEY ||= "anon-key";

const { emailConfirmationRedirectUrl, normalizeDeliveryAddress, normalizeEmailCode, registerCustomer, resendConfirmationEmail, verifyEmailCode } = await import("../modules/customers/customer.service.js");
const { default: app } = await import("../app.js");

describe("enlace de confirmación del email", () => {
  it("vuelve a cuenta-confirmada.html del dominio público", () => {
    const saved = { ...process.env };
    delete process.env.FRONTEND_EMAIL_CONFIRM_URL;
    process.env.FRONTEND_PUBLIC_URL = "https://www.readyexpressnow.com/";
    assert.equal(emailConfirmationRedirectUrl(), "https://www.readyexpressnow.com/cuenta-confirmada.html");
    process.env.FRONTEND_EMAIL_CONFIRM_URL = "http://localhost:5173/cuenta-confirmada.html";
    assert.equal(emailConfirmationRedirectUrl(), "http://localhost:5173/cuenta-confirmada.html");
    process.env = saved;
  });
});

describe("dirección de entrega en el registro", () => {
  it("sin dirección no guarda nada", () => {
    assert.equal(normalizeDeliveryAddress(null), null);
    assert.equal(normalizeDeliveryAddress({ alias: "Casa" }), null);
    assert.equal(normalizeDeliveryAddress("texto"), null);
  });

  it("normaliza y la marca como predeterminada", () => {
    assert.deepEqual(normalizeDeliveryAddress({ direccion: "  Calle 5 #120 ", municipio: "Caimanera", telefono_contacto: "" }), {
      alias: "Entrega principal",
      direccion: "Calle 5 #120",
      provincia: null,
      municipio: "Caimanera",
      referencia: null,
      telefono_contacto: null,
      es_predeterminada: true
    });
  });
});

describe("código de confirmación por email", () => {
  const fakeAuth = (results) => {
    const calls = [];
    return { calls, auth: { auth: { verifyOtp: async params => { calls.push(params); return results.shift(); } } } };
  };
  const session = { access_token: "a", refresh_token: "r", expires_at: 1 };

  it("acepta el código con espacios o guiones", () => {
    assert.equal(normalizeEmailCode(" 482 913 "), "482913");
    assert.equal(normalizeEmailCode("482-913"), "482913");
  });

  it("acepta códigos de hasta diez cifras y rechaza los incompletos", () => {
    assert.equal(normalizeEmailCode("12345678"), "12345678");
    assert.throws(() => normalizeEmailCode("123"), /6 y 10 dígitos/);
    assert.throws(() => normalizeEmailCode(""), /6 y 10 dígitos/);
  });

  it("código correcto: devuelve la sesión", async () => {
    const { auth, calls } = fakeAuth([{ data: { session, user: { id: "u", email: "a@b.com" } }, error: null }]);
    const result = await verifyEmailCode("A@B.com", "482913", auth);
    assert.equal(result.access_token, "a");
    assert.deepEqual(result.user, { id: "u", email: "a@b.com" });
    assert.deepEqual(calls[0], { email: "a@b.com", token: "482913", type: "email" });
  });

  it("un error de Supabase no provoca un segundo intento", async () => {
    const { auth, calls } = fakeAuth([
      { data: {}, error: { message: "Too many requests", status: 429 } }
    ]);
    await assert.rejects(verifyEmailCode("a@b.com", "482913", auth), err => err.status === 429);
    assert.equal(calls.length, 1);
  });

  it("código incorrecto: 400 con mensaje claro", async () => {
    const invalid = { data: {}, error: { message: "Token has expired or is invalid", status: 403 } };
    const { auth, calls } = fakeAuth([invalid]);
    await assert.rejects(verifyEmailCode("a@b.com", "000000", auth), err => err.status === 400 && /caducó/.test(err.message));
    assert.equal(calls.length, 1);
  });

  it("un fallo del servicio se distingue de un código inválido", async () => {
    const { auth } = fakeAuth([{ data: {}, error: { message: "Service unavailable", status: 503 } }]);
    await assert.rejects(verifyEmailCode("a@b.com", "123456", auth), err => err.status === 503);
  });
});

describe("reenvío de confirmación", () => {
  const fakeAuth = error => ({ auth: { resend: async () => ({ error }) } });

  it("no informa éxito cuando falla el proveedor", async () => {
    await assert.rejects(resendConfirmationEmail("a@b.com", fakeAuth({ status: 500, message: "SMTP unavailable" })), err => err.status === 503);
  });

  it("conserva el límite de frecuencia y la respuesta neutra para cuentas inexistentes", async () => {
    await assert.rejects(resendConfirmationEmail("a@b.com", fakeAuth({ status: 429, message: "rate limit" })), err => err.status === 429);
    const result = await resendConfirmationEmail("a@b.com", fakeAuth({ status: 404, code: "user_not_found" }));
    assert.match(result.message, /Si la cuenta/);
  });
});

describe("registro completo o reversión", () => {
  const input = {
    email: "a@b.com", password: "password123", confirm_password: "password123",
    nombre: "Ana", apellidos: "Pérez", preferred_payment_methods: ["zelle"]
  };
  function fakeClients(failingTable = null, rollbackError = null, existingUser = false) {
    const calls = { deleted: [], tables: [] };
    const auth = { auth: { signUp: async request => ({
      data: { user: { id: "new-user", email: request.email, identities: [{}], user_metadata: existingUser ? {} : request.options.data }, session: null },
      error: null
    }) } };
    const db = {
      auth: { admin: { deleteUser: async id => { calls.deleted.push(id); return { error: rollbackError }; } } },
      from(table) {
        calls.tables.push(table);
        if (table === "customer_profiles") return { insert: () => ({ select: () => ({ single: async () => ({ data: { id: "profile-1" }, error: failingTable === table ? { message: "DB failed", code: "TEST" } : null }) }) }) };
        if (table === "customer_payment_preferences") return { upsert: async () => ({ error: failingTable === table ? { message: "DB failed", code: "TEST" } : null }) };
        if (table === "user_roles") return { insert: async () => ({ error: failingTable === table ? { message: "DB failed", code: "TEST" } : null }) };
        throw new Error(`Tabla inesperada: ${table}`);
      }
    };
    return { auth, db, calls };
  }

  it("conserva la cuenta cuando perfil, preferencias y rol se crearon", async () => {
    const clients = fakeClients();
    const result = await registerCustomer(input, clients);
    assert.equal(result.email_confirmation_required, true);
    assert.deepEqual(clients.calls.deleted, []);
  });

  for (const table of ["customer_profiles", "customer_payment_preferences", "user_roles"]) {
    it(`revierte la cuenta Auth si falla ${table}`, async () => {
      const clients = fakeClients(table);
      await assert.rejects(registerCustomer(input, clients), err => err.status === 503 && /ignora el correo anterior/.test(err.message));
      assert.deepEqual(clients.calls.deleted, ["new-user"]);
    });
  }

  it("nunca elimina una cuenta que no corresponde a este intento", async () => {
    const clients = fakeClients(null, null, true);
    await assert.rejects(registerCustomer(input, clients), err => err.status === 409);
    assert.deepEqual(clients.calls.deleted, []);
    assert.deepEqual(clients.calls.tables, []);
  });

  it("pide soporte si Supabase impide la reversión", async () => {
    const clients = fakeClients("user_roles", { message: "FK restrict" });
    await assert.rejects(registerCustomer(input, clients), err => err.status === 503 && /Contáctanos/.test(err.message));
    assert.deepEqual(clients.calls.deleted, ["new-user"]);
  });
});

describe("POST /api/auth/resend-confirmation", () => {
  let server, baseUrl;
  before(() => {
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  it("verify-email-code sin código responde 400", async () => {
    const res = await fetch(`${baseUrl}/api/auth/verify-email-code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "a@b.com" }) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /código/i);
  });

  it("sin email responde 400", async () => {
    const res = await fetch(`${baseUrl}/api/auth/resend-confirmation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /email/i);
  });
});

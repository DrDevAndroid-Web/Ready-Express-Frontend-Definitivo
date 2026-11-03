import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCIsImlzcyI6InN1cGFiYXNlIn0",
  "test-signature"
].join(".");
process.env.SUPABASE_ANON_KEY ||= "anon-key";

const { emailConfirmationRedirectUrl, normalizeDeliveryAddress, normalizeEmailCode, verifyEmailCode } = await import("../modules/customers/customer.service.js");
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

  it("rechaza códigos demasiado cortos", () => {
    assert.throws(() => normalizeEmailCode("123"), /6 dígitos/);
    assert.throws(() => normalizeEmailCode(""), /6 dígitos/);
  });

  it("código correcto: devuelve la sesión", async () => {
    const { auth, calls } = fakeAuth([{ data: { session, user: { id: "u", email: "a@b.com" } }, error: null }]);
    const result = await verifyEmailCode("A@B.com", "482913", auth);
    assert.equal(result.access_token, "a");
    assert.deepEqual(result.user, { id: "u", email: "a@b.com" });
    assert.deepEqual(calls[0], { email: "a@b.com", token: "482913", type: "email" });
  });

  it("si el tipo email falla prueba con signup", async () => {
    const { auth, calls } = fakeAuth([
      { data: {}, error: { message: "Token has expired or is invalid" } },
      { data: { session, user: { id: "u", email: "a@b.com" } }, error: null }
    ]);
    await verifyEmailCode("a@b.com", "482913", auth);
    assert.equal(calls[1].type, "signup");
  });

  it("código incorrecto: 400 con mensaje claro", async () => {
    const invalid = { data: {}, error: { message: "Token has expired or is invalid", status: 403 } };
    const { auth } = fakeAuth([invalid, invalid]);
    await assert.rejects(verifyEmailCode("a@b.com", "000000", auth), err => err.status === 400 && /caducó/.test(err.message));
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

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCIsImlzcyI6InN1cGFiYXNlIn0",
  "test-signature"
].join(".");
process.env.SUPABASE_ANON_KEY ||= "anon-key";

const { parseBirthDate } = await import("../utils/billing.js");
const { normalizeBilling } = await import("../modules/customers/customer.service.js");
const { normalizePayer } = await import("../modules/orders/orders.service.js");
const { buildTropipayClient } = await import("../modules/payments/providers/tropipay.provider.js");
const { default: app } = await import("../app.js");

let server, baseUrl;
before(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const yearsAgo = years => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};

const billing = {
  pais_iso: "us", direccion_facturacion: "100 Test Street", ciudad: "Miami", estado_region: "FL",
  codigo_postal: "33101", fecha_nacimiento: "1990-01-15", acepta_terminos_tropipay: "on"
};

describe("parseBirthDate — fecha de nacimiento", () => {
  it("acepta una fecha válida de un adulto", () => assert.equal(parseBirthDate("1990-01-15"), "1990-01-15"));
  it("rechaza menores de edad", () => assert.throws(() => parseBirthDate(yearsAgo(17)), /mayor de edad/));
  it("acepta a quien cumple 18 hoy", () => assert.equal(parseBirthDate(yearsAgo(18)), yearsAgo(18)));
  it("rechaza fechas imposibles", () => assert.throws(() => parseBirthDate("1990-02-30"), /no es valida/));
  it("rechaza otros formatos", () => assert.throws(() => parseBirthDate("15/01/1990"), /no es valida/));
  it("rechaza edades imposibles", () => assert.throws(() => parseBirthDate("1850-01-01"), /no es valida/));
  it("vacía → requerida", () => assert.throws(() => parseBirthDate(""), /requerida/));
});

describe("normalizeBilling — datos de facturación del perfil", () => {
  it("normaliza y marca la aceptación de términos", () => {
    const result = normalizeBilling(billing);
    assert.equal(result.pais_iso, "US");
    assert.equal(result.codigo_postal, "33101");
    assert.equal(result.fecha_nacimiento, "1990-01-15");
    assert.ok(result.terminos_tropipay_at);
  });
  for (const [field, pattern] of [["pais_iso", /pais/i], ["direccion_facturacion", /direccion/i], ["ciudad", /ciudad/i], ["codigo_postal", /postal/i], ["fecha_nacimiento", /nacimiento/i]]) {
    it(`sin ${field} → error`, () => assert.throws(() => normalizeBilling({ ...billing, [field]: "" }), pattern));
  }
  it("sin aceptar términos → error", () => assert.throws(() => normalizeBilling({ ...billing, acepta_terminos_tropipay: undefined }), /terminos/));
  it("estado/provincia es opcional", () => assert.equal(normalizeBilling({ ...billing, estado_region: "" }).estado_region, null));
});

describe("Pagador de la orden y client de TropiPay", () => {
  const data = { customer_email: "ana@example.com", payer: { country_iso: "US", address: "100 Test Street", city: "Miami", post_code: "33101", birth_date: "1990-01-15", terms_accepted: true } };

  it("la orden guarda código postal y fecha de nacimiento", () => {
    const { details } = normalizePayer(data);
    assert.equal(details.post_code, "33101");
    assert.equal(details.birth_date, "1990-01-15");
  });
  it("sin código postal → error", () => assert.throws(() => normalizePayer({ ...data, payer: { ...data.payer, post_code: "" } }), /postal/));
  it("sin fecha de nacimiento → error", () => assert.throws(() => normalizePayer({ ...data, payer: { ...data.payer, birth_date: "" } }), /nacimiento/));
  it("envía dateOfBirth a TropiPay", () => {
    const client = buildTropipayClient({ sender_first_name: "Ana", sender_last_name: "Prueba", customer_email: "ana@example.com", sender_phone: "+1", payer_details: normalizePayer(data).details });
    assert.equal(client.dateOfBirth, "1990-01-15");
    assert.equal(client.postCode, "33101");
  });
  it("órdenes antiguas sin fecha: no envía dateOfBirth", () => {
    assert.equal(buildTropipayClient({ payer_details: { country_iso: "US" } }).dateOfBirth, undefined);
  });
});

describe("POST /api/auth/register — datos de facturación obligatorios", () => {
  const account = { email: "nuevo@example.com", password: "12345678", nombre: "Ana", apellidos: "Prueba", telefono: "+1" };
  const register = body => fetch(`${baseUrl}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("sin datos de facturación → 400 antes de crear el usuario", async () => {
    const res = await register(account);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /terminos/i);
  });
  it("sin fecha de nacimiento → 400", async () => {
    const res = await register({ ...account, ...billing, fecha_nacimiento: "" });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /nacimiento/i);
  });
  it("menor de edad → 400", async () => {
    const res = await register({ ...account, ...billing, fecha_nacimiento: yearsAgo(16) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /mayor de edad/i);
  });
});

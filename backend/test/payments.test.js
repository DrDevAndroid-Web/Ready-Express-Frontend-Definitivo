import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCIsImlzcyI6InN1cGFiYXNlIn0",
  "test-signature"
].join(".");
process.env.SUPABASE_ANON_KEY ||= "anon-key";

const { default: app } = await import("../app.js");

let server;
let baseUrl;

before(() => {
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
});

async function request(path, options) {
  return fetch(`${baseUrl}${path}`, options);
}

// Blob con cabecera JPEG mínima — pasa el filtro MIME de Multer (type: image/jpeg)
function makeImageBlob() {
  const bytes = new Uint8Array([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46,
    0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00
  ]);
  return new Blob([bytes], { type: "image/jpeg" });
}

describe("POST /api/payments/upload — validación de comprobantes", () => {
  it("rechaza sin archivo con 400", async () => {
    const form = new FormData();
    form.set("order_id", "test-order");
    form.set("method", "WellsFargoZelle");
    form.set("amount", "10");

    const res = await request("/api/payments/upload", { method: "POST", body: form });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /imagen|comprobante/i);
  });

  it("rechaza archivo válido sin order_id con 400", async () => {
    const form = new FormData();
    form.append("image", makeImageBlob(), "comprobante.jpg");
    form.set("method", "WellsFargoZelle");
    form.set("amount", "10");
    // sin order_id

    const res = await request("/api/payments/upload", { method: "POST", body: form });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /orden/i);
  });

  it("rechaza método de pago inválido con 400", async () => {
    const form = new FormData();
    form.append("image", makeImageBlob(), "comprobante.jpg");
    form.set("order_id", "test-order");
    form.set("method", "PayPal");
    form.set("amount", "10");

    const res = await request("/api/payments/upload", { method: "POST", body: form });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /Metodo de pago/i);
  });

  it("rechaza amount igual a cero con 400", async () => {
    const form = new FormData();
    form.append("image", makeImageBlob(), "comprobante.jpg");
    form.set("order_id", "test-order");
    form.set("method", "Zelle");
    form.set("amount", "0");

    const res = await request("/api/payments/upload", { method: "POST", body: form });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /monto/i);
  });

  it("rechaza archivo con MIME text/plain con 400 (rechazado por Multer)", async () => {
    const form = new FormData();
    const textBlob = new Blob(["contenido de prueba"], { type: "text/plain" });
    form.append("image", textBlob, "no-es-imagen.txt");
    form.set("order_id", "test-order");
    form.set("method", "WellsFargoZelle");
    form.set("amount", "10");

    const res = await request("/api/payments/upload", { method: "POST", body: form });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /imagen/i);
  });
});

describe("GET /api/payments/pending", () => {
  it("rechaza sin autenticación con 401", async () => {
    const res = await request("/api/payments/pending");
    const body = await res.json();
    assert.equal(res.status, 401);
  });
});

describe("PATCH /api/payments/:id/verify", () => {
  it("rechaza sin autenticación con 401", async () => {
    const res = await request("/api/payments/test-id/verify", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" })
    });
    const body = await res.json();
    assert.equal(res.status, 401);
  });
});

describe("POST /api/payments/upload — requiere ser dueño de la orden", () => {
  it("rechaza un comprobante sin checkout_token ni sesión", async () => {
    const form = new FormData();
    form.append("image", new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }), "c.jpg");
    form.set("order_id", "orden-abc");
    form.set("method", "Zelle");
    form.set("amount", "65");
    const res = await fetch(`${baseUrl}/api/payments/upload`, { method: "POST", body: form });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /checkout_token/i);
  });
});

describe("proofMethodNames — métodos que aceptan comprobante", async () => {
  const { proofMethodNames } = await import("../modules/payments/payments.service.js");

  it("usa los métodos activos de la tabla, incluidos los nuevos", () => {
    assert.deepEqual(proofMethodNames([
      { method_name: "Zelle", is_active: true },
      { method_name: "Bizum", is_active: true, payment_flow: "proof_upload" }
    ]), ["Zelle", "Bizum"]);
  });

  it("excluye TropiPay, métodos asistidos e inactivos", () => {
    assert.deepEqual(proofMethodNames([
      { method_name: "TropiPay", is_active: true },
      { method_name: "Transferencia México", is_active: true, payment_flow: "assisted" },
      { method_name: "Viejo", is_active: false },
      { method_name: "Zelle", is_active: true }
    ]), ["Zelle"]);
  });

  it("sin datos usa los predeterminados", () => {
    assert.deepEqual(proofMethodNames([]), ["Zelle", "TocoPay"]);
  });
});

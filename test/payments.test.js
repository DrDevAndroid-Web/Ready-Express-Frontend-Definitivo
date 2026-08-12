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
    form.set("method", "WellsFargoZelle");
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

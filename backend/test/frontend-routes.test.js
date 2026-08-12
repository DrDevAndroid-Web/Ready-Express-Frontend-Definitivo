/**
 * Simulaciones de todas las rutas que el frontend invoca contra el backend.
 * Basado en frontend/js/api.js:
 *   GET  /food-combos
 *   GET  /productos
 *   GET  /electrodomesticos
 *   GET  /info
 *   POST /orders
 *   PATCH /orders/:id/cancel
 *   POST /payments/upload
 *   GET  /payment-methods
 *
 * Las rutas que tocan Supabase se validan solo hasta el punto de validación
 * en memoria (400/401/409) sin red real. Las que no tienen validación propia
 * se verifican que respondan 200 o 500 controlado (nunca crash sin body).
 */
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

function req(path, options = {}) {
  return fetch(`${baseUrl}/api${path}`, options);
}

function makeImageBlob() {
  const bytes = new Uint8Array([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46,
    0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00
  ]);
  return new Blob([bytes], { type: "image/jpeg" });
}

// ---------------------------------------------------------------------------
// GET /food-combos  (alias de /combos-comida — público, sin auth)
// ---------------------------------------------------------------------------
describe("GET /api/food-combos — catálogo de combos", () => {
  it("responde con JSON (200 o error controlado, nunca crash)", async () => {
    const res = await req("/food-combos");
    const body = await res.json();
    assert.ok([200, 500, 503].includes(res.status), `status inesperado: ${res.status}`);
    assert.ok(typeof body === "object", "body debe ser objeto o array");
  });

  it("Content-Type es application/json", async () => {
    const res = await req("/food-combos");
    assert.ok(res.headers.get("content-type")?.includes("application/json"));
  });
});

// ---------------------------------------------------------------------------
// GET /productos — público
// ---------------------------------------------------------------------------
describe("GET /api/productos — catálogo de productos", () => {
  it("responde con JSON (200 o error controlado)", async () => {
    const res = await req("/productos");
    const body = await res.json();
    assert.ok([200, 500, 503].includes(res.status), `status inesperado: ${res.status}`);
    assert.ok(typeof body === "object");
  });

  it("Content-Type es application/json", async () => {
    const res = await req("/productos");
    assert.ok(res.headers.get("content-type")?.includes("application/json"));
  });
});

// ---------------------------------------------------------------------------
// GET /electrodomesticos — público
// ---------------------------------------------------------------------------
describe("GET /api/electrodomesticos — catálogo de electrodomésticos", () => {
  it("responde con JSON (200 o error controlado)", async () => {
    const res = await req("/electrodomesticos");
    const body = await res.json();
    assert.ok([200, 500, 503].includes(res.status), `status inesperado: ${res.status}`);
    assert.ok(typeof body === "object");
  });

  it("Content-Type es application/json", async () => {
    const res = await req("/electrodomesticos");
    assert.ok(res.headers.get("content-type")?.includes("application/json"));
  });
});

// ---------------------------------------------------------------------------
// GET /info — información del negocio (pública)
// ---------------------------------------------------------------------------
describe("GET /api/info — información del negocio", () => {
  it("responde con JSON (200 o error controlado)", async () => {
    const res = await req("/info");
    const body = await res.json();
    assert.ok([200, 500, 503].includes(res.status), `status inesperado: ${res.status}`);
    assert.ok(typeof body === "object");
  });
});

// ---------------------------------------------------------------------------
// POST /orders — crear orden (público)
// ---------------------------------------------------------------------------
const validOrder = {
  items: [{ nombre: "Combo Familiar", precio: 45, cantidad: 2 }],
  total: 90,
  sender_name: "Juan Pérez",
  sender_phone: "+1 305 555 0000",
  receiver_name: "María García",
  receiver_phone: "+53 5 555 0000",
  customer_address: "Calle 5 #12, Guantánamo"
};

describe("POST /api/orders — validaciones de entrada", () => {
  it("rechaza body vacío → 400 con mención a item", async () => {
    const res = await req("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /item/i);
  });

  it("rechaza items array vacío → 400", async () => {
    const res = await req("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validOrder, items: [] })
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /item/i);
  });

  it("rechaza total 0 → 400", async () => {
    const res = await req("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validOrder, total: 0 })
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /mayor que cero/i);
  });

  it("rechaza total negativo → 400", async () => {
    const res = await req("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validOrder, total: -10 })
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /mayor que cero/i);
  });

  it("rechaza sin sender_name → 400 con mención a remitente", async () => {
    const { sender_name, ...rest } = validOrder;
    const res = await req("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rest)
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /remitente/i);
  });

  it("rechaza sin sender_phone → 400 con mención a telefono", async () => {
    const { sender_phone, ...rest } = validOrder;
    const res = await req("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rest)
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /telefono/i);
  });

  it("rechaza sin receiver_name → 400 con mención a receptor", async () => {
    const { receiver_name, ...rest } = validOrder;
    const res = await req("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rest)
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /receptor/i);
  });

  it("rechaza sin receiver_phone → 400 con mención a telefono", async () => {
    const { receiver_phone, ...rest } = validOrder;
    const res = await req("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rest)
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /telefono/i);
  });

  it("rechaza sin customer_address → 400 con mención a direccion", async () => {
    const { customer_address, ...rest } = validOrder;
    const res = await req("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rest)
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /direccion/i);
  });

  it("rechaza item sin nombre → 400", async () => {
    const res = await req("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validOrder,
        items: [{ precio: 10, cantidad: 1 }]
      })
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /nombre/i);
  });

  it("rechaza item con nombre vacío (solo espacios) → 400", async () => {
    const res = await req("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validOrder,
        items: [{ nombre: "   ", precio: 10, cantidad: 1 }]
      })
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /nombre/i);
  });

  it("rechaza item con precio negativo → 400", async () => {
    const res = await req("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validOrder,
        items: [{ nombre: "Combo X", precio: -5, cantidad: 1 }]
      })
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /precio/i);
  });

  it("rechaza item con cantidad 0 → 400", async () => {
    const res = await req("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validOrder,
        items: [{ nombre: "Combo X", precio: 10, cantidad: 0 }]
      })
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /cantidad/i);
  });

  it("rechaza body no-JSON → 400", async () => {
    const res = await req("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "esto no es json{"
    });
    const body = await res.json();
    assert.equal(res.status, 400);
  });

  it("orden completa válida intenta llegar a Supabase (500 aceptable en test, no 400)", async () => {
    const res = await req("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validOrder)
    });
    const body = await res.json();
    // En test no hay Supabase real: puede ser 500. Lo que NO debe ocurrir es 400.
    assert.notEqual(res.status, 400, `No debería rechazar una orden válida con 400: ${body.error}`);
    assert.ok(typeof body === "object");
  });
});

// ---------------------------------------------------------------------------
// PATCH /orders/:id/cancel — cancelar orden (público)
// ---------------------------------------------------------------------------
describe("PATCH /api/orders/:id/cancel — cancelar orden", () => {
  it("responde con JSON para un ID inexistente (500 o 404 controlado, no crash)", async () => {
    const res = await req("/orders/orden-inexistente-abc123/cancel", {
      method: "PATCH"
    });
    const body = await res.json();
    assert.ok([404, 500].includes(res.status), `status inesperado: ${res.status}`);
    assert.ok("error" in body, "debe tener campo error");
  });

  it("responde con JSON para un ID vacío-like (no crash)", async () => {
    const res = await req("/orders/undefined/cancel", { method: "PATCH" });
    const body = await res.json();
    assert.ok(typeof body === "object");
  });
});

// ---------------------------------------------------------------------------
// POST /payments/upload — subir comprobante (público)
// ---------------------------------------------------------------------------
describe("POST /api/payments/upload — subir comprobante", () => {
  it("rechaza sin archivo → 400 con mención a imagen/comprobante", async () => {
    const form = new FormData();
    form.set("order_id", "orden-abc");
    form.set("method", "Zelle");
    form.set("amount", "65");

    const res = await req("/payments/upload", { method: "POST", body: form });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /imagen|comprobante/i);
  });

  it("rechaza sin order_id → 400 con mención a orden", async () => {
    const form = new FormData();
    form.append("image", makeImageBlob(), "comprobante.jpg");
    form.set("method", "Zelle");
    form.set("amount", "65");

    const res = await req("/payments/upload", { method: "POST", body: form });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /orden/i);
  });

  it("rechaza método inválido (PayPal) → 400", async () => {
    const form = new FormData();
    form.append("image", makeImageBlob(), "comprobante.jpg");
    form.set("order_id", "orden-abc");
    form.set("method", "PayPal");
    form.set("amount", "65");

    const res = await req("/payments/upload", { method: "POST", body: form });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /metodo|pago/i);
  });

  it("rechaza método vacío → 400", async () => {
    const form = new FormData();
    form.append("image", makeImageBlob(), "comprobante.jpg");
    form.set("order_id", "orden-abc");
    form.set("method", "");
    form.set("amount", "65");

    const res = await req("/payments/upload", { method: "POST", body: form });
    const body = await res.json();
    assert.equal(res.status, 400);
  });

  it("acepta Zelle como método válido (llega a Supabase — no 400)", async () => {
    const form = new FormData();
    form.append("image", makeImageBlob(), "comprobante.jpg");
    form.set("order_id", "orden-abc");
    form.set("method", "Zelle");
    form.set("amount", "65");

    const res = await req("/payments/upload", { method: "POST", body: form });
    const body = await res.json();
    assert.notEqual(res.status, 400, `Zelle debe pasar validación: ${body.error}`);
  });

  it("acepta TocoPay como método válido (llega a Supabase — no 400)", async () => {
    const form = new FormData();
    form.append("image", makeImageBlob(), "comprobante.jpg");
    form.set("order_id", "orden-abc");
    form.set("method", "TocoPay");
    form.set("amount", "65");

    const res = await req("/payments/upload", { method: "POST", body: form });
    const body = await res.json();
    assert.notEqual(res.status, 400, `TocoPay debe pasar validación: ${body.error}`);
  });

  it("rechaza amount = 0 → 400 con mención a monto", async () => {
    const form = new FormData();
    form.append("image", makeImageBlob(), "comprobante.jpg");
    form.set("order_id", "orden-abc");
    form.set("method", "Zelle");
    form.set("amount", "0");

    const res = await req("/payments/upload", { method: "POST", body: form });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /monto/i);
  });

  it("rechaza amount negativo → 400", async () => {
    const form = new FormData();
    form.append("image", makeImageBlob(), "comprobante.jpg");
    form.set("order_id", "orden-abc");
    form.set("method", "Zelle");
    form.set("amount", "-20");

    const res = await req("/payments/upload", { method: "POST", body: form });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /monto/i);
  });

  it("rechaza archivo no-imagen (text/plain) → 400", async () => {
    const form = new FormData();
    const textBlob = new Blob(["texto plano"], { type: "text/plain" });
    form.append("image", textBlob, "no-imagen.txt");
    form.set("order_id", "orden-abc");
    form.set("method", "Zelle");
    form.set("amount", "65");

    const res = await req("/payments/upload", { method: "POST", body: form });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /imagen/i);
  });

  it("rechaza amount no numérico (texto) → 400", async () => {
    const form = new FormData();
    form.append("image", makeImageBlob(), "comprobante.jpg");
    form.set("order_id", "orden-abc");
    form.set("method", "Zelle");
    form.set("amount", "abc");

    const res = await req("/payments/upload", { method: "POST", body: form });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /monto/i);
  });
});

// ---------------------------------------------------------------------------
// GET /payment-methods — métodos de pago disponibles (público)
// ---------------------------------------------------------------------------
describe("GET /api/payment-methods — métodos de pago", () => {
  it("responde con JSON (200 o error controlado — nunca crash)", async () => {
    const res = await req("/payment-methods");
    const body = await res.json();
    assert.ok([200, 500, 503].includes(res.status), `status inesperado: ${res.status}`);
    assert.ok(typeof body === "object");
  });

  it("Content-Type es application/json", async () => {
    const res = await req("/payment-methods");
    assert.ok(res.headers.get("content-type")?.includes("application/json"));
  });
});

// ---------------------------------------------------------------------------
// POST/PATCH/DELETE /payment-methods — requieren auth (fix de auditoría)
// ---------------------------------------------------------------------------
describe("Escritura en /api/payment-methods — requiere autenticación", () => {
  it("POST sin auth → 401", async () => {
    const res = await req("/payment-methods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method_name: "Test", instructions: "test" })
    });
    const body = await res.json();
    assert.equal(res.status, 401, `esperado 401, recibido ${res.status}: ${body.error}`);
  });

  it("PATCH sin auth → 401", async () => {
    const res = await req("/payment-methods/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: false })
    });
    const body = await res.json();
    assert.equal(res.status, 401, `esperado 401, recibido ${res.status}: ${body.error}`);
  });

  it("DELETE sin auth → 401", async () => {
    const res = await req("/payment-methods/1", { method: "DELETE" });
    const body = await res.json();
    assert.equal(res.status, 401, `esperado 401, recibido ${res.status}: ${body.error}`);
  });
});

// ---------------------------------------------------------------------------
// SSE /notifications/subscribe — sin auth (público)
// ---------------------------------------------------------------------------
describe("GET /api/notifications/subscribe — SSE público", () => {
  it("responde con Content-Type text/event-stream", async () => {
    const controller = new AbortController();
    const res = await req("/notifications/subscribe", {
      signal: controller.signal
    }).catch(() => null);

    if (res) {
      assert.ok(
        res.headers.get("content-type")?.includes("text/event-stream"),
        `Content-Type esperado text/event-stream, recibido: ${res.headers.get("content-type")}`
      );
    }
    controller.abort();
  });
});

// ---------------------------------------------------------------------------
// GET /notifications/stats — sin auth
// ---------------------------------------------------------------------------
describe("GET /api/notifications/stats — estadísticas SSE", () => {
  it("responde con JSON y campo connectedClients numérico", async () => {
    const res = await req("/notifications/stats");
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(typeof body.connectedClients === "number");
    assert.ok(typeof body.timestamp === "string");
  });
});

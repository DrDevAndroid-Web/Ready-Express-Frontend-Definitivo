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

async function postOrder(body) {
  return fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

// Orden base válida para construir variaciones negativas
const validBase = {
  items: [{ nombre: "Combo Pollo", precio: 15, cantidad: 2 }],
  total: 30,
  sender_name: "Juan Perez",
  sender_phone: "555-1234",
  receiver_name: "Maria Lopez",
  receiver_phone: "555-5678",
  customer_address: "Calle Ejemplo 123"
};

describe("POST /api/orders — validación de órdenes (normalizeOrderInput)", () => {
  it("rechaza body vacío — falta al menos un item", async () => {
    const res = await postOrder({});
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /item/i);
  });

  it("rechaza items vacíos (array vacío)", async () => {
    const res = await postOrder({ items: [] });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /item/i);
  });

  it("rechaza sin total — total inválido (undefined se convierte a NaN)", async () => {
    const { total, ...data } = validBase;
    const res = await postOrder(data);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /mayor que cero/i);
  });

  it("rechaza total igual a cero", async () => {
    const res = await postOrder({ ...validBase, total: 0 });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /mayor que cero/i);
  });

  it("rechaza total negativo", async () => {
    const res = await postOrder({ ...validBase, total: -15 });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /mayor que cero/i);
  });

  it("rechaza sin sender_name ni customer_name", async () => {
    const { sender_name, ...data } = validBase;
    const res = await postOrder(data);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /remitente/i);
  });

  it("rechaza sin sender_phone ni customer_phone", async () => {
    const { sender_phone, ...data } = validBase;
    const res = await postOrder(data);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /telefono/i);
  });

  it("rechaza sin receiver_name", async () => {
    const { receiver_name, ...data } = validBase;
    const res = await postOrder(data);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /receptor/i);
  });

  it("rechaza sin receiver_phone", async () => {
    const { receiver_phone, ...data } = validBase;
    const res = await postOrder(data);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /telefono/i);
  });

  it("rechaza sin customer_address", async () => {
    const { customer_address, ...data } = validBase;
    const res = await postOrder(data);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /direccion/i);
  });
});

describe("POST /api/orders — validación de items (normalizeItem)", () => {
  it("rechaza item sin nombre (nombre/name/item vacío o ausente)", async () => {
    const res = await postOrder({
      ...validBase,
      items: [{ precio: 10, cantidad: 1 }]
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /nombre/i);
  });

  it("rechaza item con nombre vacío string", async () => {
    const res = await postOrder({
      ...validBase,
      items: [{ nombre: "   ", precio: 10, cantidad: 1 }]
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /nombre/i);
  });

  it("rechaza item con precio negativo", async () => {
    const res = await postOrder({
      ...validBase,
      items: [{ nombre: "Combo X", precio: -5, cantidad: 1 }]
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /precio/i);
  });

  it("rechaza item con cantidad igual a cero", async () => {
    const res = await postOrder({
      ...validBase,
      items: [{ nombre: "Combo X", precio: 10, cantidad: 0 }]
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /cantidad/i);
  });

  it("rechaza item con cantidad negativa", async () => {
    const res = await postOrder({
      ...validBase,
      items: [{ nombre: "Combo X", precio: 10, cantidad: -1 }]
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /cantidad/i);
  });
});

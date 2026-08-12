import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generatePDF } from "../utils/pdf.js";

const baseOrder = {
  id: "order-test-abc123",
  customer_name: "Juan Perez",
  customer_email: "juan@example.com",
  customer_phone: "555-1234",
  customer_address: "Calle Ejemplo 123, Apto 4",
  receiver_name: "Maria Lopez",
  receiver_phone: "555-5678",
  delivery_notes: "Llamar antes de llegar",
  total: 45.50,
  status: "pending",
  created_at: "2024-01-15T10:30:00Z",
  items: [
    { nombre: "Combo Pollo", precio: 15.00, cantidad: 2, precio_total: 30.00 },
    { nombre: "Refresco Grande", precio: 2.75, cantidad: 2, precio_total: 5.50 },
    { nombre: "Postre", precio: 5.00, cantidad: 2, precio_total: 10.00 }
  ]
};

describe("generatePDF", () => {
  it("genera un Buffer que comienza con la firma PDF (%PDF)", async () => {
    const pdf = await generatePDF(baseOrder);
    assert.ok(Buffer.isBuffer(pdf), "el resultado debe ser un Buffer");
    assert.ok(pdf.length > 0, "el Buffer no debe estar vacío");
    assert.equal(pdf.toString("ascii", 0, 4), "%PDF", "el PDF debe comenzar con %PDF");
  });

  it("acepta items como JSON string y parsea sin lanzar", async () => {
    const order = { ...baseOrder, items: JSON.stringify(baseOrder.items) };
    const pdf = await generatePDF(order);
    assert.ok(Buffer.isBuffer(pdf));
    assert.equal(pdf.toString("ascii", 0, 4), "%PDF");
  });

  it("genera PDF válido cuando items es un array vacío", async () => {
    const order = { ...baseOrder, items: [] };
    const pdf = await generatePDF(order);
    assert.ok(Buffer.isBuffer(pdf));
    assert.equal(pdf.toString("ascii", 0, 4), "%PDF");
  });

  it("genera PDF válido cuando items es null (normaliza internamente)", async () => {
    const order = { ...baseOrder, items: null };
    const pdf = await generatePDF(order);
    assert.ok(Buffer.isBuffer(pdf));
    assert.equal(pdf.toString("ascii", 0, 4), "%PDF");
  });

  it("no lanza cuando total es un string numérico", async () => {
    const order = { ...baseOrder, total: "50.00" };
    const pdf = await generatePDF(order);
    assert.ok(Buffer.isBuffer(pdf));
    assert.equal(pdf.toString("ascii", 0, 4), "%PDF");
  });

  it("no lanza cuando faltan campos opcionales (email, delivery_notes, created_at)", async () => {
    const order = {
      id: "minimal-order",
      customer_name: "Cliente Minimo",
      customer_phone: "555-0000",
      customer_address: "Direccion Minima",
      receiver_name: "Receptor",
      receiver_phone: "555-1111",
      total: 10,
      status: "pending",
      items: [{ nombre: "Item Unico", precio: 10, cantidad: 1 }]
    };
    const pdf = await generatePDF(order);
    assert.ok(Buffer.isBuffer(pdf));
    assert.equal(pdf.toString("ascii", 0, 4), "%PDF");
  });
});

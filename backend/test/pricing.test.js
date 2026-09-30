import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCIsImlzcyI6InN1cGFiYXNlIn0",
  "test-signature"
].join(".");
process.env.SUPABASE_ANON_KEY ||= "anon-key";

const { priceItemsFromCatalog, candidateSources } = await import("../modules/orders/pricing.js");

// Catálogo simulado: Productos y Electrodomesticos comparten el id numérico 7
const CATALOG = {
  combo: [{ id: "combo-abc", nombre: "Combo Pollo", precio: 25, disponible: true, detalles: { "Pollo": "2 kg", "Arroz": 3 } }],
  producto: [
    { id: 7, nombre: "Aceite", precio: 4.5, disponible: true },
    { id: 8, nombre: "Café", precio: 6, disponible: false },
    { id: 9, nombre: "Consulta", precio: 0, disponible: true }
  ],
  electro: [{ id: 7, item: "Ventilador", tipo: "De pie", precio: 60, disponible: true }]
};
const fetchRows = async (source, ids) => CATALOG[source].filter(row => ids.includes(String(row.id)));
const price = items => priceItemsFromCatalog(items, { fetchRows });

describe("priceItemsFromCatalog — precios del servidor", () => {
  it("ignora el precio enviado por el navegador", async () => {
    const [item] = await price([{ id: "combo-abc", source: "combo", nombre: "Combo Pollo", precio: 0.01, cantidad: 2 }]);
    assert.equal(item.precio, 25);
    assert.equal(item.precio_total, 50);
  });

  it("toma los componentes del combo del catálogo, no del navegador", async () => {
    const [item] = await price([{ id: "combo-abc", source: "combo", nombre: "Combo Pollo", precio: 25, cantidad: 1, combo_items: [{ nombre: "iPhone", cantidad: 5 }] }]);
    assert.deepEqual(item.combo_items, [{ nombre: "Pollo", cantidad: 2 }, { nombre: "Arroz", cantidad: 3 }]);
  });

  it("distingue Productos y Electrodomesticos con el mismo id gracias a source", async () => {
    const [aceite, ventilador] = await price([
      { id: 7, source: "producto", nombre: "x", precio: 1, cantidad: 1 },
      { id: 7, source: "electro", nombre: "x", precio: 1, cantidad: 1 }
    ]);
    assert.equal(aceite.precio, 4.5);
    assert.equal(ventilador.precio, 60);
    assert.equal(ventilador.nombre, "Ventilador — De pie");
  });

  it("carrito antiguo sin source: resuelve la tabla verificando el nombre", async () => {
    const [ventilador] = await price([{ id: 7, category: "Productos Varios", nombre: "Ventilador — De pie", precio: 1, cantidad: 1 }]);
    assert.equal(ventilador.source, "electro");
    assert.equal(ventilador.precio, 60);
  });

  it("carrito antiguo con nombre que no coincide → pide actualizar el carrito", async () => {
    await assert.rejects(price([{ id: 7, nombre: "Televisor", precio: 1, cantidad: 1 }]), err => err.status === 400 && /catálogo/.test(err.message));
  });

  it("rechaza artículos no disponibles", async () => {
    await assert.rejects(price([{ id: 8, source: "producto", nombre: "Café", precio: 6, cantidad: 1 }]), err => err.status === 400 && /disponible/.test(err.message));
  });

  it("rechaza artículos sin precio en el catálogo", async () => {
    await assert.rejects(price([{ id: 9, source: "producto", nombre: "Consulta", precio: 10, cantidad: 1 }]), err => err.status === 400 && /precio/.test(err.message));
  });

  it("rechaza ids que no existen", async () => {
    await assert.rejects(price([{ id: "combo-falso", source: "combo", nombre: "Combo", precio: 1, cantidad: 1 }]), err => err.status === 400);
  });

  it("rechaza artículos sin id", async () => {
    await assert.rejects(price([{ nombre: "Algo", precio: 1, cantidad: 1 }]), err => err.status === 400 && /identificador/.test(err.message));
  });

  it("candidateSources: ids combo-* van a food_combos", () => {
    assert.deepEqual(candidateSources({ id: "combo-1" }).sources, ["combo"]);
  });
});

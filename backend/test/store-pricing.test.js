import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCIsImlzcyI6InN1cGFiYXNlIn0",
  "test-signature"
].join(".");
process.env.SUPABASE_ANON_KEY ||= "anon-key";

const { applyStoreMarkup, withStorePrices } = await import("../utils/store-pricing.js");
const { priceItemsFromCatalog } = await import("../modules/orders/pricing.js");
const { default: app } = await import("../app.js");

let server, baseUrl;
before(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const seven99 = { recargo_porcentaje: 7, redondeo: "centimos_99" };

describe("applyStoreMarkup — precio final de la tienda", () => {
  it("sin recargo no cambia nada (ni redondea)", () => {
    assert.equal(applyStoreMarkup(40, { recargo_porcentaje: 0, redondeo: "centimos_99" }), 40);
  });
  it("100 USD con 7 % y terminación ,99 → 107,99", () => {
    assert.equal(applyStoreMarkup(100, seven99), 107.99);
  });
  it("75,99 con 7 % → 81,31 → 81,99", () => {
    assert.equal(applyStoreMarkup(75.99, seven99), 81.99);
  });
  it("redondeo a entero siempre hacia arriba", () => {
    assert.equal(applyStoreMarkup(75.99, { recargo_porcentaje: 7, redondeo: "entero" }), 82);
    assert.equal(applyStoreMarkup(100, { recargo_porcentaje: 7, redondeo: "entero" }), 107);
  });
  it("sin redondeo: al céntimo superior", () => {
    assert.equal(applyStoreMarkup(75.99, { recargo_porcentaje: 7, redondeo: "ninguno" }), 81.31);
    assert.equal(applyStoreMarkup(10, { recargo_porcentaje: 6.5, redondeo: "ninguno" }), 10.65);
  });
  it("nunca baja del precio con recargo exacto", () => {
    for (const base of [1, 9.99, 18.99, 57, 123.45, 999.99]) {
      for (const redondeo of ["ninguno", "centimos_99", "entero"]) {
        assert.ok(applyStoreMarkup(base, { recargo_porcentaje: 7, redondeo }) >= base * 1.07 - 0.005, `${base} ${redondeo}`);
      }
    }
  });
  it("un recargo de entrega 0 (zona base) sigue en 0", () => {
    assert.equal(applyStoreMarkup(0, seven99), 0);
  });
  it("withStorePrices conserva el precio configurado en *_base", () => {
    const [row] = withStorePrices([{ id: 1, precio: "57.00" }], seven99);
    assert.equal(row.precio, 60.99);
    assert.equal(row.precio_base, 57);
    const [location] = withStorePrices([{ id: 2, recargo: 18.99 }], seven99, "recargo");
    assert.equal(location.recargo, 20.99);
    assert.equal(location.recargo_base, 18.99);
  });
});

describe("Pedido — cobra el mismo precio final que muestra la tienda", () => {
  const fetchRows = async () => [{ id: "combo-1", nombre: "Combo #12", precio: 57, detalles: {}, disponible: true }];
  it("aplica el recargo a cada artículo", async () => {
    const [item] = await priceItemsFromCatalog([{ id: "combo-1", source: "combo", nombre: "Combo #12", cantidad: 2 }], { fetchRows, pricing: seven99 });
    assert.equal(item.precio, 60.99);
    assert.equal(item.precio_total, 121.98);
  });
  it("sin configuración: precio del catálogo", async () => {
    const [item] = await priceItemsFromCatalog([{ id: "combo-1", source: "combo", nombre: "Combo #12", cantidad: 1 }], { fetchRows });
    assert.equal(item.precio, 57);
  });
});

describe("Rutas de configuración de precios", () => {
  for (const [method, path] of [["GET", "/api/admin/configuracion/precios"], ["PUT", "/api/admin/configuracion/precios"], ["GET", "/api/admin/reporte-tarifas"]]) {
    it(`${method} ${path} sin sesión → 401`, async () => {
      const res = await fetch(`${baseUrl}${path}`, { method });
      assert.equal(res.status, 401);
    });
  }
});

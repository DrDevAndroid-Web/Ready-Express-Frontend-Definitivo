import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCIsImlzcyI6InN1cGFiYXNlIn0",
  "test-signature"
].join(".");
process.env.SUPABASE_ANON_KEY ||= "anon-key";

const { normalizeFeatures, normalizeDescription } = await import("../modules/products/products.service.js");

describe("normalizeFeatures — características de electrodomésticos", () => {
  it("acepta el JSON que envía la APK y conserva el orden", () => {
    const raw = JSON.stringify([{ nombre: "Marca", valor: "LG" }, { nombre: " Capacidad ", valor: " 9 kg " }]);
    assert.deepEqual(normalizeFeatures(raw), [{ nombre: "Marca", valor: "LG" }, { nombre: "Capacidad", valor: "9 kg" }]);
  });

  it("convierte un objeto en lista y descarta filas sin nombre", () => {
    assert.deepEqual(normalizeFeatures({ Marca: "LG", "": "x" }), [{ nombre: "Marca", valor: "LG" }]);
    assert.deepEqual(normalizeFeatures([{ nombre: "", valor: "x" }]), []);
  });

  it("vacío o null → lista vacía", () => {
    assert.deepEqual(normalizeFeatures(""), []);
    assert.deepEqual(normalizeFeatures(null), []);
  });

  it("rechaza JSON inválido, tipos incorrectos y excesos", () => {
    assert.throws(() => normalizeFeatures("{no json"), { status: 400 });
    assert.throws(() => normalizeFeatures("5"), { status: 400 });
    assert.throws(() => normalizeFeatures(Array.from({ length: 31 }, (_, i) => ({ nombre: `c${i}`, valor: "v" }))), { status: 400 });
    assert.throws(() => normalizeFeatures([{ nombre: "x".repeat(61), valor: "v" }]), { status: 400 });
  });
});

describe("normalizeDescription", () => {
  it("recorta y guarda null si queda vacía", () => {
    assert.equal(normalizeDescription("  Nevera silenciosa  "), "Nevera silenciosa");
    assert.equal(normalizeDescription("   "), null);
  });

  it("rechaza textos de más de 2000 caracteres", () => {
    assert.throws(() => normalizeDescription("a".repeat(2001)), { status: 400 });
  });
});

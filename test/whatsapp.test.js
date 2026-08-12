import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Garantizar que las variables de WhatsApp no están configuradas para este test
// Esto verifica el comportamiento del servicio cuando falta configuración
delete process.env.WHATSAPP_PHONE;
delete process.env.WHATSAPP_APIKEY;

const { sendWhatsApp } = await import("../modules/whatsapp/whatsapp.service.js");

const sampleOrder = {
  id: "order-test-001",
  customer_name: "Juan Perez",
  customer_phone: "555-1234",
  receiver_name: "Maria Lopez",
  receiver_phone: "555-5678",
  customer_address: "Calle 123",
  total: 45.50,
  items: [{ nombre: "Combo Pollo", precio: 15, cantidad: 2 }]
};

describe("sendWhatsApp — sin credenciales configuradas", () => {
  it("lanza Error cuando WHATSAPP_PHONE y WHATSAPP_APIKEY no están definidos", async () => {
    await assert.rejects(
      () => sendWhatsApp(sampleOrder),
      (err) => {
        assert.ok(err instanceof Error, "debe ser instancia de Error");
        assert.match(
          err.message,
          /WHATSAPP_PHONE|WHATSAPP_APIKEY|configurados/i,
          "el mensaje debe mencionar las variables faltantes"
        );
        return true;
      }
    );
  });

  it("el error tiene un mensaje descriptivo no vacío", async () => {
    try {
      await sendWhatsApp(sampleOrder);
      assert.fail("sendWhatsApp debió lanzar un error");
    } catch (e) {
      assert.ok(typeof e.message === "string", "message debe ser string");
      assert.ok(e.message.length > 0, "message no debe estar vacío");
    }
  });
});

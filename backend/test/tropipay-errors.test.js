import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyCreateFailure, describeDecline, tropipayMinAmount } from "../modules/payments/tropipay-errors.js";
import { HttpError, sendError } from "../utils/http-error.js";

function fakeRes() {
  return { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

describe("tropipay-errors — clasificación", () => {
  it("mínimo por defecto 15 y configurable con TROPIPAY_MIN_AMOUNT", () => {
    const previous = process.env.TROPIPAY_MIN_AMOUNT;
    delete process.env.TROPIPAY_MIN_AMOUNT;
    assert.equal(tropipayMinAmount(), 15);
    process.env.TROPIPAY_MIN_AMOUNT = "20";
    assert.equal(tropipayMinAmount(), 20);
    if (previous === undefined) delete process.env.TROPIPAY_MIN_AMOUNT;
    else process.env.TROPIPAY_MIN_AMOUNT = previous;
  });

  it("errores reales de TropiPay producción", () => {
    assert.equal(classifyCreateFailure({ error: { code: "TOO_LOW_AMOUNT" } }).code, "CARD_MIN_AMOUNT");
    assert.equal(classifyCreateFailure({ error: { code: "INVALID_PARAMETERS", message: "Invalid amount" } }).code, "CARD_INVALID_AMOUNT");
    assert.equal(classifyCreateFailure({ error: { type: "VALIDATION_ERROR", code: "VALIDATION_ERROR", message: "Credential not found" } }).code, "CARD_UNAVAILABLE");
    assert.equal(classifyCreateFailure(null).status, 503);
  });

  it("motivos de rechazo de tarjeta", () => {
    const reason = text => describeDecline({ status: "KO", data: { errorReason: text } }).code;
    assert.equal(reason("Insufficient funds"), "CARD_INSUFFICIENT_FUNDS");
    assert.equal(reason("Card expired"), "CARD_EXPIRED");
    assert.equal(reason("3DS authentication failed"), "CARD_AUTHENTICATION_FAILED");
    assert.equal(reason("Security code mismatch"), "CARD_SECURITY_CODE");
    assert.equal(reason("Declined"), "CARD_DECLINED");
    assert.equal(reason("algo desconocido"), "CARD_PAYMENT_FAILED");
  });
});

describe("sendError — campos expuestos", () => {
  it("incluye `expose` también en 5xx de un HttpError propio", () => {
    const err = new HttpError(503, "No disponible");
    err.expose = { code: "CARD_UNAVAILABLE", payment_id: "tx-1" };
    const res = fakeRes();
    const originalError = console.error;
    console.error = () => {};
    try { sendError(res, err); } finally { console.error = originalError; }
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { error: "No disponible", code: "CARD_UNAVAILABLE", payment_id: "tx-1" });
  });

  it("un Error genérico no expone nada aunque tenga la propiedad", () => {
    const err = Object.assign(new Error("interno"), { status: 500, expose: { code: "X" } });
    const res = fakeRes();
    const originalError = console.error;
    console.error = () => {};
    try { sendError(res, err); } finally { console.error = originalError; }
    assert.deepEqual(res.body, { error: "Error interno del servidor" });
  });
});

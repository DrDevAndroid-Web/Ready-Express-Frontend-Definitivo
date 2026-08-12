import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HttpError,
  badRequest,
  notFound,
  conflict,
  sendError,
  throwIfSupabaseError
} from "../utils/http-error.js";

describe("HttpError", () => {
  it("hereda de Error y tiene status y details", () => {
    const err = new HttpError(418, "soy una tetera", { info: "extra" });
    assert.ok(err instanceof Error);
    assert.ok(err instanceof HttpError);
    assert.equal(err.message, "soy una tetera");
    assert.equal(err.status, 418);
    assert.deepEqual(err.details, { info: "extra" });
    assert.equal(err.name, "HttpError");
  });

  it("details es null por defecto", () => {
    const err = new HttpError(400, "error");
    assert.equal(err.details, null);
  });
});

describe("throwIfSupabaseError PGRST116", () => {
  it("lanza HttpError 404 cuando Supabase no devuelve filas", () => {
    try {
      throwIfSupabaseError({
        code: "PGRST116",
        message: "Cannot coerce the result to a single JSON object",
        details: "The result contains 0 rows"
      }, "No se encontro el registro");
      assert.fail("debio lanzar");
    } catch (e) {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 404);
      assert.equal(e.message, "No se encontro el registro");
      assert.equal(e.details.code, "PGRST116");
    }
  });
});

describe("helpers de creación", () => {
  it("badRequest devuelve HttpError con status 400", () => {
    const err = badRequest("campo inválido");
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 400);
    assert.equal(err.message, "campo inválido");
  });

  it("notFound devuelve HttpError con status 404", () => {
    const err = notFound("no encontrado");
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 404);
  });

  it("conflict devuelve HttpError con status 409", () => {
    const err = conflict("ya existe");
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 409);
  });

  it("acepta details como segundo argumento", () => {
    const err = badRequest("error con detalles", { campo: "nombre" });
    assert.deepEqual(err.details, { campo: "nombre" });
  });
});

describe("sendError", () => {
  function makeFakeRes() {
    const res = { statusCode: null, jsonBody: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.jsonBody = body; };
    return res;
  }

  it("usa el status del HttpError para responder", () => {
    const res = makeFakeRes();
    sendError(res, badRequest("campo inválido"));
    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonBody.error, "campo inválido");
  });

  it("usa 500 cuando el error no tiene status", () => {
    const res = makeFakeRes();
    sendError(res, new Error("error genérico"));
    assert.equal(res.statusCode, 500);
    assert.equal(res.jsonBody.error, "error genérico");
  });

  it("incluye details en el JSON cuando existen", () => {
    const res = makeFakeRes();
    sendError(res, badRequest("error con detalles", { campo: "nombre" }));
    assert.deepEqual(res.jsonBody.details, { campo: "nombre" });
  });

  it("no incluye la clave details cuando son null", () => {
    const res = makeFakeRes();
    sendError(res, badRequest("sin detalles"));
    assert.equal("details" in res.jsonBody, false);
  });

  it("llama console.error para errores con status >= 500", () => {
    const res = makeFakeRes();
    const captured = [];
    const original = console.error;
    console.error = (...args) => captured.push(args);
    try {
      sendError(res, new Error("error interno"));
    } finally {
      console.error = original;
    }
    assert.ok(captured.length > 0, "console.error debió ser llamado");
  });

  it("no llama console.error para errores < 500", () => {
    const res = makeFakeRes();
    const captured = [];
    const original = console.error;
    console.error = (...args) => captured.push(args);
    try {
      sendError(res, badRequest("error 400"));
    } finally {
      console.error = original;
    }
    assert.equal(captured.length, 0);
  });
});

describe("throwIfSupabaseError", () => {
  it("no lanza si error es null", () => {
    assert.doesNotThrow(() => throwIfSupabaseError(null));
  });

  it("no lanza si error es undefined", () => {
    assert.doesNotThrow(() => throwIfSupabaseError(undefined));
  });

  it("lanza HttpError 403 para código RLS 42501", () => {
    try {
      throwIfSupabaseError({ code: "42501" });
      assert.fail("debió lanzar");
    } catch (e) {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 403);
    }
  });

  it("incluye el código en details para error RLS", () => {
    try {
      throwIfSupabaseError({ code: "42501", hint: "usar service_role" });
      assert.fail("debió lanzar");
    } catch (e) {
      assert.equal(e.details.code, "42501");
    }
  });

  it("lanza HttpError 500 para errores genéricos de Supabase", () => {
    try {
      throwIfSupabaseError({ message: "connection failed" });
      assert.fail("debió lanzar");
    } catch (e) {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 500);
      assert.equal(e.message, "connection failed");
    }
  });
});

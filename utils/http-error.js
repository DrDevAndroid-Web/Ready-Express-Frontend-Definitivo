export class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

// Response helpers (with res parameter)
export function success(res, data, status = 200) {
  return res.status(status).json({ data });
}

export function created(res, data) {
  return res.status(201).json({ data });
}

export function sendError(res, err, fallback = "Error interno del servidor") {
  const status = Number.isInteger(err?.status) ? err.status : 500;
  if (status >= 500) {
    console.error("[api:error]", err);
  }

  return res.status(status).json({
    error: err?.message || fallback,
    ...(err?.details ? { details: err.details } : {})
  });
}

// Error creators (for throwing, no res parameter)
export function createBadRequest(message, details = null) {
  return new HttpError(400, message, details);
}

export function createUnauthorized(message = "No autorizado", details = null) {
  return new HttpError(401, message, details);
}

export function createNotFound(message, details = null) {
  return new HttpError(404, message, details);
}

export function createConflict(message, details = null) {
  return new HttpError(409, message, details);
}

export function createClientClosedRequest(message, details = null) {
  return new HttpError(499, message, details);
}

// Response wrappers (for returning with res)
export function badRequest(res, message, details = null) {
  const err = createBadRequest(message, details);
  return sendError(res, err);
}

export function unauthorized(res, message = "No autorizado", details = null) {
  const err = createUnauthorized(message, details);
  return sendError(res, err);
}

export function notFound(res, message, details = null) {
  const err = createNotFound(message, details);
  return sendError(res, err);
}

export function conflict(res, message, details = null) {
  const err = createConflict(message, details);
  return sendError(res, err);
}

export function clientClosedRequest(res, message, details = null) {
  const err = createClientClosedRequest(message, details);
  return sendError(res, err);
}

export function throwIfSupabaseError(error, message = "Error en Supabase") {
  if (!error) return;

  if (error.code === "PGRST116") {
    throw new HttpError(
      404,
      message,
      {
        code: error.code,
        hint: error.hint,
        details: error.details
      }
    );
  }

  if (error.code === "42501") {
    throw new HttpError(
      403,
      "Permiso denegado por Supabase RLS. Verifica que SUPABASE_SERVICE_ROLE_KEY sea la service_role key en el backend desplegado",
      {
        code: error.code,
        hint: error.hint,
        details: error.details
      }
    );
  }

  throw new HttpError(500, error.message || message, {
    code: error.code,
    hint: error.hint,
    details: error.details
  });
}

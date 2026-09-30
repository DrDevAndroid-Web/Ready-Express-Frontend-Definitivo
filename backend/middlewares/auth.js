import { supabase, supabaseAuth } from "../config/supabase.js";

export async function requireSupabaseUser(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [, token] = header.match(/^Bearer\s+(.+)$/i) || [];

    if (!token) {
      return res.status(401).json({ error: "Sesion requerida" });
    }

    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: "Sesion invalida o expirada" });
    }

    req.user = data.user;
    next();
  } catch (err) {
    res.status(401).json({ error: err.message || "No autorizado" });
  }
}

export async function optionalSupabaseUser(req, _res, next) {
  try {
    const header = req.headers.authorization || "";
    const [, token] = header.match(/^Bearer\s+(.+)$/i) || [];
    if (token) {
      const { data } = await supabaseAuth.auth.getUser(token);
      if (data?.user) req.user = data.user;
    }
  } catch { /* el checkout invitado continúa sin identidad */ }
  next();
}

export const ADMIN_ROLES = ["admin", "operador"];

export async function getUserRoles(userId) {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw error;
  return (data || []).map(item => item.role);
}

// EventSource del navegador no permite headers: acepta ?access_token= como alternativa al Bearer.
export function tokenFromQuery(req, _res, next) {
  const token = typeof req.query.access_token === "string" ? req.query.access_token.trim() : "";
  if (token && !req.headers.authorization) req.headers.authorization = `Bearer ${token}`;
  next();
}

export function requireRoles(...allowedRoles) {
  return async (req, res, next) => {
    try {
      if (!req.user?.id) return res.status(401).json({ error: "Sesion requerida" });
      const roles = await getUserRoles(req.user.id);
      if (!roles.some(role => allowedRoles.includes(role))) return res.status(403).json({ error: "No tienes permisos para esta operación" });
      req.userRoles = roles;
      next();
    } catch (error) {
      res.status(500).json({ error: error.message || "No se pudo validar el rol" });
    }
  };
}

export const requireAdmin = requireRoles(...ADMIN_ROLES);
export const requireDeliveryOperator = requireRoles("admin", "operador", "repartidor");

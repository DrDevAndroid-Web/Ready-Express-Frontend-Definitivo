import { supabaseAuth } from "../config/supabase.js";

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

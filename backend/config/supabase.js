import { createClient } from "@supabase/supabase-js";
import { HttpError } from "../utils/http-error.js";

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export const supabaseKeyInfo = getSupabaseKeyInfo(process.env.SUPABASE_SERVICE_ROLE_KEY);

console.info("[supabase:config]", {
  ref: supabaseKeyInfo.ref || "desconocido",
  role: supabaseKeyInfo.role || "desconocido",
  serviceRole: supabaseKeyInfo.isServiceRole
});

if (!supabaseKeyInfo.isServiceRole) {
  console.error(
    "[supabase:config] SUPABASE_SERVICE_ROLE_KEY no tiene rol service_role. " +
    "Las escrituras administrativas pueden fallar por RLS."
  );
}

export function assertSupabaseServiceRole() {
  if (supabaseKeyInfo.isServiceRole) return;

  throw new HttpError(
    500,
    "SUPABASE_SERVICE_ROLE_KEY no esta configurada como service_role en el backend",
    {
      role: supabaseKeyInfo.role || "desconocido",
      fix: "Configura en el hosting la service_role key de Supabase, no la anon public key"
    }
  );
}

function getSupabaseKeyInfo(key = "") {
  try {
    const [, payload] = String(key).split(".");
    if (!payload) return { isServiceRole: false, role: null };

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));

    return {
      isServiceRole: decoded.role === "service_role",
      role: decoded.role || null,
      ref: decoded.ref || null
    };
  } catch {
    return { isServiceRole: false, role: null };
  }
}

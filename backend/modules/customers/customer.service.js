import { supabase, supabaseAuth } from "../../config/supabase.js";
import { HttpError, createBadRequest, createConflict, createNotFound, throwIfSupabaseError } from "../../utils/http-error.js";
import { parseBirthDate, parseCountryIso } from "../../utils/billing.js";

// Columnas de 20260930_customer_billing_profile.sql
export const BILLING_COLUMNS = ["pais_iso", "direccion_facturacion", "ciudad", "estado_region", "codigo_postal", "fecha_nacimiento", "terminos_tropipay_at"];
export const PAYMENT_PREFERENCE_TABLE = "customer_payment_preferences";
export const CARD_PAYMENT_PREFERENCE = "tropipay";

export function normalizePaymentPreferences(input) {
  const values = Array.isArray(input) ? input : input == null ? [] : [input];
  const unique = [...new Set(values.map(value => String(value || "").trim().toLowerCase()).filter(Boolean))];
  if (!unique.length) throw createBadRequest("Selecciona al menos un método de pago");
  if (unique.some(value => !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(value))) {
    throw createBadRequest("Hay un método de pago no válido");
  }
  if (unique.includes(CARD_PAYMENT_PREFERENCE) && process.env.CARD_PAYMENTS_ENABLED !== "true") {
    throw createBadRequest("El pago con tarjeta no está disponible temporalmente");
  }
  return unique.slice(0, 20);
}

// Datos de facturación para TropiPay: se piden en el registro para no repetirlos en cada pago
export function normalizeBilling(input = {}) {
  if (input.acepta_terminos_tropipay !== true && input.acepta_terminos_tropipay !== "on" && input.acepta_terminos_tropipay !== "true") {
    throw createBadRequest("Debes aceptar los terminos y condiciones de TropiPay");
  }
  return {
    pais_iso: parseCountryIso(input.pais_iso, "El pais de residencia es requerido"),
    direccion_facturacion: requireText(input.direccion_facturacion, "La direccion de facturacion es requerida"),
    ciudad: requireText(input.ciudad, "La ciudad es requerida"),
    estado_region: optionalText(input.estado_region),
    codigo_postal: requireText(input.codigo_postal, "El codigo postal es requerido"),
    fecha_nacimiento: parseBirthDate(input.fecha_nacimiento),
    terminos_tropipay_at: new Date().toISOString()
  };
}

// Página de la tienda a la que lleva el enlace de confirmación del email. Debe estar en
// Supabase → Authentication → Redirect URLs; si no, Supabase usa la Site URL.
export function emailConfirmationRedirectUrl() {
  if (process.env.FRONTEND_EMAIL_CONFIRM_URL) return process.env.FRONTEND_EMAIL_CONFIRM_URL;
  const site = String(process.env.FRONTEND_PUBLIC_URL || "https://www.readyexpressnow.com").replace(/\/$/, "");
  return `${site}/cuenta-confirmada.html`;
}

// Dirección de entrega que el cliente ya escribió en el checkout. Opcional: sin alias o
// dirección no se guarda nada.
export function normalizeDeliveryAddress(input) {
  if (!input || typeof input !== "object") return null;
  const direccion = optionalText(input.direccion);
  if (!direccion) return null;
  return {
    alias: optionalText(input.alias) || "Entrega principal",
    direccion,
    provincia: optionalText(input.provincia),
    municipio: optionalText(input.municipio),
    referencia: optionalText(input.referencia),
    telefono_contacto: optionalText(input.telefono_contacto),
    es_predeterminada: true
  };
}

export async function registerCustomer({ email, password, confirm_password, nombre, apellidos, telefono = null, documento_identidad = null, direccion_entrega = null, preferred_payment_methods = [], device_id: _deviceId, ...billingInput }) {
  const normalizedEmail = requireText(email, "El email es requerido").toLowerCase();
  const normalizedPassword = requireText(password, "La contraseña es requerida");
  const firstName = requireText(nombre, "El nombre es requerido");
  const lastName = requireText(apellidos, "Los apellidos son requeridos");

  if (normalizedPassword.length < 8) {
    throw createBadRequest("La contraseña debe tener al menos 8 caracteres");
  }
  if (String(confirm_password || "") !== normalizedPassword) {
    throw createBadRequest("Las contraseñas no coinciden");
  }
  const preferredMethods = normalizePaymentPreferences(preferred_payment_methods);
  // La facturación solo es obligatoria cuando el método tarjeta está habilitado y seleccionado.
  const billing = preferredMethods.includes(CARD_PAYMENT_PREFERENCE) ? normalizeBilling(billingInput) : {};

  const { data: authData, error: authError } = await supabaseAuth.auth.signUp({
    email: normalizedEmail,
    password: normalizedPassword,
    options: { data: {}, emailRedirectTo: emailConfirmationRedirectUrl() }
  });

  if (authError) {
    if (/already registered|already exists|duplicate/i.test(authError.message || "")) {
      throw createConflict("Ya existe una cuenta con ese email");
    }
    throw authError;
  }

  const user = authData?.user;
  if (!user?.id) throw new Error("Supabase no devolvió el usuario creado");
  // Con la confirmación de email activa, Supabase no da error si el email ya existe:
  // devuelve el usuario sin identidades
  if (Array.isArray(user.identities) && user.identities.length === 0) {
    throw createConflict("Ya existe una cuenta con ese email");
  }

  const profileRow = {
    auth_user_id: user.id,
    nombre: firstName,
    apellidos: lastName,
    email: normalizedEmail,
    telefono: optionalText(telefono),
    documento_identidad: optionalText(documento_identidad),
    ...billing
  };
  let { data: profile, error: profileError } = await supabase.from("customer_profiles").insert(profileRow).select().single();

  // Red de seguridad si el backend se despliega antes que 20260930_customer_billing_profile.sql
  if (profileError?.code === "PGRST204" && BILLING_COLUMNS.some(column => profileError.message?.includes(column))) {
    console.error("[customers] Falta la migración de facturación; el perfil se guarda sin esos datos");
    BILLING_COLUMNS.forEach(column => delete profileRow[column]);
    ({ data: profile, error: profileError } = await supabase.from("customer_profiles").insert(profileRow).select().single());
  }

  throwIfSupabaseError(profileError, "No se pudo crear el perfil del cliente");

  const { error: preferencesError } = await supabase.from(PAYMENT_PREFERENCE_TABLE).upsert({
    customer_id: profile.id,
    preferred_methods: preferredMethods,
    updated_at: new Date().toISOString()
  }, { onConflict: "customer_id" });
  if (preferencesError?.code === "PGRST205" || preferencesError?.code === "42P01") {
    console.warn("[customers] Falta la migración de preferencias de pago; se continúa con el registro");
  } else {
    throwIfSupabaseError(preferencesError, "No se pudieron guardar las preferencias de pago");
  }

  const { error: roleError } = await supabase
    .from("user_roles")
    .insert({ user_id: user.id, role: "cliente" });

  throwIfSupabaseError(roleError, "No se pudo asignar el rol del cliente");

  // Sin sesión (falta confirmar el email) el frontend no puede guardarla: se guarda aquí.
  // Un fallo no impide el registro; el cliente puede añadirla en "Mi cuenta".
  const address = normalizeDeliveryAddress(direccion_entrega);
  let savedAddress = null;
  if (address) {
    const { data, error } = await supabase.from("customer_addresses").insert({ ...address, customer_id: profile.id }).select().single();
    if (error) console.warn("[customers:register] No se guardó la dirección de entrega:", error.message);
    else savedAddress = data;
  }

  return {
    user: { id: user.id, email: user.email },
    profile,
    address: savedAddress,
    access_token: authData.session?.access_token || null,
    refresh_token: authData.session?.refresh_token || null,
    email_confirmation_required: !authData.session
  };
}

// Reenvía el email de confirmación. Responde igual exista o no la cuenta (no revela emails).
export async function resendConfirmationEmail(email) {
  const normalizedEmail = requireText(email, "El email es requerido").toLowerCase();
  const { error } = await supabaseAuth.auth.resend({
    type: "signup",
    email: normalizedEmail,
    options: { emailRedirectTo: emailConfirmationRedirectUrl() }
  });
  if (error) {
    if (error.status === 429 || /rate limit|security purposes/i.test(error.message || "")) {
      throw new HttpError(429, "Ya enviamos un email hace poco. Espera un minuto e inténtalo de nuevo.");
    }
    console.warn("[customers:resend]", error.message);
  }
  return { message: "Si la cuenta está pendiente de confirmar, te enviamos un nuevo enlace." };
}

// Código de confirmación ({{ .Token }} en la plantilla "Confirm signup"): el cliente lo
// escribe en la tienda y queda confirmado y con sesión, sin salir de la página.
export function normalizeEmailCode(code) {
  const digits = String(code ?? "").replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 10) throw createBadRequest("Escribe el código de 6 dígitos que te enviamos por email");
  return digits;
}

export async function verifyEmailCode(email, code, auth = supabaseAuth) {
  const normalizedEmail = requireText(email, "El email es requerido").toLowerCase();
  const token = normalizeEmailCode(code);
  // "email" es el tipo actual; "signup" cubre servidores de Auth más antiguos
  let { data, error } = await auth.auth.verifyOtp({ email: normalizedEmail, token, type: "email" });
  if (error && !data?.session) ({ data, error } = await auth.auth.verifyOtp({ email: normalizedEmail, token, type: "signup" }));
  if (error || !data?.session) {
    if (error?.status === 429 || /rate limit|security purposes/i.test(error?.message || "")) {
      throw new HttpError(429, "Demasiados intentos. Espera un minuto e inténtalo de nuevo.");
    }
    throw createBadRequest("El código no es correcto o ya caducó. Revísalo o pide uno nuevo.");
  }
  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    user: data.user ? { id: data.user.id, email: data.user.email } : null
  };
}

export async function getCustomerProfile(userId) {
  const { data, error } = await supabase
    .from("customer_profiles")
    .select("*")
    .eq("auth_user_id", userId)
    .maybeSingle();

  throwIfSupabaseError(error, "No se pudo cargar el perfil");
  if (!data) throw createNotFound("Perfil de cliente no encontrado");
  return data;
}

export async function getPaymentPreferences(userId) {
  const customerId = await getCustomerId(userId);
  const { data, error } = await supabase.from(PAYMENT_PREFERENCE_TABLE).select("preferred_methods,updated_at").eq("customer_id", customerId).maybeSingle();
  if (error?.code === "PGRST205" || error?.code === "42P01") return { preferred_methods: [], card_enabled: process.env.CARD_PAYMENTS_ENABLED === "true" };
  throwIfSupabaseError(error, "No se pudieron cargar las preferencias de pago");
  return { preferred_methods: data?.preferred_methods || [], updated_at: data?.updated_at || null, card_enabled: process.env.CARD_PAYMENTS_ENABLED === "true" };
}

export async function updatePaymentPreferences(userId, input = {}) {
  const customerId = await getCustomerId(userId);
  const preferredMethods = normalizePaymentPreferences(input.preferred_payment_methods);
  const { data, error } = await supabase.from(PAYMENT_PREFERENCE_TABLE).upsert({
    customer_id: customerId,
    preferred_methods: preferredMethods,
    updated_at: new Date().toISOString()
  }, { onConflict: "customer_id" }).select("preferred_methods,updated_at").single();
  throwIfSupabaseError(error, "No se pudieron guardar las preferencias de pago");
  return { ...data, card_enabled: process.env.CARD_PAYMENTS_ENABLED === "true" };
}

export async function updateCustomerProfile(userId, input = {}) {
  const patch = {};
  if (input.nombre !== undefined) patch.nombre = requireText(input.nombre, "El nombre es requerido");
  if (input.apellidos !== undefined) patch.apellidos = requireText(input.apellidos, "Los apellidos son requeridos");
  if (input.telefono !== undefined) patch.telefono = optionalText(input.telefono);
  if (input.documento_identidad !== undefined) patch.documento_identidad = optionalText(input.documento_identidad);
  // Los datos de facturación se actualizan juntos (TropiPay los necesita completos)
  if (input.pais_iso !== undefined) Object.assign(patch, normalizeBilling(input));
  if (!Object.keys(patch).length) throw createBadRequest("No hay datos de perfil para actualizar");
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("customer_profiles")
    .update(patch)
    .eq("auth_user_id", userId)
    .select()
    .single();

  throwIfSupabaseError(error, "No se pudo actualizar el perfil");
  return data;
}

async function getCustomerId(userId) {
  const { data, error } = await supabase.from("customer_profiles").select("id").eq("auth_user_id", userId).single();
  throwIfSupabaseError(error, "No se pudo cargar el perfil del cliente");
  return data.id;
}

export async function listCustomerAddresses(userId) {
  const customerId = await getCustomerId(userId);
  const { data, error } = await supabase.from("customer_addresses").select("*").eq("customer_id", customerId).order("es_predeterminada", { ascending: false }).order("created_at", { ascending: true });
  throwIfSupabaseError(error, "No se pudieron cargar tus direcciones");
  return data || [];
}

export async function createCustomerAddress(userId, input = {}) {
  const customerId = await getCustomerId(userId);
  const alias = requireText(input.alias, "El alias de la dirección es requerido");
  const direccion = requireText(input.direccion, "La dirección es requerida");
  const payload = { customer_id: customerId, alias, direccion, provincia: optionalText(input.provincia), municipio: optionalText(input.municipio), referencia: optionalText(input.referencia), telefono_contacto: optionalText(input.telefono_contacto), es_predeterminada: Boolean(input.es_predeterminada) };
  if (payload.es_predeterminada) await supabase.from("customer_addresses").update({ es_predeterminada: false }).eq("customer_id", customerId);
  const { data, error } = await supabase.from("customer_addresses").insert(payload).select().single();
  throwIfSupabaseError(error, "No se pudo guardar la dirección");
  return data;
}

export async function updateCustomerAddress(userId, addressId, input = {}) {
  const customerId = await getCustomerId(userId);
  const patch = {};
  if (input.alias !== undefined) patch.alias = requireText(input.alias, "El alias de la dirección es requerido");
  if (input.direccion !== undefined) patch.direccion = requireText(input.direccion, "La dirección es requerida");
  for (const key of ["provincia", "municipio", "referencia", "telefono_contacto"]) if (input[key] !== undefined) patch[key] = optionalText(input[key]);
  if (input.es_predeterminada !== undefined) patch.es_predeterminada = Boolean(input.es_predeterminada);
  if (patch.es_predeterminada) await supabase.from("customer_addresses").update({ es_predeterminada: false }).eq("customer_id", customerId).neq("id", addressId);
  const { data, error } = await supabase.from("customer_addresses").update(patch).eq("id", addressId).eq("customer_id", customerId).select().single();
  throwIfSupabaseError(error, "No se pudo actualizar la dirección");
  return data;
}

export async function deleteCustomerAddress(userId, addressId) {
  const customerId = await getCustomerId(userId);
  const { error } = await supabase.from("customer_addresses").delete().eq("id", addressId).eq("customer_id", customerId);
  throwIfSupabaseError(error, "No se pudo eliminar la dirección");
  return { ok: true };
}

function requireText(value, message) {
  const text = String(value ?? "").trim();
  if (!text) throw createBadRequest(message);
  return text;
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

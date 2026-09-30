import { supabase, supabaseAuth } from "../../config/supabase.js";
import { createBadRequest, createConflict, createNotFound, throwIfSupabaseError } from "../../utils/http-error.js";

export async function registerCustomer({ email, password, nombre, apellidos, telefono = null, documento_identidad = null }) {
  const normalizedEmail = requireText(email, "El email es requerido").toLowerCase();
  const normalizedPassword = requireText(password, "La contraseña es requerida");
  const firstName = requireText(nombre, "El nombre es requerido");
  const lastName = requireText(apellidos, "Los apellidos son requeridos");

  if (normalizedPassword.length < 8) {
    throw createBadRequest("La contraseña debe tener al menos 8 caracteres");
  }

  const { data: authData, error: authError } = await supabaseAuth.auth.signUp({
    email: normalizedEmail,
    password: normalizedPassword,
    options: { data: {} }
  });

  if (authError) {
    if (/already registered|already exists|duplicate/i.test(authError.message || "")) {
      throw createConflict("Ya existe una cuenta con ese email");
    }
    throw authError;
  }

  const user = authData?.user;
  if (!user?.id) throw new Error("Supabase no devolvió el usuario creado");

  const { data: profile, error: profileError } = await supabase
    .from("customer_profiles")
    .insert({
      auth_user_id: user.id,
      nombre: firstName,
      apellidos: lastName,
      email: normalizedEmail,
      telefono: optionalText(telefono),
      documento_identidad: optionalText(documento_identidad)
    })
    .select()
    .single();

  throwIfSupabaseError(profileError, "No se pudo crear el perfil del cliente");

  const { error: roleError } = await supabase
    .from("user_roles")
    .insert({ user_id: user.id, role: "cliente" });

  throwIfSupabaseError(roleError, "No se pudo asignar el rol del cliente");

  return {
    user: { id: user.id, email: user.email },
    profile,
    access_token: authData.session?.access_token || null,
    refresh_token: authData.session?.refresh_token || null,
    email_confirmation_required: !authData.session
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

export async function updateCustomerProfile(userId, input = {}) {
  const patch = {};
  if (input.nombre !== undefined) patch.nombre = requireText(input.nombre, "El nombre es requerido");
  if (input.apellidos !== undefined) patch.apellidos = requireText(input.apellidos, "Los apellidos son requeridos");
  if (input.telefono !== undefined) patch.telefono = optionalText(input.telefono);
  if (input.documento_identidad !== undefined) patch.documento_identidad = optionalText(input.documento_identidad);
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

import { supabase } from "../../../config/supabase.js";
import { throwIfSupabaseError } from "../../../utils/http-error.js";

export function list(table) { return supabase.from(table).select("*"); }
export function listPublic(table, columns) { return supabase.from(table).select(columns).eq("disponible", true); }
export async function insert(table, payload, message) { const { data, error } = await supabase.from(table).insert(payload).select(); throwIfSupabaseError(error, message); return data; }
export async function update(table, id, payload, message) { const { data, error } = await supabase.from(table).update(payload).eq("id", id).select(); throwIfSupabaseError(error, message); return data; }
export async function remove(table, id, message) { const { error } = await supabase.from(table).delete().eq("id", id); throwIfSupabaseError(error, message); }
export async function imageUrl(table, id, message) { const { data, error } = await supabase.from(table).select("img").eq("id", id).maybeSingle(); throwIfSupabaseError(error, message); return data?.img || null; }
export async function idExists(table, id, message) { const { data, error } = await supabase.from(table).select("id").eq("id", id).maybeSingle(); throwIfSupabaseError(error, message); return Boolean(data); }
export async function nextId(table, message) { const { data, error } = await supabase.from(table).select("id").order("id", { ascending: false }).limit(1).maybeSingle(); throwIfSupabaseError(error, message); return Number(data?.id || 0) + 1; }
export async function getInfo() { const { data, error } = await supabase.from("informacion_cambiante").select("*"); return { data, error }; }
export async function getPaymentMethods() { const { data, error } = await supabase.from("payment_methods").select("*").eq("is_active", true).order("order_index", { ascending: true }); if (error) return []; return data || []; }

import { supabase } from "../../../config/supabase.js";
import { compressImage } from "../../../utils/image.js";
import { throwIfSupabaseError } from "../../../utils/http-error.js";

function pathFromPublicUrl(url, bucket) { if (!url) return null; try { const parsed = new URL(url); const marker = `/storage/v1/object/public/${bucket}/`; const index = parsed.pathname.indexOf(marker); return index === -1 ? null : decodeURIComponent(parsed.pathname.slice(index + marker.length)); } catch { return null; } }
export async function replaceImage(id, currentUrl, bucket, file) { await removeImage(currentUrl, bucket); const compressed = await compressImage(file.buffer); const filename = `${String(id).trim()}.jpg`; const { error } = await supabase.storage.from(bucket).upload(filename, compressed, { contentType: "image/jpeg", upsert: true }); throwIfSupabaseError(error, `No se pudo subir la imagen a ${bucket}`); const { data } = supabase.storage.from(bucket).getPublicUrl(filename); return data.publicUrl; }
export async function removeImage(url, bucket) { const path = pathFromPublicUrl(url, bucket); if (!path) return; const { error } = await supabase.storage.from(bucket).remove([path]); if (error) console.warn(`[storage] No se pudo borrar imagen anterior (${bucket}/${path}):`, error.message); }

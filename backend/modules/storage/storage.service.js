import { supabase } from "../../config/supabase.js";
import { throwIfSupabaseError } from "../../utils/http-error.js";

export async function uploadImage(buffer, filename) {
  const { data, error } = await supabase.storage
    .from("payments")
    .upload(filename, buffer, {
      contentType: "image/jpeg",
      upsert: false
    });

  throwIfSupabaseError(error, "No se pudo subir la imagen del comprobante");

  // El bucket es privado: se guarda la ruta y se sirve con URLs firmadas temporales
  return data.path;
}

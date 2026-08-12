import { supabase } from "../../config/supabase.js";
import { throwIfSupabaseError } from "../../utils/http-error.js";

export async function uploadImage(buffer, filename) {
  const { data, error } = await supabase.storage
    .from("payments")
    .upload(filename, buffer, {
      contentType: "image/jpeg",
      upsert: true
    });

  throwIfSupabaseError(error, "No se pudo subir la imagen del comprobante");

  const { data: publicUrl } = supabase.storage
    .from("payments")
    .getPublicUrl(data.path);

  return publicUrl.publicUrl;
}

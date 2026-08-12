import { assertSupabaseServiceRole, supabase } from "../../config/supabase.js";
import { compressImage } from "../../utils/image.js";
import { createBadRequest, createNotFound, throwIfSupabaseError } from "../../utils/http-error.js";

const COMBOS_BUCKET = "combos-comida";
const PRODUCTOS_BUCKET = "porductos-variados";
const ELECTRO_BUCKET = "Electrodomesticos";
const COMBO_CATEGORY = "combo";

export async function getFoodCombos() {
  return supabase.from("food_combos").select("*");
}

export async function createFoodCombo(combo, file) {
  assertSupabaseServiceRole();
  const nombre = requireText(combo.nombre, "El nombre del combo es requerido");
  const precio = requireNumber(combo.precio, "El precio del combo debe ser un numero valido");
  const id = createCompactId("combo");
  const insert = {
    id,
    nombre,
    categoria: COMBO_CATEGORY,
    precio,
    detalles: combo.detalles || {},
    disponible: combo.disponible
  };

  const { data, error } = await supabase
    .from("food_combos")
    .insert(insert)
    .select();

  throwIfSupabaseError(error, "No se pudo crear el combo");
  const created = getSingleRow(data, "No se pudo crear el combo");

  if (!file) return created;

  const img = await replaceStorageImage(created.id, null, COMBOS_BUCKET, file);
  const { data: updated, error: updateError } = await supabase
    .from("food_combos")
    .update({ img })
    .eq("id", created.id)
    .select();

  throwIfSupabaseError(updateError, "No se pudo guardar la imagen del combo");
  return getSingleRow(updated, "No se pudo guardar la imagen del combo");
}

export async function deleteFoodCombo(id) {
  assertSupabaseServiceRole();
  const { error } = await supabase
    .from("food_combos")
    .delete()
    .eq("id", id);

  if (error) throw error;
  return { message: "Combo eliminado" };
}

export async function updateFoodCombo(id, combo, file) {
  assertSupabaseServiceRole();
  const comboId = requireText(id, "El id del combo es requerido");
  const nombre = requireText(combo.nombre, "El nombre del combo es requerido");
  const precio = requireNumber(combo.precio, "El precio del combo debe ser un numero valido");
  const updates = {
    nombre,
    categoria: COMBO_CATEGORY,
    precio,
    detalles: combo.detalles || {},
    disponible: combo.disponible
  };

  if (file) {
    const oldImagePath = getStoragePathFromPublicUrl(combo.imagenActual, COMBOS_BUCKET);
    if (oldImagePath) {
      const { error: removeError } = await supabase.storage
        .from(COMBOS_BUCKET)
        .remove([oldImagePath]);

      if (removeError) console.warn(`[storage] No se pudo borrar imagen anterior (${COMBOS_BUCKET}/${oldImagePath}):`, removeError.message);
    }

    const compressedImage = await compressImage(file.buffer);
    const filename = `${comboId}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from(COMBOS_BUCKET)
      .upload(filename, compressedImage, {
        contentType: "image/jpeg",
        upsert: true
      });

    throwIfSupabaseError(uploadError, "No se pudo subir la imagen del combo");

    const { data: publicUrl } = supabase.storage
      .from(COMBOS_BUCKET)
      .getPublicUrl(filename);

    updates.img = publicUrl.publicUrl;
  }

  const { data, error } = await supabase
    .from("food_combos")
    .update(updates)
    .eq("id", comboId)
    .select();

  throwIfSupabaseError(error, "No se pudo actualizar el combo");
  return getSingleRow(data, "No se encontro el combo para actualizar");
}

function getStoragePathFromPublicUrl(url, bucket) {
  if (!url) return null;

  try {
    const parsedUrl = new URL(url);
    const marker = `/storage/v1/object/public/${bucket}/`;
    const markerIndex = parsedUrl.pathname.indexOf(marker);

    if (markerIndex === -1) return null;

    const path = parsedUrl.pathname.slice(markerIndex + marker.length);
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

export async function getProductos() {
  return supabase.from("Productos").select("*");
}

export async function createProducto(producto, file) {
  assertSupabaseServiceRole();
  const nombre = requireText(producto.nombre, "El nombre del producto es requerido");
  const id = await createCompactNumericId("Productos");
  const insert = {
    id,
    nombre,
    precio: nullableNumber(producto.precio, "El precio del producto debe ser un numero valido"),
    cantidad: nullableNumber(producto.cantidad, "La cantidad debe ser un numero valido"),
    disponible: producto.disponible,
    categoria: optionalText(producto.categoria),
    email: producto.email,
    detalles: producto.detalles
  };

  const { data, error } = await supabase
    .from("Productos")
    .insert(insert)
    .select();

  throwIfSupabaseError(error, "No se pudo crear el producto");
  const created = getSingleRow(data, "No se pudo crear el producto");
  if (!file) return created;

  const img = await replaceStorageImage(created.id, null, PRODUCTOS_BUCKET, file);
  const { data: updated, error: updateError } = await supabase
    .from("Productos")
    .update({ img })
    .eq("id", created.id)
    .select();

  throwIfSupabaseError(updateError, "No se pudo guardar la imagen del producto");
  return getSingleRow(updated, "No se pudo guardar la imagen del producto");
}

export async function deleteProducto(id) {
  assertSupabaseServiceRole();
  const { error } = await supabase
    .from("Productos")
    .delete()
    .eq("id", id);

  if (error) throw error;
  return { message: "Producto eliminado" };
}

export async function updateProducto(id, producto, file) {
  assertSupabaseServiceRole();
  const productId = requireText(id, "El id del producto es requerido");
  const nombre = requireText(producto.nombre, "El nombre del producto es requerido");
  const updates = {
    nombre,
    precio: nullableNumber(producto.precio, "El precio del producto debe ser un numero valido"),
    cantidad: nullableNumber(producto.cantidad, "La cantidad debe ser un numero valido"),
    disponible: producto.disponible,
    categoria: optionalText(producto.categoria),
    email: producto.email,
    detalles: producto.detalles
  };

  if (file) {
    updates.img = await replaceStorageImage(productId, producto.imagenActual, PRODUCTOS_BUCKET, file);
  }

  const { data, error } = await supabase
    .from("Productos")
    .update(updates)
    .eq("id", productId)
    .select();

  throwIfSupabaseError(error, "No se pudo actualizar el producto");
  return getSingleRow(data, "No se encontro el producto para actualizar");
}

export async function getElectrodomesticos() {
  return supabase.from("Electrodomesticos").select("*");
}

export async function createElectrodomestico(electrodomestico, file) {
  assertSupabaseServiceRole();
  const item = requireText(electrodomestico.item, "El item del electrodomestico es requerido");
  const id = await createCompactNumericId("Electrodomesticos");
  const insert = {
    id,
    item,
    tipo: electrodomestico.tipo,
    precio: electrodomestico.precio,
    disponible: electrodomestico.disponible
  };

  const { data, error } = await supabase
    .from("Electrodomesticos")
    .insert(insert)
    .select();

  throwIfSupabaseError(error, "No se pudo crear el electrodomestico");
  const created = getSingleRow(data, "No se pudo crear el electrodomestico");
  if (!file) return created;

  const img = await replaceStorageImage(created.id, null, ELECTRO_BUCKET, file);
  const { data: updated, error: updateError } = await supabase
    .from("Electrodomesticos")
    .update({ img })
    .eq("id", created.id)
    .select();

  throwIfSupabaseError(updateError, "No se pudo guardar la imagen del electrodomestico");
  return getSingleRow(updated, "No se pudo guardar la imagen del electrodomestico");
}

export async function deleteElectrodomestico(id) {
  assertSupabaseServiceRole();
  const { error } = await supabase
    .from("Electrodomesticos")
    .delete()
    .eq("id", id);

  if (error) throw error;
  return { message: "Electrodomestico eliminado" };
}

export async function updateElectrodomestico(id, electrodomestico, file) {
  assertSupabaseServiceRole();
  const electroId = requireText(id, "El id del electrodomestico es requerido");
  const item = requireText(electrodomestico.item, "El item del electrodomestico es requerido");
  const updates = {
    item,
    tipo: electrodomestico.tipo,
    precio: electrodomestico.precio,
    disponible: electrodomestico.disponible
  };

  if (file) {
    updates.img = await replaceStorageImage(electroId, electrodomestico.imagenActual, ELECTRO_BUCKET, file);
  }

  const { data, error } = await supabase
    .from("Electrodomesticos")
    .update(updates)
    .eq("id", electroId)
    .select();

  throwIfSupabaseError(error, "No se pudo actualizar el electrodomestico");
  return getSingleRow(data, "No se encontro el electrodomestico para actualizar");
}

export async function getInfo() {
  const { data: info, error: infoError } = await supabase.from("informacion_cambiante").select("*");

  if (infoError) {
    return { error: infoError };
  }

  let paymentMethods = [];
  try {
    const { data: methods } = await supabase
      .from("payment_methods")
      .select("*")
      .eq("is_active", true)
      .order("order_index", { ascending: true });

    paymentMethods = methods || [];
  } catch (err) {
    console.warn("No payment_methods table found, skipping...");
  }

  return {
    data: {
      ...info?.[0],
      payment_methods: paymentMethods
    }
  };
}

async function replaceStorageImage(id, currentUrl, bucket, file) {
  const oldImagePath = getStoragePathFromPublicUrl(currentUrl, bucket);
  if (oldImagePath) {
    const { error: removeError } = await supabase.storage
      .from(bucket)
      .remove([oldImagePath]);

    if (removeError) console.warn(`[storage] No se pudo borrar imagen anterior (${bucket}/${oldImagePath}):`, removeError.message);
  }

  const compressedImage = await compressImage(file.buffer);
  const filename = `${String(id).trim()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(filename, compressedImage, {
      contentType: "image/jpeg",
      upsert: true
    });

  throwIfSupabaseError(uploadError, `No se pudo subir la imagen a ${bucket}`);

  const { data: publicUrl } = supabase.storage
    .from(bucket)
    .getPublicUrl(filename);

  return publicUrl.publicUrl;
}

function createCompactId(prefix) {
  return `${prefix}-${Date.now().toString(36)}`;
}

function requireText(value, message) {
  const text = String(value ?? "").trim();
  if (!text) throw createBadRequest(message);
  return text;
}

function requireNumber(value, message) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw createBadRequest(message);
  return number;
}

function nullableNumber(value, message) {
  if (value === "" || value === null || value === undefined) return null;
  return requireNumber(value, message);
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function getSingleRow(data, message) {
  if (Array.isArray(data) && data.length === 1) return data[0];
  if (Array.isArray(data) && data.length === 0) throw createNotFound(message);
  if (Array.isArray(data)) throw createBadRequest(message, { rows: data.length });
  if (data) return data;
  throw createNotFound(message);
}

async function createCompactNumericId(table) {
  const base = Number(String(Date.now()).slice(-9));
  for (let offset = 0; offset < 100; offset += 1) {
    const candidate = base + offset;
    const exists = await idExists(table, candidate);
    if (!exists) return candidate;
  }

  const fallback = await getNextNumericId(table);
  return fallback;
}

async function idExists(table, id) {
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .maybeSingle();

  throwIfSupabaseError(error, `No se pudo verificar el id para ${table}`);
  return Boolean(data);
}

async function getNextNumericId(table) {
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  throwIfSupabaseError(error, `No se pudo calcular el proximo id para ${table}`);
  return Number(data?.id || 0) + 1;
}

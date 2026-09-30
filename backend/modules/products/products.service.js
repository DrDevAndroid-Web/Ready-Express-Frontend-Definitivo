import { assertSupabaseServiceRole } from "../../config/supabase.js";
import { createBadRequest, createNotFound } from "../../utils/http-error.js";
import * as catalogRepository from "./adapters/supabase-catalog.repository.js";
import * as catalogStorage from "./adapters/supabase-catalog.storage.js";

const COMBOS_BUCKET = "combos-comida";
const PRODUCTOS_BUCKET = "porductos-variados";
const ELECTRO_BUCKET = "Electrodomesticos";
const COMBO_CATEGORY = "combo";

export function getFoodCombos() { return catalogRepository.list("food_combos"); }

export async function createFoodCombo(combo, file) {
  assertSupabaseServiceRole();
  const id = createCompactId("combo");
  const created = getSingleRow(await catalogRepository.insert("food_combos", { id, nombre: requireText(combo.nombre, "El nombre del combo es requerido"), categoria: COMBO_CATEGORY, precio: requireNumber(combo.precio, "El precio del combo debe ser un numero valido"), detalles: combo.detalles || {}, disponible: combo.disponible }, "No se pudo crear el combo"), "No se pudo crear el combo");
  if (!file) return created;
  const img = await catalogStorage.replaceImage(created.id, null, COMBOS_BUCKET, file);
  return getSingleRow(await catalogRepository.update("food_combos", created.id, { img }, "No se pudo guardar la imagen del combo"), "No se pudo guardar la imagen del combo");
}

export async function deleteFoodCombo(id) {
  assertSupabaseServiceRole();
  const image = await catalogRepository.imageUrl("food_combos", id, "No se pudo localizar la imagen del combo");
  await catalogRepository.remove("food_combos", id, "No se pudo eliminar el combo");
  await catalogStorage.removeImage(image, COMBOS_BUCKET);
  return { message: "Combo eliminado" };
}

export async function updateFoodCombo(id, combo, file) {
  assertSupabaseServiceRole();
  const comboId = requireText(id, "El id del combo es requerido");
  const updates = { nombre: requireText(combo.nombre, "El nombre del combo es requerido"), categoria: COMBO_CATEGORY, precio: requireNumber(combo.precio, "El precio del combo debe ser un numero valido"), detalles: combo.detalles || {}, disponible: combo.disponible };
  if (file) updates.img = await catalogStorage.replaceImage(comboId, combo.imagenActual, COMBOS_BUCKET, file);
  return getSingleRow(await catalogRepository.update("food_combos", comboId, updates, "No se pudo actualizar el combo"), "No se encontro el combo para actualizar");
}

export function getProductos() { return catalogRepository.list("Productos"); }

export async function createProducto(producto, file) {
  assertSupabaseServiceRole();
  const id = await createCompactNumericId("Productos");
  const created = getSingleRow(await catalogRepository.insert("Productos", { id, nombre: requireText(producto.nombre, "El nombre del producto es requerido"), precio: nullableNumber(producto.precio, "El precio del producto debe ser un numero valido"), cantidad: nullableNumber(producto.cantidad, "La cantidad debe ser un numero valido"), disponible: producto.disponible, categoria: optionalText(producto.categoria), email: producto.email, detalles: producto.detalles }, "No se pudo crear el producto"), "No se pudo crear el producto");
  if (!file) return created;
  const img = await catalogStorage.replaceImage(created.id, null, PRODUCTOS_BUCKET, file);
  return getSingleRow(await catalogRepository.update("Productos", created.id, { img }, "No se pudo guardar la imagen del producto"), "No se pudo guardar la imagen del producto");
}

export async function deleteProducto(id) {
  assertSupabaseServiceRole();
  const image = await catalogRepository.imageUrl("Productos", id, "No se pudo localizar la imagen del producto");
  await catalogRepository.remove("Productos", id, "No se pudo eliminar el producto");
  await catalogStorage.removeImage(image, PRODUCTOS_BUCKET);
  return { message: "Producto eliminado" };
}

export async function updateProducto(id, producto, file) {
  assertSupabaseServiceRole();
  const productId = requireText(id, "El id del producto es requerido");
  const updates = { nombre: requireText(producto.nombre, "El nombre del producto es requerido"), precio: nullableNumber(producto.precio, "El precio del producto debe ser un numero valido"), cantidad: nullableNumber(producto.cantidad, "La cantidad debe ser un numero valido"), disponible: producto.disponible, categoria: optionalText(producto.categoria), email: producto.email, detalles: producto.detalles };
  if (file) updates.img = await catalogStorage.replaceImage(productId, producto.imagenActual, PRODUCTOS_BUCKET, file);
  return getSingleRow(await catalogRepository.update("Productos", productId, updates, "No se pudo actualizar el producto"), "No se encontro el producto para actualizar");
}

export function getElectrodomesticos() { return catalogRepository.list("Electrodomesticos"); }

export async function getPublicCatalog() {
  const [combos, productos, electrodomesticos] = await Promise.all([
    catalogRepository.listPublic("food_combos", "id,nombre,categoria,precio,detalles,img,disponible"),
    catalogRepository.listPublic("Productos", "id,nombre,precio,categoria,detalles,img,disponible"),
    catalogRepository.listPublic("Electrodomesticos", "id,item,tipo,precio,img,disponible")
  ]);
  const results = [combos, productos, electrodomesticos];
  results.forEach(result => { if (result.error) throw result.error; });
  return {
    combos: combos.data || [],
    productos: productos.data || [],
    electrodomesticos: electrodomesticos.data || []
  };
}

export async function createElectrodomestico(electro, file) {
  assertSupabaseServiceRole();
  const id = await createCompactNumericId("Electrodomesticos");
  const created = getSingleRow(await catalogRepository.insert("Electrodomesticos", { id, item: requireText(electro.item, "El item del electrodomestico es requerido"), tipo: electro.tipo, precio: electro.precio, disponible: electro.disponible }, "No se pudo crear el electrodomestico"), "No se pudo crear el electrodomestico");
  if (!file) return created;
  const img = await catalogStorage.replaceImage(created.id, null, ELECTRO_BUCKET, file);
  return getSingleRow(await catalogRepository.update("Electrodomesticos", created.id, { img }, "No se pudo guardar la imagen del electrodomestico"), "No se pudo guardar la imagen del electrodomestico");
}

export async function deleteElectrodomestico(id) {
  assertSupabaseServiceRole();
  const image = await catalogRepository.imageUrl("Electrodomesticos", id, "No se pudo localizar la imagen del electrodomestico");
  await catalogRepository.remove("Electrodomesticos", id, "No se pudo eliminar el electrodomestico");
  await catalogStorage.removeImage(image, ELECTRO_BUCKET);
  return { message: "Electrodomestico eliminado" };
}

export async function updateElectrodomestico(id, electro, file) {
  assertSupabaseServiceRole();
  const electroId = requireText(id, "El id del electrodomestico es requerido");
  const updates = { item: requireText(electro.item, "El item del electrodomestico es requerido"), tipo: electro.tipo, precio: electro.precio, disponible: electro.disponible };
  if (file) updates.img = await catalogStorage.replaceImage(electroId, electro.imagenActual, ELECTRO_BUCKET, file);
  return getSingleRow(await catalogRepository.update("Electrodomesticos", electroId, updates, "No se pudo actualizar el electrodomestico"), "No se encontro el electrodomestico para actualizar");
}

export async function getInfo() {
  const { data: info, error } = await catalogRepository.getInfo();
  if (error) return { error };
  // tropipay_enabled: el checkout solo ofrece TropiPay si el backend tiene credenciales
  const tropipayEnabled = Boolean(process.env.TROPIPAY_CLIENT_ID && process.env.TROPIPAY_CLIENT_SECRET);
  return { data: { ...info?.[0], payment_methods: await catalogRepository.getPaymentMethods(), tropipay_enabled: tropipayEnabled } };
}

function createCompactId(prefix) { return `${prefix}-${Date.now().toString(36)}`; }
function requireText(value, message) { const text = String(value ?? "").trim(); if (!text) throw createBadRequest(message); return text; }
function requireNumber(value, message) { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw createBadRequest(message); return number; }
function nullableNumber(value, message) { return value === "" || value === null || value === undefined ? null : requireNumber(value, message); }
function optionalText(value) { const text = String(value ?? "").trim(); return text || null; }
function getSingleRow(data, message) { if (Array.isArray(data) && data.length === 1) return data[0]; if (Array.isArray(data) && data.length === 0) throw createNotFound(message); if (Array.isArray(data)) throw createBadRequest(message, { rows: data.length }); if (data) return data; throw createNotFound(message); }
async function createCompactNumericId(table) { const base = Number(String(Date.now()).slice(-9)); for (let offset = 0; offset < 100; offset += 1) if (!await catalogRepository.idExists(table, base + offset, `No se pudo verificar el id para ${table}`)) return base + offset; return catalogRepository.nextId(table, `No se pudo calcular el proximo id para ${table}`); }

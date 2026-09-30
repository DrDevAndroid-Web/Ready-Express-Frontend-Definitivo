import * as service from "./products.service.js";
import { createBadRequest, sendError } from "../../utils/http-error.js";
import { getCached, invalidateCache, PUBLIC_CACHE_KEYS, sendPublicJson } from "../../utils/public-cache.js";
import { withStorePrices } from "../../utils/store-pricing.js";
import { getPricingSettings } from "../settings/pricing-settings.service.js";
import { ADMIN_ROLES, getUserRoles } from "../../middlewares/auth.js";

// La tienda ve el precio final (con recargo). La APK y el dashboard piden ?precios=base
// para editar el precio configurado; solo se atiende a administradores.
async function wantsBasePrices(req) {
  if (req.query.precios !== "base" || !req.user?.id) return false;
  const roles = await getUserRoles(req.user.id).catch(() => []);
  return roles.some(role => ADMIN_ROLES.includes(role));
}

async function sendCatalogRows(req, res, rows, cacheOptions) {
  if (await wantsBasePrices(req)) {
    res.set("Cache-Control", "private, no-store");
    return res.json(rows);
  }
  return sendPublicJson(req, res, withStorePrices(rows, await getPricingSettings()), cacheOptions);
}

function parseDetails(value) {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("detalles debe ser un objeto JSON");
    }
    return parsed;
  } catch {
    throw createBadRequest("El campo detalles debe contener un JSON valido");
  }
}

export async function createFoodCombo(req, res) {
  try {
    const detalles = parseDetails(req.body.detalles);
    const combo = {
      nombre: req.body.nombre,
      precio: req.body.precio,
      detalles,
      disponible: req.body.disponible === "true" || req.body.disponible === true
    };

    const result = await service.createFoodCombo(combo, req.file);
    invalidateCache(PUBLIC_CACHE_KEYS.catalog, PUBLIC_CACHE_KEYS.foodCombos);
    res.status(201).json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function getFoodCombos(req, res) {
  try {
    const { data, error } = await getCached(PUBLIC_CACHE_KEYS.foodCombos, async () => {
      const result = await service.getFoodCombos();
      if (result.error) throw result.error;
      return result;
    }, 60_000);
    if (error) throw error;
    await sendCatalogRows(req, res, data || [], { maxAge: 60, staleWhileRevalidate: 300 });
  } catch (err) {
    sendError(res, err);
  }
}

export async function deleteFoodCombo(req, res) {
  try {
    const result = await service.deleteFoodCombo(req.params.id);
    invalidateCache(PUBLIC_CACHE_KEYS.catalog, PUBLIC_CACHE_KEYS.foodCombos);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function updateFoodCombo(req, res) {
  try {
    const detalles = parseDetails(req.body.detalles);
    const combo = {
      nombre: req.body.nombre,
      precio: req.body.precio,
      detalles,
      disponible: req.body.disponible === "true" || req.body.disponible === true,
      imagenActual: req.body.imagen_actual
    };

    const result = await service.updateFoodCombo(req.params.id, combo, req.file);
    invalidateCache(PUBLIC_CACHE_KEYS.catalog, PUBLIC_CACHE_KEYS.foodCombos);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function createProducto(req, res) {
  try {
    const producto = {
      nombre: req.body.nombre,
      precio: req.body.precio,
      cantidad: req.body.cantidad,
      disponible: req.body.disponible === "true" || req.body.disponible === true,
      categoria: req.body.categoria,
      email: req.body.email,
      detalles: req.body.detalles
    };

    const result = await service.createProducto(producto, req.file);
    invalidateCache(PUBLIC_CACHE_KEYS.catalog, PUBLIC_CACHE_KEYS.products);
    res.status(201).json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function getProductos(req, res) {
  try {
    const { data, error } = await getCached(PUBLIC_CACHE_KEYS.products, async () => {
      const result = await service.getProductos();
      if (result.error) throw result.error;
      return result;
    }, 60_000);
    if (error) throw error;
    await sendCatalogRows(req, res, data ?? [], { maxAge: 60, staleWhileRevalidate: 300 });
  } catch (err) {
    sendError(res, err);
  }
}

export async function deleteProducto(req, res) {
  try {
    const result = await service.deleteProducto(req.params.id);
    invalidateCache(PUBLIC_CACHE_KEYS.catalog, PUBLIC_CACHE_KEYS.products);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function updateProducto(req, res) {
  try {
    const producto = {
      nombre: req.body.nombre,
      precio: req.body.precio,
      cantidad: req.body.cantidad,
      disponible: req.body.disponible === "true" || req.body.disponible === true,
      categoria: req.body.categoria,
      email: req.body.email,
      detalles: req.body.detalles,
      imagenActual: req.body.imagen_actual
    };

    const result = await service.updateProducto(req.params.id, producto, req.file);
    invalidateCache(PUBLIC_CACHE_KEYS.catalog, PUBLIC_CACHE_KEYS.products);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function createElectro(req, res) {
  try {
    const electrodomestico = {
      item: req.body.item,
      tipo: req.body.tipo,
      precio: req.body.precio,
      disponible: req.body.disponible === "true" || req.body.disponible === true
    };

    const result = await service.createElectrodomestico(electrodomestico, req.file);
    invalidateCache(PUBLIC_CACHE_KEYS.catalog, PUBLIC_CACHE_KEYS.appliances);
    res.status(201).json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function getElectro(req, res) {
  try {
    const { data, error } = await getCached(PUBLIC_CACHE_KEYS.appliances, async () => {
      const result = await service.getElectrodomesticos();
      if (result.error) throw result.error;
      return result;
    }, 60_000);
    if (error) throw error;
    await sendCatalogRows(req, res, data ?? [], { maxAge: 60, staleWhileRevalidate: 300 });
  } catch (err) {
    sendError(res, err);
  }
}

export async function getCatalog(req, res) {
  try {
    const catalog = await getCached(PUBLIC_CACHE_KEYS.catalog, service.getPublicCatalog, 60_000);
    const settings = await getPricingSettings();
    sendPublicJson(req, res, {
      ...catalog,
      combos: withStorePrices(catalog.combos, settings),
      productos: withStorePrices(catalog.productos, settings),
      electrodomesticos: withStorePrices(catalog.electrodomesticos, settings)
    }, { maxAge: 60, staleWhileRevalidate: 300 });
  } catch (err) {
    sendError(res, err);
  }
}

export async function deleteElectro(req, res) {
  try {
    const result = await service.deleteElectrodomestico(req.params.id);
    invalidateCache(PUBLIC_CACHE_KEYS.catalog, PUBLIC_CACHE_KEYS.appliances);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function updateElectro(req, res) {
  try {
    const electrodomestico = {
      item: req.body.item,
      tipo: req.body.tipo,
      precio: req.body.precio,
      disponible: req.body.disponible === "true" || req.body.disponible === true,
      imagenActual: req.body.imagen_actual
    };

    const result = await service.updateElectrodomestico(req.params.id, electrodomestico, req.file);
    invalidateCache(PUBLIC_CACHE_KEYS.catalog, PUBLIC_CACHE_KEYS.appliances);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function getInfo(req, res) {
  try {
    const { data, error } = await getCached(PUBLIC_CACHE_KEYS.info, async () => {
      const result = await service.getInfo();
      if (result.error) throw result.error;
      return result;
    }, 300_000);
    if (error) throw error;
    sendPublicJson(req, res, data ?? [], { maxAge: 300, staleWhileRevalidate: 600 });
  } catch (err) {
    sendError(res, err);
  }
}

import * as service from "./products.service.js";
import { sendError } from "../../utils/http-error.js";

export async function createFoodCombo(req, res) {
  try {
    const detalles = JSON.parse(req.body.detalles || "{}");
    const combo = {
      nombre: req.body.nombre,
      precio: req.body.precio,
      detalles,
      disponible: req.body.disponible === "true" || req.body.disponible === true
    };

    const result = await service.createFoodCombo(combo, req.file);
    res.status(201).json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function getFoodCombos(req, res) {
  try {
    const { data, error } = await service.getFoodCombos();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
}

export async function deleteFoodCombo(req, res) {
  try {
    const result = await service.deleteFoodCombo(req.params.id);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function updateFoodCombo(req, res) {
  try {
    const detalles = JSON.parse(req.body.detalles || "{}");
    const combo = {
      nombre: req.body.nombre,
      precio: req.body.precio,
      detalles,
      disponible: req.body.disponible === "true" || req.body.disponible === true,
      imagenActual: req.body.imagen_actual
    };

    const result = await service.updateFoodCombo(req.params.id, combo, req.file);
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
    res.status(201).json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function getProductos(req, res) {
  try {
    const { data, error } = await service.getProductos();
    if (error) throw error;
    res.json(data ?? []);
  } catch (err) {
    sendError(res, err);
  }
}

export async function deleteProducto(req, res) {
  try {
    const result = await service.deleteProducto(req.params.id);
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
    res.status(201).json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function getElectro(req, res) {
  try {
    const { data, error } = await service.getElectrodomesticos();
    if (error) throw error;
    res.json(data ?? []);
  } catch (err) {
    sendError(res, err);
  }
}

export async function deleteElectro(req, res) {
  try {
    const result = await service.deleteElectrodomestico(req.params.id);
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
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function getInfo(req, res) {
  try {
    const { data, error } = await service.getInfo();
    if (error) throw error;
    res.json(data ?? []);
  } catch (err) {
    sendError(res, err);
  }
}

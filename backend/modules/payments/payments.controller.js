import { processPayment, getPendingPayments, getApprovedPayments, getApprovedPaymentImageUrl, deleteApprovedPayment, verifyPayment } from "./payments.service.js";
import { sendError } from "../../utils/http-error.js";
import { getOrderAccess } from "../orders/orders.controller.js";

function pagination(query) {
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
  return { limit, offset };
}

export async function uploadPayment(req, res) {
  try {
    // Sin multipart (petición mal formada) multer no rellena req.body
    const { order_id, method, amount } = req.body || {};
    const result = await processPayment(
      req.file,
      order_id,
      method,
      Number(amount),
      await getOrderAccess(req)
    );
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function getPendingPaymentsController(req, res) {
  try {
    console.info("[payments:pending] consultando pagos pendientes", {
      user: req.user?.email || req.user?.id || "unknown"
    });
    const { limit, offset } = pagination(req.query);
    const result = await getPendingPayments(limit, offset);
    console.info("[payments:pending] pagos pendientes cargados", {
      count: Array.isArray(result) ? result.length : 0
    });
    res.json(result);
  } catch (err) {
    console.error("[payments:pending] error cargando pagos pendientes", err);
    sendError(res, err);
  }
}

export async function getApprovedPaymentsController(req, res) {
  try {
    console.info("[payments:approved] consultando pagos aprobados", {
      user: req.user?.email || req.user?.id || "unknown"
    });
    const { limit, offset } = pagination(req.query);
    const result = await getApprovedPayments(limit, offset, { includeImage: req.query.include_image !== "false" });
    console.info("[payments:approved] pagos aprobados cargados", {
      count: Array.isArray(result) ? result.length : 0
    });
    res.json(result);
  } catch (err) {
    console.error("[payments:approved] error cargando pagos aprobados", err);
    sendError(res, err);
  }
}

export async function getApprovedPaymentImageController(req, res) {
  try {
    res.json(await getApprovedPaymentImageUrl(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
}

export async function deleteApprovedPaymentController(req, res) {
  try {
    res.json(await deleteApprovedPayment(req.params.id, req.body?.confirmation));
  } catch (err) {
    sendError(res, err);
  }
}

export async function verifyPaymentController(req, res) {
  try {
    const { id } = req.params;
    const { action } = req.body; // "approve" o "reject"
    const result = await verifyPayment(id, action);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

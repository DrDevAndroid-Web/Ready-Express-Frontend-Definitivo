import { processPayment, getPendingPayments, getApprovedPayments, verifyPayment } from "./payments.service.js";
import { sendError } from "../../utils/http-error.js";

export async function uploadPayment(req, res) {
  try {
    const { order_id, method, amount } = req.body;
    const result = await processPayment(
      req.file,
      order_id,
      method,
      Number(amount)
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
    const result = await getPendingPayments();
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
    const result = await getApprovedPayments();
    console.info("[payments:approved] pagos aprobados cargados", {
      count: Array.isArray(result) ? result.length : 0
    });
    res.json(result);
  } catch (err) {
    console.error("[payments:approved] error cargando pagos aprobados", err);
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

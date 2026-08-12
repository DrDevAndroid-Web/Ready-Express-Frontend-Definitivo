import { createOrder, cancelOrder } from "./orders.service.js";
import { assertSupabaseServiceRole, supabase, supabaseKeyInfo } from "../../config/supabase.js";
import { sendError, throwIfSupabaseError } from "../../utils/http-error.js";
import { getPaymentImageUrl } from "../payments/payments.service.js";

export async function createOrderController(req, res) {
  try {
    const order = await createOrder(req.body);
    res.json(order);
  } catch (err) {
    sendError(res, err);
  }
}

export async function cancelOrderController(req, res) {
  try {
    const { id } = req.params;
    const result = await cancelOrder(id);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function getOrdersController(req, res) {
  try {
    assertSupabaseServiceRole();
    const { data: orders, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    throwIfSupabaseError(error, "No se pudieron cargar las ordenes");
    await logOrderDiagnosticsIfEmpty(orders);

    const orderIds = (orders ?? []).map(order => order.id).filter(Boolean);
    if (!orderIds.length) {
      res.json(orders ?? []);
      return;
    }

    const { data: payments, error: paymentsError } = await supabase
      .from("payments")
      .select("id, order_id, method, amount, image_url, validation_status, created_at")
      .in("order_id", orderIds)
      .order("created_at", { ascending: false });

    throwIfSupabaseError(paymentsError, "No se pudieron cargar los pagos de las ordenes");

    const paymentsByOrder = new Map();
    (payments ?? []).forEach(payment => {
      const list = paymentsByOrder.get(payment.order_id) ?? [];
      list.push({
        ...payment,
        image_url: getPaymentImageUrl(payment.image_url)
      });
      paymentsByOrder.set(payment.order_id, list);
    });

    res.json((orders ?? []).map(order => ({
      ...order,
      payments: paymentsByOrder.get(order.id) ?? []
    })));
  } catch (err) {
    sendError(res, err);
  }
}

async function logOrderDiagnosticsIfEmpty(orders) {
  if ((orders ?? []).length) return;

  const { count: total, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true });

  console.warn("[orders:diagnostic:empty]", {
    supabaseRef: supabaseKeyInfo.ref || "desconocido",
    keyRole: supabaseKeyInfo.role || "desconocido",
    serviceRole: supabaseKeyInfo.isServiceRole,
    totalOrders: total ?? null,
    error: error?.message || null
  });
}

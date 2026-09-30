import { createOrder, cancelOrder, printOrder, assertOrderAccess } from "./orders.service.js";
import { ADMIN_ROLES, getUserRoles } from "../../middlewares/auth.js";
import { assertSupabaseServiceRole, supabase, supabaseKeyInfo } from "../../config/supabase.js";
import { sendError, throwIfSupabaseError } from "../../utils/http-error.js";
import { getPaymentImageUrl } from "../payments/payments.service.js";

export async function createOrderController(req, res) {
  try {
    const order = await createOrder(req.body, req.user?.id || null);
    res.json(order);
  } catch (err) {
    sendError(res, err);
  }
}

export async function getOrderAccess(req) {
  const checkoutToken = req.get("x-checkout-token") || req.query.checkout_token || req.body?.checkout_token || null;
  const customerId = req.user?.id || null;
  let isAdmin = false;
  if (customerId) {
    const roles = await getUserRoles(customerId).catch(() => []);
    isAdmin = roles.some(role => ADMIN_ROLES.includes(role));
  }
  return { checkoutToken, customerId, isAdmin };
}

export async function getOrderByIdController(req, res) {
  try {
    const { id } = req.params;
    const { data: order, error } = await supabase
      .from("orders")
      .select("id, order_reference, items, total, status, payment_status, delivery_status, customer_name, customer_phone, customer_address, receiver_name, receiver_phone, delivery_notes, delivery_municipality, products_subtotal, delivery_surcharge, created_at, checkout_token, customer_id")
      .eq("id", id)
      .maybeSingle();

    throwIfSupabaseError(error, "No se pudo cargar la orden");
    assertOrderAccess(order, await getOrderAccess(req));

    const { checkout_token: _token, customer_id: _customer, ...publicOrder } = order;
    res.json(publicOrder);
  } catch (err) {
    sendError(res, err);
  }
}

export async function cancelOrderController(req, res) {
  try {
    const { id } = req.params;
    const result = await cancelOrder(id, await getOrderAccess(req));
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function printOrderController(req, res) {
  try {
    const { id } = req.params;
    const result = await printOrder(id);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

const DEFAULT_ORDERS_LIMIT = 500;
const MAX_ORDERS_LIMIT = 1000;

export async function getOrdersController(req, res) {
  try {
    assertSupabaseServiceRole();
    // Paginación: ?limit= (1-1000, por defecto 500) y ?offset=. Sin límite, la consulta de pagos
    // con .in(order_id) acabaría superando el tamaño máximo de URL al crecer el histórico.
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_ORDERS_LIMIT, 1), MAX_ORDERS_LIMIT);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const { data: orders, error, count } = await supabase
      .from("orders")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (Number.isFinite(count)) res.set("X-Total-Count", String(count));

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
    const signedPayments = await Promise.all((payments ?? []).map(async payment => ({
      ...payment,
      image_url: await getPaymentImageUrl(payment.image_url)
    })));
    signedPayments.forEach(payment => {
      const list = paymentsByOrder.get(payment.order_id) ?? [];
      list.push(payment);
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

export async function getCustomerOrdersController(req, res) {
  try {
    const { data, error } = await supabase.from("orders").select("id, order_reference, total, status, payment_status, delivery_status, created_at, items, receiver_name, customer_address, delivery_municipality").eq("customer_id", req.user.id).order("created_at", { ascending: false });
    throwIfSupabaseError(error, "No se pudieron cargar tus pedidos");
    const orderIds = (data || []).map(order => order.id);
    if (!orderIds.length) return res.json([]);
    const [{ data: manualPayments, error: manualError }, { data: tropipay, error: tropipayError }] = await Promise.all([
      supabase.from("payments").select("id, order_id, method, amount, image_url, validation_status, created_at").in("order_id", orderIds).order("created_at", { ascending: false }),
      supabase.from("payment_transactions").select("id, order_id, provider, provider_payment_id, external_reference, amount, currency, status, payment_url, created_at, updated_at").in("order_id", orderIds).eq("provider", "tropipay").order("created_at", { ascending: false })
    ]);
    throwIfSupabaseError(manualError, "No se pudieron cargar los comprobantes");
    throwIfSupabaseError(tropipayError, "No se pudieron cargar los pagos TropiPay");
    const byOrder = new Map();
    for (const payment of manualPayments || []) {
      const signed_url = await getPaymentImageUrl(payment.image_url);
      const list = byOrder.get(payment.order_id) || { manual: [], tropipay: [] };
      list.manual.push({ ...payment, signed_url }); byOrder.set(payment.order_id, list);
    }
    for (const payment of tropipay || []) { const list = byOrder.get(payment.order_id) || { manual: [], tropipay: [] }; list.tropipay.push(payment); byOrder.set(payment.order_id, list); }
    res.json((data || []).map(order => ({ ...order, payments: byOrder.get(order.id) || { manual: [], tropipay: [] } })));
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

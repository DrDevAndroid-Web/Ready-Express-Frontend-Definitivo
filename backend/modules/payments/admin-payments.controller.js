import { supabase } from "../../config/supabase.js";
import { sendError, throwIfSupabaseError } from "../../utils/http-error.js";
import { printOrder } from "../orders/orders.service.js";
export async function listAdminTransactions(req, res) {
  try {
    let query = supabase
      .from("payment_transactions")
      .select("*, orders(id, order_reference, customer_name, customer_email, total, status, payment_status, delivery_status, printed_at), delivery_confirmations(id, status, created_at, object_path, bucket_name, verified_at)")
      .order("created_at", { ascending: false });
    if (req.query.provider) query = query.eq("provider", req.query.provider);
    if (req.query.status) query = query.eq("status", req.query.status);
    const { data, error } = await query;
    throwIfSupabaseError(error, "No se pudieron cargar las transacciones");
    res.json((data || []).map(item => ({
      ...item,
      evidence_status: item.delivery_confirmations?.[0]?.status || "missing",
      evidence_count: item.delivery_confirmations?.length || 0
    })));
  } catch (error) { sendError(res, error); }
}
export async function getAdminTransactionEvents(req, res) { try { const { data, error } = await supabase.from("payment_events").select("*").eq("payment_transaction_id", req.params.id).order("received_at", { ascending: false }); throwIfSupabaseError(error, "No se pudieron cargar los eventos del pago"); res.json(data || []); } catch (error) { sendError(res, error); } }
export async function retryAdminPrint(req, res) { try { res.json(await printOrder(req.params.orderId)); } catch (error) { sendError(res, error); } }

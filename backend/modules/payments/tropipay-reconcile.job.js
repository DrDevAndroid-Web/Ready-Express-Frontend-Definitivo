import { reconcilePendingTropipayPayments } from "./tropipay.service.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // revisar cada 5 minutos
let running = false;

async function reconcile() {
  // Si una revisión tarda más que el intervalo, la siguiente no se solapa
  if (running) return;
  running = true;
  try {
    const summary = await reconcilePendingTropipayPayments();
    if (summary.confirmed || summary.closedWithoutLink || summary.unavailable) {
      console.info("[tropipay:reconcile]", summary);
    }
  } catch (err) {
    console.error("[tropipay:reconcile] Error en la revisión de pagos:", err?.message || err);
  } finally {
    running = false;
  }
}

export function startTropipayReconcileJob() {
  if (!process.env.TROPIPAY_CLIENT_ID || !process.env.TROPIPAY_CLIENT_SECRET) {
    console.warn("[tropipay:reconcile] Sin credenciales de TropiPay: no se revisan pagos pendientes");
    return;
  }
  setInterval(reconcile, CHECK_INTERVAL_MS).unref();
  console.info("[tropipay:reconcile] Job activo — cada 5 min");
}

import { captureReferralFromUrl } from "./referrals.js?v61";

// Las páginas secundarias también aceptan enlaces compartidos de referidos.
if (new URLSearchParams(location.search).has("ref")) {
  captureReferralFromUrl().catch(error => console.info("[referrals] captura pendiente", error?.message || error));
}

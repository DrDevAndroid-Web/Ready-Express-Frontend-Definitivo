const PROD_API_BASE = "https://readyexpressnowbackend.versabold.com/api";
const LOCAL_API_BASE = "http://127.0.0.1:3000/api";

// Producción es el destino predeterminado. Para pruebas locales se puede
// forzar explícitamente con ?backend=local.
const requestedBackend = typeof window !== "undefined"
  ? new URLSearchParams(window.location.search).get("backend")
  : "";
const forceLocalBackend = requestedBackend === "local";

export const API_BASE = forceLocalBackend ? LOCAL_API_BASE : PROD_API_BASE;
export const API_TARGET = API_BASE === LOCAL_API_BASE ? "local" : "production";

// Pago con tarjeta (TropiPay) desactivado mientras se corrige el flujo de la pasarela
// (ver "Pendiente TropiPay" en CLAUDE.md). Volver a true para ofrecerlo de nuevo.
export const CARD_PAYMENTS_ENABLED = false;

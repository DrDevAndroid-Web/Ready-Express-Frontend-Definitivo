const PROD_API_BASE = "https://readyexpressnowbackend.versabold.com/api";

// Durante las pruebas, todos los entornos del frontend consumen el backend real.
export const API_BASE = PROD_API_BASE;

// Pago con tarjeta (TropiPay) desactivado mientras se corrige el flujo de la pasarela
// (ver "Pendiente TropiPay" en CLAUDE.md). Volver a true para ofrecerlo de nuevo.
export const CARD_PAYMENTS_ENABLED = false;

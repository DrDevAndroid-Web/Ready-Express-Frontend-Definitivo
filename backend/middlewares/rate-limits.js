import rateLimit from "express-rate-limit";

// Límites por IP para las rutas públicas que cuestan dinero (IA, SMS, emails) o que
// son objetivo de fuerza bruta. El límite global de security.js sigue aplicando.
// En los tests (node --test) se desactivan para no interferir con las suites HTTP.
const underTest = Boolean(process.env.NODE_TEST_CONTEXT);

function limiter(max, windowMinutes, message) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => underTest,
    message: { error: message }
  });
}

export const authLimiter = limiter(20, 15, "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.");
export const passwordRecoveryLimiter = limiter(5, 60, "Demasiadas solicitudes de recuperación. Inténtalo más tarde.");
export const orderLimiter = limiter(20, 15, "Demasiados pedidos seguidos. Espera unos minutos.");
export const paymentLimiter = limiter(15, 15, "Demasiados intentos de pago. Espera unos minutos.");
// La página de retorno consulta ~10 veces por visita; cada consulta puede llamar a la API de TropiPay
export const paymentStatusLimiter = limiter(120, 15, "Demasiadas consultas del pago. Espera un momento.");
export const chatSessionLimiter = limiter(10, 15, "Demasiadas conversaciones nuevas. Espera unos minutos.");
export const chatMessageLimiter = limiter(40, 15, "Estás enviando mensajes muy rápido. Espera un momento.");

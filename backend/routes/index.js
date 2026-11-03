import express from "express";
import paymentMethodsRouter from "./payment-methods.js";

import { createOrderController, quoteOrderController, getOrdersController, getCustomerOrdersController, cancelOrderController, getOrderByIdController, printOrderController } from "../modules/orders/orders.controller.js"
import {
  uploadPayment,
  getPendingPaymentsController,
  getApprovedPaymentsController,
  verifyPaymentController
} from "../modules/payments/payments.controller.js";
import {
  subscribeToNotifications,
  subscribeToLocationChanges,
  getConnectionStats,
  testNotification,
  registerPushToken
} from "../modules/notifications/notifications.controller.js";
import {
  getLocationsController,
  createLocationController,
  updateLocationController,
  deleteLocationController
} from "../modules/locations/locations.controller.js";

import {
  createFoodCombo,
  getFoodCombos,
  deleteFoodCombo,
  updateFoodCombo,
  createProducto,
  getProductos,
  deleteProducto,
  updateProducto,
  createElectro,
  getElectro,
  getCatalog,
  deleteElectro,
  updateElectro,
  getInfo
} from "../modules/products/products.controller.js";

import {
  startSessionController,
  clientMessageController,
  listSessionsController,
  getMessagesController,
  adminReplyController,
  takeoverController,
  resolveSessionController,
  releaseController,
  deleteSessionController
} from "../modules/chat/chat.controller.js";

import { upload } from "../middlewares/upload.js";
import { authLimiter, confirmationEmailLimiter, chatMessageLimiter, chatSessionLimiter, orderLimiter, passwordRecoveryLimiter, paymentLimiter, paymentStatusLimiter, referralClaimLimiter } from "../middlewares/rate-limits.js";
import { optionalSupabaseUser, requireAdmin, requireDeliveryOperator, requireRecoverySession, requireRoles, requireSupabaseUser, tokenFromQuery } from "../middlewares/auth.js";
import { supabase, supabaseAuth } from "../config/supabase.js";
import { createBadRequest, sendError } from "../utils/http-error.js";
import { notifyNewDeviceLogin } from "../modules/auth/login-alert.service.js";

// Mensajes de Supabase Auth traducidos; el resto no se reenvía al cliente (pueden ser internos)
function authErrorMessage(error) {
  const message = String(error?.message || "");
  if (/invalid login credentials/i.test(message)) return "Email o contraseña incorrectos";
  if (/email not confirmed/i.test(message)) return "Confirma tu email antes de iniciar sesión. Te enviamos un enlace al registrarte.";
  if (/refresh token/i.test(message)) return "La sesión expiró. Inicia sesión de nuevo.";
  return "No se pudo iniciar sesión";
}
import { registerCustomer, resendConfirmationEmail, verifyEmailCode, getCustomerProfile, updateCustomerProfile, getPaymentPreferences, updatePaymentPreferences, listCustomerAddresses, createCustomerAddress, updateCustomerAddress, deleteCustomerAddress } from "../modules/customers/customer.service.js";
import { createTropipayPaymentController, getTropipayStatusController, retryTropipayPaymentController, tropipayWebhookController, tropipayConfigurationController } from "../modules/payments/tropipay.controller.js";
import { listAdminTransactions, getAdminTransactionEvents, retryAdminPrint } from "../modules/payments/admin-payments.controller.js";
import { getFeesReportController, getPricingSettingsController, updatePricingSettingsController } from "../modules/settings/settings.controller.js";
import { uploadDeliveryConfirmationController, getDeliveryConfirmationController, getPaymentDeliveryConfirmationController, updateDeliveryConfirmationController } from "../modules/media/media.controller.js";
import { getPublicReferralProgramController, claimReferralCodeController, getMyReferralCodeController, attachReferralClaimController, getMyReferralSummaryController } from "../modules/referrals/referral.controller.js";
import { getAdminReferralProgramController, updateAdminReferralProgramController, createAdminReferralRuleController, updateAdminReferralRuleController, listAdminReferralsController, listAdminReferralRewardsController, getAdminReferralStatsController, reverseAdminReferralRewardController } from "../modules/referrals/referral.admin.controller.js";
import { getReferralPushPreferences, getReferralPushPublicKey, updateReferralPushPreferences } from "../modules/notifications/referral-push.service.js";

const router = express.Router();

// Solo ?precios=base (APK/dashboard) necesita identificar al usuario; la tienda no paga esa consulta
const basePriceViewer = (req, res, next) => (req.query.precios === "base" ? optionalSupabaseUser(req, res, next) : next());

// AUTH CONFIG
router.get("/auth/config", (_req, res) => {
  res.json({
    auth: "backend"
  });
});

router.post("/auth/login", authLimiter, async (req, res) => {
  try {
    const { email, password, device_id: deviceId } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email y contraseña son requeridos" });
    }

    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      // code: el frontend muestra el aviso de confirmar el email con opción de reenviarlo
      const code = /email not confirmed/i.test(error.message || "") ? "email_not_confirmed" : undefined;
      return res.status(401).json({ error: authErrorMessage(error), ...(code ? { code } : {}) });
    }

    // Aviso por email si entra desde un dispositivo nuevo; en segundo plano, no retrasa el login
    notifyNewDeviceLogin({ user: data.user, deviceId, userAgent: req.get("user-agent"), ip: req.ip });

    res.json({
      access_token: data.session?.access_token,
      refresh_token: data.session?.refresh_token,
      expires_at: data.session?.expires_at,
      user: data.user
        ? {
            id: data.user.id,
            email: data.user.email
          }
        : null
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/auth/register", authLimiter, async (req, res, next) => {
  try {
    const result = await registerCustomer(req.body);
    // El dispositivo del registro queda como conocido (sin aviso): solo avisarán los siguientes
    if (result.access_token) notifyNewDeviceLogin({ user: result.user, deviceId: req.body?.device_id, userAgent: req.get("user-agent"), ip: req.ip });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/auth/resend-confirmation", confirmationEmailLimiter, async (req, res, next) => {
  try {
    res.json(await resendConfirmationEmail(req.body?.email));
  } catch (err) {
    next(err);
  }
});

router.post("/auth/verify-email-code", authLimiter, async (req, res, next) => {
  try {
    const result = await verifyEmailCode(req.body?.email, req.body?.code);
    // Primer acceso de la cuenta: deja el dispositivo como conocido, sin aviso
    notifyNewDeviceLogin({ user: result.user, deviceId: req.body?.device_id, userAgent: req.get("user-agent"), ip: req.ip });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/auth/recover-password", passwordRecoveryLimiter, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "El email es requerido" });

    const frontendUrl = String(process.env.FRONTEND_PUBLIC_URL || "https://www.readyexpressnow.com").replace(/\/$/, "");
    const redirectTo = process.env.FRONTEND_PASSWORD_RESET_URL || `${frontendUrl}/reset-password.html`;
    const { error } = await supabaseAuth.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      console.warn("[auth:recover]", error.message);
      if (error.status === 429 || /rate limit/i.test(error.message || "")) {
        return res.status(429).json({ error: "Se enviaron demasiados emails. Espera unos minutos e inténtalo de nuevo." });
      }
      return res.status(400).json({ error: "No se pudo enviar el email de recuperación. Revisa la dirección." });
    }

    res.json({ message: "Si el email está registrado, recibirás instrucciones para recuperar la contraseña." });
  } catch (err) {
    next(err);
  }
});

// Recibe el access_token de recuperación (enlace del email) como Bearer y fija la nueva contraseña
router.post("/auth/reset-password", authLimiter, requireSupabaseUser, requireRecoverySession, async (req, res, next) => {
  try {
    const password = String(req.body?.password || "");
    if (password.length < 8) throw createBadRequest("La contraseña debe tener al menos 8 caracteres");

    const { error } = await supabase.auth.admin.updateUserById(req.user.id, { password });
    if (error) throw createBadRequest(error.message);

    res.json({ message: "Contraseña actualizada. Ya puedes iniciar sesión." });
  } catch (err) {
    next(err);
  }
});

router.post("/auth/refresh", authLimiter, async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({ error: "Refresh token requerido" });
    }

    const { data, error } = await supabaseAuth.auth.refreshSession({
      refresh_token
    });

    if (error) {
      // code: el frontend muestra el aviso de confirmar el email con opción de reenviarlo
      const code = /email not confirmed/i.test(error.message || "") ? "email_not_confirmed" : undefined;
      return res.status(401).json({ error: authErrorMessage(error), ...(code ? { code } : {}) });
    }

    res.json({
      access_token: data.session?.access_token,
      refresh_token: data.session?.refresh_token,
      expires_at: data.session?.expires_at,
      user: data.user
        ? {
            id: data.user.id,
            email: data.user.email
          }
        : null
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/auth/me", requireSupabaseUser, async (req, res, next) => {
  try {
    const profile = await getCustomerProfile(req.user.id).catch(error => {
      if (error?.status === 404) return null;
      throw error;
    });
    res.json({ user: { id: req.user.id, email: req.user.email }, profile });
  } catch (err) {
    next(err);
  }
});

router.get("/auth/profile", requireSupabaseUser, async (req, res, next) => {
  try {
    res.json(await getCustomerProfile(req.user.id));
  } catch (err) {
    next(err);
  }
});

// TropiPay: la creación puede operar con invitado; el webhook es público para TropiPay.
router.post("/payments/tropipay", paymentLimiter, requireSupabaseUser, createTropipayPaymentController);
router.get("/payments/tropipay/:id/status", paymentStatusLimiter, optionalSupabaseUser, getTropipayStatusController);
router.post("/payments/tropipay/:id/retry", paymentLimiter, optionalSupabaseUser, retryTropipayPaymentController);
router.post("/payments/tropipay/webhook", tropipayWebhookController);
router.get("/admin/tropipay/configuration", requireSupabaseUser, requireAdmin, tropipayConfigurationController);
router.get("/admin/payments", requireSupabaseUser, requireAdmin, listAdminTransactions);
// Recargo de precios de la tienda e informe de tarifas (APK → Configuración)
router.get("/admin/configuracion/precios", requireSupabaseUser, requireAdmin, getPricingSettingsController);
router.put("/admin/configuracion/precios", requireSupabaseUser, requireAdmin, updatePricingSettingsController);
router.get("/admin/reporte-tarifas", requireSupabaseUser, requireAdmin, getFeesReportController);
// Configuración y observabilidad de referidos: solo admin, no operador/repartidor.
router.get("/admin/referrals/program", requireSupabaseUser, requireRoles("admin"), getAdminReferralProgramController);
router.patch("/admin/referrals/program", requireSupabaseUser, requireRoles("admin"), updateAdminReferralProgramController);
router.post("/admin/referrals/rules", requireSupabaseUser, requireRoles("admin"), createAdminReferralRuleController);
router.patch("/admin/referrals/rules/:id", requireSupabaseUser, requireRoles("admin"), updateAdminReferralRuleController);
router.get("/admin/referrals", requireSupabaseUser, requireRoles("admin"), listAdminReferralsController);
router.get("/admin/referral-rewards", requireSupabaseUser, requireRoles("admin"), listAdminReferralRewardsController);
router.post("/admin/referral-rewards/:id/reverse", requireSupabaseUser, requireRoles("admin"), reverseAdminReferralRewardController);
router.get("/admin/referrals/stats", requireSupabaseUser, requireRoles("admin"), getAdminReferralStatsController);
router.get("/admin/payments/:id/events", requireSupabaseUser, requireAdmin, getAdminTransactionEvents);
router.get("/admin/payments/:id/evidence-url", requireSupabaseUser, requireAdmin, getPaymentDeliveryConfirmationController);
router.post("/admin/orders/:orderId/retry-print", requireSupabaseUser, requireAdmin, retryAdminPrint);
router.post("/orders/:id/delivery-confirmation", requireSupabaseUser, requireDeliveryOperator, upload.single("image"), uploadDeliveryConfirmationController);
router.get("/orders/:id/delivery-confirmation-url", requireSupabaseUser, requireAdmin, getDeliveryConfirmationController);
router.patch("/orders/:id/delivery-confirmation/status", requireSupabaseUser, requireDeliveryOperator, updateDeliveryConfirmationController);

router.patch("/auth/profile", requireSupabaseUser, async (req, res, next) => {
  try {
    res.json(await updateCustomerProfile(req.user.id, req.body));
  } catch (err) {
    next(err);
  }
});

router.get("/account/payment-preferences", requireSupabaseUser, async (req, res, next) => {
  try { res.json(await getPaymentPreferences(req.user.id)); } catch (err) { next(err); }
});

router.patch("/account/payment-preferences", requireSupabaseUser, async (req, res, next) => {
  try { res.json(await updatePaymentPreferences(req.user.id, req.body)); } catch (err) { next(err); }
});
router.get("/account/referral-push", requireSupabaseUser, async (req, res, next) => {
  try { res.json({ ...await getReferralPushPreferences(req.user.id), ...getReferralPushPublicKey() }); } catch (err) { next(err); }
});
router.patch("/account/referral-push", requireSupabaseUser, async (req, res, next) => {
  try { res.json({ ...await updateReferralPushPreferences(req.user.id, req.body), ...getReferralPushPublicKey() }); } catch (err) { next(err); }
});

router.get("/account/addresses", requireSupabaseUser, async (req, res, next) => { try { res.json(await listCustomerAddresses(req.user.id)); } catch (err) { next(err); } });
router.post("/account/addresses", requireSupabaseUser, async (req, res, next) => { try { res.status(201).json(await createCustomerAddress(req.user.id, req.body)); } catch (err) { next(err); } });
router.patch("/account/addresses/:id", requireSupabaseUser, async (req, res, next) => { try { res.json(await updateCustomerAddress(req.user.id, req.params.id, req.body)); } catch (err) { next(err); } });
router.delete("/account/addresses/:id", requireSupabaseUser, async (req, res, next) => { try { res.json(await deleteCustomerAddress(req.user.id, req.params.id)); } catch (err) { next(err); } });

// PRODUCTS
router.get("/food-combos", basePriceViewer, getFoodCombos);
router.get("/catalog", getCatalog);
router.get("/combos-comida", basePriceViewer, getFoodCombos);
router.post("/combos-comida", requireSupabaseUser, requireAdmin, upload.single("imagen"), createFoodCombo);
router.delete("/combos-comida/:id", requireSupabaseUser, requireAdmin, deleteFoodCombo);
router.put("/combos-comida/:id", requireSupabaseUser, requireAdmin, upload.single("imagen"), updateFoodCombo);
router.get("/productos", basePriceViewer, getProductos);
router.post("/productos", requireSupabaseUser, requireAdmin, upload.single("imagen"), createProducto);
router.delete("/productos/:id", requireSupabaseUser, requireAdmin, deleteProducto);
router.put("/productos/:id", requireSupabaseUser, requireAdmin, upload.single("imagen"), updateProducto);
router.get("/electrodomesticos", basePriceViewer, getElectro);
router.post("/electrodomesticos", requireSupabaseUser, requireAdmin, upload.single("imagen"), createElectro);
router.delete("/electrodomesticos/:id", requireSupabaseUser, requireAdmin, deleteElectro);
router.put("/electrodomesticos/:id", requireSupabaseUser, requireAdmin, upload.single("imagen"), updateElectro);
router.get("/info", getInfo);
router.get("/referrals/program", getPublicReferralProgramController);
router.post("/referrals/claim", referralClaimLimiter, optionalSupabaseUser, claimReferralCodeController);
router.get("/account/referral-code", requireSupabaseUser, getMyReferralCodeController);
router.post("/account/referral-claim", referralClaimLimiter, requireSupabaseUser, attachReferralClaimController);
router.get("/account/referrals", requireSupabaseUser, getMyReferralSummaryController);
router.get("/orders", requireSupabaseUser, requireAdmin, getOrdersController);

// ORDERS
router.post("/orders", orderLimiter, optionalSupabaseUser, createOrderController);
router.post("/orders/quote", orderLimiter, optionalSupabaseUser, quoteOrderController);
router.get("/account/orders", requireSupabaseUser, getCustomerOrdersController);
router.get("/orders/:id", optionalSupabaseUser, getOrderByIdController);
router.patch("/orders/:id/cancel", optionalSupabaseUser, cancelOrderController);
router.post("/orders/:id/print", requireSupabaseUser, requireAdmin, printOrderController);


// PAYMENTS
router.post("/payments/upload", paymentLimiter, optionalSupabaseUser, upload.single("image"), uploadPayment);
router.get("/payments/pending", requireSupabaseUser, requireAdmin, getPendingPaymentsController);
router.get("/payments/approved", requireSupabaseUser, requireAdmin, getApprovedPaymentsController);
router.patch("/payments/:id/verify", requireSupabaseUser, requireAdmin, verifyPaymentController);

// NOTIFICATIONS (SSE para APK Admin / Dashboard)
router.get("/notifications/subscribe", tokenFromQuery, optionalSupabaseUser, subscribeToNotifications);
router.get("/notifications/stats", requireSupabaseUser, requireAdmin, getConnectionStats);
router.post("/notifications/test", requireSupabaseUser, requireAdmin, testNotification);
router.post("/notifications/push-token", requireSupabaseUser, requireAdmin, registerPushToken);

// DELIVERY LOCATIONS
router.get("/localizaciones", getLocationsController);
router.get("/localizaciones/admin", requireSupabaseUser, requireAdmin, (req, res, next) => {
  req.query.includeInactive = "true";
  getLocationsController(req, res, next);
});
router.get("/localizaciones/events", subscribeToLocationChanges);
router.post("/localizaciones", requireSupabaseUser, requireAdmin, createLocationController);
router.put("/localizaciones/:id", requireSupabaseUser, requireAdmin, updateLocationController);
router.delete("/localizaciones/:id", requireSupabaseUser, requireAdmin, deleteLocationController);

// CHAT (público para clientes, protegido para admin)
router.post("/chat/session", chatSessionLimiter, startSessionController);
router.post("/chat/message", chatMessageLimiter, clientMessageController);
router.get("/chat/sessions", requireSupabaseUser, requireAdmin, listSessionsController);
router.get("/chat/sessions/:id/messages", requireSupabaseUser, requireAdmin, getMessagesController);
router.post("/chat/sessions/:id/reply", requireSupabaseUser, requireAdmin, adminReplyController);
router.patch("/chat/sessions/:id/takeover", requireSupabaseUser, requireAdmin, takeoverController);
router.patch("/chat/sessions/:id/resolve", requireSupabaseUser, requireAdmin, resolveSessionController);
router.patch("/chat/sessions/:id/release", requireSupabaseUser, requireAdmin, releaseController);
router.delete("/chat/sessions/:id", requireSupabaseUser, requireAdmin, deleteSessionController);

// PAYMENT METHODS
router.use("/payment-methods", paymentMethodsRouter);

export default router;

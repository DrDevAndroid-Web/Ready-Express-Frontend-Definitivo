import express from "express";
import paymentMethodsRouter from "./payment-methods.js";

import { createOrderController, getOrdersController, cancelOrderController } from "../modules/orders/orders.controller.js"
import {
  uploadPayment,
  getPendingPaymentsController,
  getApprovedPaymentsController,
  verifyPaymentController
} from "../modules/payments/payments.controller.js";
import {
  subscribeToNotifications,
  getConnectionStats,
  testNotification,
  registerPushToken
} from "../modules/notifications/notifications.controller.js";

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
import { requireSupabaseUser } from "../middlewares/auth.js";
import { supabaseAuth } from "../config/supabase.js";

const router = express.Router();

// AUTH CONFIG
router.get("/auth/config", (_req, res) => {
  res.json({
    auth: "backend"
  });
});

router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email y contraseña son requeridos" });
    }

    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return res.status(401).json({ error: error.message });
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
    res.status(500).json({ error: err.message });
  }
});

router.post("/auth/refresh", async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({ error: "Refresh token requerido" });
    }

    const { data, error } = await supabaseAuth.auth.refreshSession({
      refresh_token
    });

    if (error) {
      return res.status(401).json({ error: error.message });
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
    res.status(500).json({ error: err.message });
  }
});

router.get("/auth/me", requireSupabaseUser, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email
    }
  });
});

// PRODUCTS
router.get("/food-combos", getFoodCombos);
router.get("/combos-comida", getFoodCombos);
router.post("/combos-comida", requireSupabaseUser, upload.single("imagen"), createFoodCombo);
router.delete("/combos-comida/:id", requireSupabaseUser, deleteFoodCombo);
router.put("/combos-comida/:id", requireSupabaseUser, upload.single("imagen"), updateFoodCombo);
router.get("/productos", getProductos);
router.post("/productos", requireSupabaseUser, upload.single("imagen"), createProducto);
router.delete("/productos/:id", requireSupabaseUser, deleteProducto);
router.put("/productos/:id", requireSupabaseUser, upload.single("imagen"), updateProducto);
router.get("/electrodomesticos", getElectro);
router.post("/electrodomesticos", requireSupabaseUser, upload.single("imagen"), createElectro);
router.delete("/electrodomesticos/:id", requireSupabaseUser, deleteElectro);
router.put("/electrodomesticos/:id", requireSupabaseUser, upload.single("imagen"), updateElectro);
router.get("/info", getInfo);
router.get("/orders", requireSupabaseUser, getOrdersController);

// ORDERS
router.post("/orders", createOrderController);
router.patch("/orders/:id/cancel", cancelOrderController);


// PAYMENTS
router.post("/payments/upload", upload.single("image"), uploadPayment);
router.get("/payments/pending", requireSupabaseUser, getPendingPaymentsController);
router.get("/payments/approved", requireSupabaseUser, getApprovedPaymentsController);
router.patch("/payments/:id/verify", requireSupabaseUser, verifyPaymentController);

// NOTIFICATIONS (SSE para APK Admin / Dashboard)
router.get("/notifications/subscribe", subscribeToNotifications);
router.get("/notifications/stats", getConnectionStats);
router.post("/notifications/test", requireSupabaseUser, testNotification);
router.post("/notifications/push-token", requireSupabaseUser, registerPushToken);

// CHAT (público para clientes, protegido para admin)
router.post("/chat/session", startSessionController);
router.post("/chat/message", clientMessageController);
router.get("/chat/sessions", requireSupabaseUser, listSessionsController);
router.get("/chat/sessions/:id/messages", requireSupabaseUser, getMessagesController);
router.post("/chat/sessions/:id/reply", requireSupabaseUser, adminReplyController);
router.patch("/chat/sessions/:id/takeover", requireSupabaseUser, takeoverController);
router.patch("/chat/sessions/:id/resolve", requireSupabaseUser, resolveSessionController);
router.patch("/chat/sessions/:id/release", requireSupabaseUser, releaseController);
router.delete("/chat/sessions/:id", requireSupabaseUser, deleteSessionController);

// PAYMENT METHODS
router.use("/payment-methods", paymentMethodsRouter);

export default router;

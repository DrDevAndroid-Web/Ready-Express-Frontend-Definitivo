import crypto, { randomUUID } from "crypto";
import { compressImage } from "../../utils/image.js";
import { uploadImage } from "../storage/storage.service.js";
import { assertSupabaseServiceRole, supabase, supabaseKeyInfo } from "../../config/supabase.js";
import { sendPrintableOrderEmail } from "../email/resend.js";
import { notifyPaymentReceived, notifyPaymentApproved, notifyPaymentRejected } from "../telegram/telegram.service.js";
import { NotificationManager } from "../notifications/notifications.service.js";
import { createBadRequest, createConflict, createNotFound, throwIfSupabaseError } from "../../utils/http-error.js";
import { assertOrderAccess } from "../orders/orders.service.js";

// Estados en los que la orden acepta un comprobante (reintento tras un rechazo incluido)
const ORDER_STATUSES_ACCEPTING_PROOF = ["pending", "payment_rejected"];

// Métodos con subida de comprobante: los activos en la tabla payment_methods (el admin
// puede crear nuevos desde el dashboard). Si la tabla no responde, se usan los históricos.
const DEFAULT_PROOF_METHODS = ["Zelle", "TocoPay"];
const PROOF_METHODS_TTL_MS = 60_000;
let proofMethodsCache = { names: null, loadedAt: 0 };

export function proofMethodNames(rows) {
  const names = (rows || [])
    .filter(row => row?.is_active !== false)
    .filter(row => {
      const flow = row?.payment_flow || "proof_upload";
      return flow === "proof_upload" && !String(row?.method_name || "").toLowerCase().includes("tropipay");
    })
    .map(row => String(row.method_name || "").trim())
    .filter(Boolean);
  return names.length ? names : DEFAULT_PROOF_METHODS;
}

async function getAcceptedProofMethods() {
  if (proofMethodsCache.names && Date.now() - proofMethodsCache.loadedAt < PROOF_METHODS_TTL_MS) return proofMethodsCache.names;
  try {
    const { data, error } = await supabase.from("payment_methods").select("*").eq("is_active", true);
    if (error) throw error;
    proofMethodsCache = { names: proofMethodNames(data), loadedAt: Date.now() };
  } catch (err) {
    console.error("[payments] No se pudieron cargar los métodos de pago; se usan los predeterminados:", err.message);
    // También se cachea el fallo para no repetir una consulta lenta en cada subida
    proofMethodsCache = { names: proofMethodsCache.names || DEFAULT_PROOF_METHODS, loadedAt: Date.now() };
  }
  return proofMethodsCache.names;
}

export async function processPayment(file, orderId, method, expectedAmount, access = {}) {
  if (!file?.buffer) throw createBadRequest("Debes adjuntar una imagen del comprobante");
  if (!orderId) throw createBadRequest("La orden es requerida");

  // Normalizar método (trim y validar)
  const normalizedMethod = method?.trim();

  const acceptedMethods = await getAcceptedProofMethods();
  const canonicalMethod = acceptedMethods.find(name => name.toLowerCase() === String(normalizedMethod || "").toLowerCase());
  if (!canonicalMethod) {
    throw createBadRequest(`Metodo de pago no valido. Metodos soportados: ${acceptedMethods.join(", ")}`);
  }

  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    throw createBadRequest("El monto del pago debe ser un numero mayor que cero");
  }

  if (!access.checkoutToken && !access.customerId && !access.isAdmin) {
    throw createBadRequest("Falta el codigo de tu pedido (checkout_token). Abre el pago desde el mismo navegador donde creaste el pedido.");
  }

  const order = await getOrderByIdSafe(orderId);
  // 404 también cuando no es tuyo, para no revelar qué órdenes existen
  assertOrderAccess(order, access);
  if (!ORDER_STATUSES_ACCEPTING_PROOF.includes(order.status)) {
    throw createConflict("Esta orden ya no admite comprobantes: ya fue pagada, cancelada o esta en revision");
  }

  const orderTotal = Number(order.total);
  if (!Number.isFinite(orderTotal) || Math.abs(orderTotal - expectedAmount) > 0.01) {
    throw createBadRequest("El monto del pago no coincide con el total de la orden");
  }

  // 1. Comprimir imagen
  const compressed = await compressImage(file.buffer);

  // 2. Hash MD5 anti-duplicados
  const hash = crypto.createHash("md5").update(compressed).digest("hex");

  // 3. Verificar si ya existe un comprobante con el mismo hash
  const { data: existing, error: existingError } = await supabase
    .from("payments")
    .select("id")
    .eq("image_hash", hash)
    .maybeSingle();

  throwIfSupabaseError(existingError, "No se pudo verificar si el comprobante ya existe");

  if (existing) {
    throw createConflict("Este comprobante ya fue enviado anteriormente");
  }

  // 4. Subir imagen a Supabase Storage
  // Nombre aleatorio: los comprobantes no deben poder adivinarse
  const path = await uploadImage(compressed, `${randomUUID()}.jpg`);

  // 5 + 6. Insertar pago y actualizar orden en paralelo
  const [paymentResult, orderResult] = await Promise.all([
    supabase
      .from("payments")
      .insert({
        order_id: orderId,
        method: canonicalMethod,
        amount: expectedAmount,
        image_url: path,
        image_hash: hash,
        validation_status: "pending_review"
      })
      .select("id, order_id, method, amount, image_url, created_at")
      .single(),
    supabase
      .from("orders")
      .update({ status: "payment_review" })
      .eq("id", orderId)
      .in("status", ORDER_STATUSES_ACCEPTING_PROOF)
  ]);

  throwIfSupabaseError(paymentResult.error, "No se pudo registrar el pago");
  throwIfSupabaseError(orderResult.error, "No se pudo actualizar la orden a revision de pago");

  // 7. Enviar notificación SSE al dashboard (APK admin) + Telegram
  const paymentId = paymentResult.data?.id;
  if (paymentId) {
    const paymentData = {
      id: paymentId,
      order_id: paymentResult.data.order_id,
      method: paymentResult.data.method,
      amount: paymentResult.data.amount,
      image_url: await getPaymentImageUrl(paymentResult.data.image_url),
      created_at: paymentResult.data.created_at,
      sender_name: order.sender_name || order.customer_name
    };
    NotificationManager.broadcastPaymentReceived(paymentData);
    notifyPaymentReceived(order, paymentResult.data).catch(err =>
      console.error("[telegram:payment_received]", err?.message || err)
    );
  }

  return {
    status: "pending_review",
    message: "Comprobante recibido, en revisión"
  };
}

export async function getPendingPayments() {
  assertSupabaseServiceRole();
  const { data, error } = await supabase
    .from("payments")
    .select(`
      id,
      order_id,
      method,
      amount,
      image_url,
      validation_status,
      created_at,
      orders (
        customer_name,
        customer_email,
        customer_phone,
        customer_address,
        sender_name,
        sender_phone,
        receiver_name,
        receiver_phone,
        delivery_notes,
        items,
        total,
        status,
        created_at
      )
    `)
    .eq("validation_status", "pending_review")
    .order("created_at", { ascending: false });

  throwIfSupabaseError(error, "No se pudieron cargar los pagos pendientes");
  await logPaymentDiagnosticsIfEmpty("pending_review", data);
  return withSignedPaymentImages(data);
}

export async function getApprovedPayments() {
  assertSupabaseServiceRole();
  const { data, error } = await supabase
    .from("payments")
    .select(`
      id,
      order_id,
      method,
      amount,
      image_url,
      validation_status,
      created_at,
      orders (
        customer_name,
        customer_email,
        customer_phone,
        customer_address,
        sender_name,
        sender_phone,
        receiver_name,
        receiver_phone,
        delivery_notes,
        items,
        total,
        status,
        created_at
      )
    `)
    .eq("validation_status", "approved")
    .order("created_at", { ascending: false });

  throwIfSupabaseError(error, "No se pudieron cargar los pagos aprobados");
  await logPaymentDiagnosticsIfEmpty("approved", data);
  return withSignedPaymentImages(data);
}

const PAYMENTS_BUCKET = "payments";
const PAYMENT_IMAGE_URL_TTL_SECONDS = 60 * 60;

// Ruta dentro del bucket. Las filas antiguas guardaban la URL pública completa
// (.../object/public/payments/<archivo>), que deja de funcionar con el bucket privado.
export function paymentImagePath(imageUrl) {
  if (!imageUrl) return null;
  const value = String(imageUrl);
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, "");
  const match = value.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/payments\/([^?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// URL firmada de 1 hora; una URL externa que no es del bucket se devuelve tal cual
export async function getPaymentImageUrl(imageUrl) {
  if (!imageUrl) return null;
  const path = paymentImagePath(imageUrl);
  if (!path) return /^https?:\/\//i.test(String(imageUrl)) ? imageUrl : null;

  const { data, error } = await supabase.storage
    .from(PAYMENTS_BUCKET)
    .createSignedUrl(path, PAYMENT_IMAGE_URL_TTL_SECONDS);

  if (error) {
    console.error("[payments] No se pudo firmar la imagen del comprobante:", error.message);
    return null;
  }
  return data?.signedUrl || null;
}

async function withSignedPaymentImages(payments) {
  return Promise.all((payments ?? []).map(async payment => ({
    ...payment,
    image_url: await getPaymentImageUrl(payment.image_url)
  })));
}

async function logPaymentDiagnosticsIfEmpty(status, data) {
  if ((data ?? []).length) return;

  const { count: total, error: totalError } = await supabase
    .from("payments")
    .select("id", { count: "exact", head: true });

  const { data: statuses, error: statusesError } = await supabase
    .from("payments")
    .select("validation_status")
    .limit(50);

  const statusCounts = (statuses ?? []).reduce((acc, row) => {
    const key = row.validation_status || "null";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  console.warn("[payments:diagnostic:empty]", {
    requestedStatus: status,
    supabaseRef: supabaseKeyInfo.ref || "desconocido",
    keyRole: supabaseKeyInfo.role || "desconocido",
    serviceRole: supabaseKeyInfo.isServiceRole,
    totalPayments: total ?? null,
    statusCounts,
    totalError: totalError?.message || null,
    statusesError: statusesError?.message || null
  });
}

export async function verifyPayment(paymentId, action) {
  if (!paymentId) throw createBadRequest("El pago es requerido");
  if (!["approve", "reject"].includes(action)) {
    throw createBadRequest("Accion de verificacion no valida");
  }

  const validationStatus = action === "approve" ? "approved" : "rejected";
  const orderStatus = action === "approve" ? "paid" : "payment_rejected";

  // Transiciones permitidas: un pago aprobado ya se imprimió y no puede volver atrás.
  // Un rechazo por error sí puede aprobarse después.
  const allowedFrom = action === "approve" ? "pending_review,rejected" : "pending_review";

  // 1. Actualizar pago de forma condicional: si dos admins aprueban a la vez,
  //    solo una actualización coincide y solo esa envía la impresión.
  const { data: updated, error } = await supabase
    .from("payments")
    .update({ validation_status: validationStatus })
    .eq("id", paymentId)
    .or(`validation_status.is.null,validation_status.in.(${allowedFrom})`)
    .select("order_id");

  throwIfSupabaseError(error, "No se pudo actualizar el pago");
  const payment = updated?.[0];

  if (!payment) {
    const { data: currentPayment, error: currentError } = await supabase
      .from("payments")
      .select("order_id, validation_status")
      .eq("id", paymentId)
      .maybeSingle();

    throwIfSupabaseError(currentError, "No se pudo cargar el pago");
    if (!currentPayment) throw createNotFound("Pago no encontrado");

    if (currentPayment.validation_status === validationStatus) {
      return {
        status: validationStatus,
        message: action === "approve"
          ? "El pago ya estaba aprobado; no se envio otra impresion"
          : "El pago ya estaba rechazado",
        printEmailSent: false,
        printEmailError: null
      };
    }

    throw createConflict("El pago ya fue aprobado y enviado a imprimir; no se puede rechazar");
  }

  if (!payment.order_id) throw createNotFound("No se encontro la orden asociada al pago");

  // 2. Actualizar orden
  const { error: orderError } = await supabase
    .from("orders")
    .update({ status: orderStatus })
    .eq("id", payment.order_id);

  throwIfSupabaseError(orderError, "No se pudo actualizar el estado de la orden");

  let printEmailSent = false;
  let printEmailError = null;

  if (action === "approve") {
    try {
      const order = await getOrderById(payment.order_id);
      await sendPrintableOrderEmail(order);
      printEmailSent = true;

      NotificationManager.broadcastPaymentApproved(paymentId, payment.order_id);
      notifyPaymentApproved(order).catch(err =>
        console.error("[telegram:payment_approved]", err?.message || err)
      );
    } catch (err) {
      printEmailError = err.message;
      console.error("Error enviando orden a impresora:", err);
    }
  } else {
    NotificationManager.broadcastPaymentRejected(paymentId, payment.order_id, "Comprobante rechazado por el administrador");
    getOrderById(payment.order_id)
      .then(order => notifyPaymentRejected(order))
      .catch(err => console.error("[telegram:payment_rejected]", err?.message || err));
  }

  return {
    status: validationStatus,
    message: getVerifyPaymentMessage(action, printEmailSent, printEmailError),
    printEmailSent,
    printEmailError
  };
}

async function getOrderById(orderId) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  throwIfSupabaseError(error, "No se pudo cargar la orden");
  return data;
}

async function getOrderByIdSafe(orderId) {
  const { data, error } = await supabase
    .from("orders")
    .select("id,total,status,customer_name,sender_name,checkout_token,customer_id")
    .eq("id", orderId)
    .maybeSingle();

  throwIfSupabaseError(error, "No se pudo verificar la orden");
  return data;
}

function getVerifyPaymentMessage(action, printEmailSent, printEmailError) {
  if (action !== "approve") return "Pago rechazado";
  if (printEmailSent) return "Pago aprobado y orden enviada a imprimir";
  return `Pago aprobado, pero no se pudo enviar a imprimir: ${printEmailError || "error desconocido"}`;
}

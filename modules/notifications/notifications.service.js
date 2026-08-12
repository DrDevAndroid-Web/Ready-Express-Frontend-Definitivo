import { sendAdminPushNotification } from "./push.service.js";

// Clientes conectados al SSE
const connectedClients = new Map();

export class NotificationManager {
  static addClient(clientId, res) {
    connectedClients.set(clientId, res);
    console.log(`[SSE] Cliente conectado: ${clientId}. Total: ${connectedClients.size}`);
  }

  static removeClient(clientId) {
    connectedClients.delete(clientId);
    console.log(`[SSE] Cliente desconectado: ${clientId}. Total: ${connectedClients.size}`);
  }

  static sendNotification(type, data) {
    const message = {
      type,
      timestamp: new Date().toISOString(),
      data
    };

    const sseData = `data: ${JSON.stringify(message)}\n\n`;
    let sentCount = 0;

    connectedClients.forEach((res, clientId) => {
      try {
        res.write(sseData);
        sentCount++;
      } catch (err) {
        console.error(`[SSE] Error enviando a ${clientId}:`, err.message);
        connectedClients.delete(clientId);
      }
    });

    console.log(`[SSE] ${type} enviado a ${sentCount}/${connectedClients.size} clientes`);
    sendAdminPushNotification(type, data).catch(error => {
      console.error(`[push] Error enviando ${type}:`, error.message);
    });
    return sentCount;
  }

  static getConnectedCount() {
    return connectedClients.size;
  }

  static broadcastPaymentReceived(paymentData) {
    const senderName = paymentData.sender_name || paymentData.customer_name || "";
    return this.sendNotification("payment_received", {
      paymentId: paymentData.id,
      orderId: paymentData.order_id,
      senderName,
      method: paymentData.method,
      amount: paymentData.amount,
      imageUrl: paymentData.image_url,
      createdAt: paymentData.created_at,
      message: senderName
        ? `Llego un pedido nuevo de ${senderName}`
        : "Llego un pedido nuevo"
    });
  }

  static broadcastPaymentApproved(paymentId, orderId) {
    return this.sendNotification("payment_approved", {
      paymentId,
      orderId,
      message: "Pago aprobado y orden enviada a imprimir"
    });
  }

  static broadcastPaymentRejected(paymentId, orderId, reason) {
    return this.sendNotification("payment_rejected", {
      paymentId,
      orderId,
      reason,
      message: "Pago rechazado"
    });
  }

  static broadcastOrderCreated(orderData) {
    return this.sendNotification("order_created", {
      orderId: orderData.id,
      customerName: orderData.customer_name || orderData.sender_name,
      total: orderData.total,
      itemCount: Array.isArray(orderData.items) ? orderData.items.length : 0,
      message: `Nueva orden: ${orderData.customer_name || orderData.sender_name}`
    });
  }

  static broadcastOrderDelivered(orderId, customerName) {
    return this.sendNotification("order_delivered", {
      orderId,
      customerName,
      message: "Orden entregada exitosamente"
    });
  }

  static broadcastOrderCancelled(orderData) {
    return this.sendNotification("order_cancelled", {
      orderId: orderData.id,
      customerName: orderData.customer_name || orderData.sender_name,
      total: orderData.total,
      message: `Orden cancelada por el cliente: ${orderData.customer_name || orderData.sender_name}`
    });
  }
}

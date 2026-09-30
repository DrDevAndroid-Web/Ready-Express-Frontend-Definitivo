/**
 * Puertos de la vertical de pagos.
 * Los casos de uso dependen de estos contratos, no de Supabase ni Express.
 */
export const paymentPorts = {
  transactionRepository: ["findOrderById", "findPendingByOrder", "countByOrder", "findById", "findByProviderReference", "createPayment", "updatePayment"],
  eventRepository: ["exists", "record"],
  orderRepository: ["updatePaymentState", "markPrinted"],
};

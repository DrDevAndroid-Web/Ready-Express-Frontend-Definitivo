/**
 * Puertos de la vertical de pagos.
 * Los casos de uso dependen de estos contratos, no de Supabase ni Express.
 */
export const paymentPorts = {
  transactionRepository: ["findOrderForCheckout", "findById", "findByProviderReference", "create", "update"],
  eventRepository: ["exists", "record"],
  orderRepository: ["updatePaymentState", "markPrinted"],
};

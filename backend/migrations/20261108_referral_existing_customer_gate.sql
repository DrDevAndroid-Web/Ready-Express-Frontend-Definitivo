-- Evita que la comprobación server-side de clientes existentes tenga que
-- recorrer todos los pedidos. La regla de elegibilidad sigue viviendo en el
-- backend; este índice solo acelera la consulta por cliente y pago confirmado.
create index if not exists orders_customer_successful_payment_idx
  on public.orders (customer_id, created_at)
  where payment_status = 'successful';

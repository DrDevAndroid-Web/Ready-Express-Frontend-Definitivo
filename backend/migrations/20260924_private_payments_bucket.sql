-- Los comprobantes de pago contienen datos financieros: el bucket deja de ser público.
-- El backend (service_role) los sirve con URLs firmadas de 1 hora (getPaymentImageUrl).
-- Las filas antiguas con URL pública completa se siguen resolviendo: el backend extrae la ruta.

update storage.buckets set public = false where id = 'payments';

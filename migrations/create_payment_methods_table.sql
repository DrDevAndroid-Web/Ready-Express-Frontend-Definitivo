-- Crear tabla payment_methods
CREATE TABLE payment_methods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  method_name VARCHAR(100) NOT NULL,
  account_number VARCHAR(255),
  instructions TEXT NOT NULL,
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  order_index INTEGER DEFAULT 999,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Crear índices
CREATE INDEX idx_payment_methods_active ON payment_methods(is_active);
CREATE INDEX idx_payment_methods_order ON payment_methods(order_index);

-- Habilitar RLS
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

-- Política de lectura pública
CREATE POLICY "payment_methods_read_public" ON payment_methods
  FOR SELECT USING (true);

-- Política de inserción para usuarios autenticados
CREATE POLICY "payment_methods_insert_authenticated" ON payment_methods
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Política de actualización para usuarios autenticados
CREATE POLICY "payment_methods_update_authenticated" ON payment_methods
  FOR UPDATE USING (auth.role() = 'authenticated');

-- Política de eliminación para usuarios autenticados
CREATE POLICY "payment_methods_delete_authenticated" ON payment_methods
  FOR DELETE USING (auth.role() = 'authenticated');

-- Insertar datos iniciales
INSERT INTO payment_methods (method_name, account_number, instructions, image_url, is_active, order_index)
VALUES
  (
    'TocoPay',
    '9760 0390 0050 7532',
    'Transfiere a la tarjeta Clásica de TocoPay usando el número de tarjeta proporcionado. Asegúrate de incluir tu nombre en la referencia.',
    'https://plxvkchghkvtbjplwyix.supabase.co/storage/v1/object/public/payment-methods/tocopay-card.jpg',
    true,
    1
  ),
  (
    'Zelle',
    '',
    'Usa Zelle para enviar dinero. Proporciona tu número de teléfono o correo electrónico registrado en tu banco.',
    NULL,
    true,
    2
  );

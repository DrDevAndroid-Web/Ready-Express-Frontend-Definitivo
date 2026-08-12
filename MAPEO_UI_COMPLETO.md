# MAPEO UI COMPLETO - Ready Express Now

**Última actualización:** 2026-07-25  
**Propósito:** Referencia exhaustiva para restaurar, arreglar y mantener todos los elementos visuales, textos, APIs e iconos de la aplicación.

---

## 1. TODOS LOS TEXTOS DE LA PÁGINA (Por sección/componente)

### NAVBAR (Navegación Principal)

| Elemento | Texto | Ubicación |
|----------|-------|-----------|
| Logo Text | Ready Express Now | Navbar izquierda |
| Link | Combos | Navbar #combos |
| Link | Arma tu pedido | Navbar #alimentos |
| Link | ¿Cómo funciona? | Navbar #como-funciona |
| Link | FAQ | Navbar #faq |
| Link | Quíenes somos | quienes-somos.html |
| Link | Contacto | Navbar #contacto |
| Help Button | Ayuda de pago | Navbar derecha |
| Cart Button | Mi Carrito | Navbar derecha (con badge de cantidad) |
| Menu Button | ☰ | Navbar móvil |

### HERO SECTION

| Elemento | Texto |
|----------|-------|
| H1 Principal | Envía comida a tu familia en Guantánamo de forma rápida y segura |
| Descripción | Combos de alimentos esenciales con entrega garantizada. Compra en minutos, sin complicaciones. |
| CTA Primary | Ver combos disponibles |
| CTA Secondary | 📱 Hablar por WhatsApp |

### COMBOS SECTION

| Elemento | Texto |
|----------|-------|
| H2 | Combos listos para enviar |
| Subtítulo | Alimentos esenciales seleccionados. Ideal para apoyo inmediato a tu familia. |
| Placeholder | 📦 Imagen próximamente |
| Error | ⚠️ No pudimos cargar los combos. Verifica tu conexión a internet o intenta de nuevo. |
| Empty State | 🥡 No hay combos disponibles en este momento |

### ALIMENTOS SECTION

| Elemento | Texto |
|----------|-------|
| H2 | Elige los alimentos que necesita tu familia |
| Subtítulo | Filtra por categoría y arma tu pedido a la medida |
| Error | ⚠️ No pudimos cargar los productos. Verifica tu conexión a internet o intenta de nuevo. |
| Empty State | 🛒 No hay productos en esta categoría |

### HOW IT WORKS

| Paso | Título | Descripción |
|------|--------|-------------|
| 1 | 1️⃣ Elige un combo | Explora nuestros combos y selecciona el mejor para tu familia. |
| 2 | 2️⃣ Realiza el pago seguro | Paga con Zelle o Tocopay desde cualquier parte del mundo. |
| 3 | 3️⃣ Nosotros entregamos | Tu pedido llega directamente a Guantánamo. |
| 4 | 4️⃣ Recibes confirmación | Notificación por WhatsApp cuando se entregue. |

### CART PANEL

| Elemento | Texto |
|----------|-------|
| Título | 🛒 Mi Carrito |
| Close Button | ✕ |
| Empty State | Tu carrito está vacío |
| Total Label | Total: |
| Checkout Button | Proceder al Pago |

### CHECKOUT MODAL

| Campo | Label | Requerido |
|-------|-------|-----------|
| sender_name | Nombre de quien envía | ✓ |
| sender_phone | Teléfono / WhatsApp | ✓ |
| receiver_name | Nombre de quien recibe | ✓ |
| customer_address | Dirección en Guantánamo | ✓ |
| receiver_phone | Teléfono de quien recibe | ✓ |
| delivery_notes | Notas de entrega | ✗ |

**Buttons:**
- "Siguiente" (Step 1→2)
- "Atrás" (Step 2→1)
- "Enviar Pedido" (Submit)

### PAYMENT PAGE

| Elemento | Texto |
|----------|-------|
| Method | 🏦 Zelle |
| Method | 💰 Tocopay |
| Dropzone | 📋 Arrastra tu comprobante aquí / o haz clic |
| File types | JPG, PNG (máx. 10MB) |
| Submit | Enviar Comprobante |

### FOOTER

| Sección | Contenido |
|---------|-----------|
| Legal | Términos y Condiciones, Política de Privacidad |
| Contact | 📱 WhatsApp, 💳 Zelle / Tocopay, Facebook |
| Copyright | © 2026 Ready Express Now. Todos los derechos reservados. |

---

## 2. EMOJIS/ICONOS ACTUALES

### Emojis Críticos

| Emoji | Ubicación | Representa | Estado |
|-------|-----------|-----------|--------|
| 🛒 | Carrito, navbar, footer | Carrito de compras | ✓ |
| 📱 | CTA, WhatsApp links | Teléfono/WhatsApp | ✓ |
| 🥡 | Combos icon | Combo de comida | ✓ |
| 🥩 | Proteínas icon | Carnes | ✓ |
| 🌾 | Granos icon | Legumbres | ✓ |
| 🫙 | Aceites icon | Aceites | ✓ |
| 🥛 | Lácteos icon | Leche/Lácteos | ✓ |
| 🧴 | Aseo icon | Limpieza | ✓ |
| 🥤 | Bebidas icon | Bebidas | ✓ |
| 💳 | Payment section | Tarjeta de crédito | ✓ |
| 📋 | Upload/Comprobante | Documento | ✓ |
| ✓ o ✅ | Success states | Correcto/Éxito | ✓ |

### Icon Map (Categories)

```
combos → 🥡
proteinas/carnes/pollo → 🥩/🍗
granos/legumbres → 🌾
aceites → 🫙
lacteos → 🥛
aseo/limpieza → 🧴
bebidas → 🥤
viveres → 🛍
electrodomesticos → ⚡
default → 📦
```

---

## 3. LLAMADAS A API

### Base Configuration

```
Base URL: https://readyexpressnowbackend.versabold.com/api
Support Phone: +53 5 8324155
```

### Endpoints

| Endpoint | Método | Parámetros | Respuesta |
|----------|--------|-----------|----------|
| `/food-combos` | GET | - | `{ data: [{...}] }` |
| `/productos` | GET | - | `{ data: [{...}] }` |
| `/info` | GET | - | `{ data: [{ horario, telefono, whatsapp, ... }] }` |
| `/orders` | POST | Order data | `{ id, ... }` |
| `/payments/upload` | POST | FormData + file | `{ success: true }` |

---

## 4. ERRORES Y MENSAJES

### Validación Checkout

- ❌ "Por favor completa el nombre de quien envía"
- ❌ "Por favor ingresa un teléfono válido"
- ❌ "Por favor completa la dirección de entrega"

### Validación Payment

- ⚠️ "Solo aceptamos imágenes (JPG, PNG)"
- ⚠️ "La imagen es muy grande (máx 5 MB)"
- 📸 "Sube una captura clara del comprobante"

### Success Messages

- ✅ "¡Enviado exitosamente!"
- ✅ "¡Pedido Enviado!"
- "Recibirás notificación por WhatsApp cuando tu pago sea verificado. (15–30 min)"

---

## 5. LOCAL STORAGE

| Key | Propósito |
|-----|-----------|
| `ren_cart` | Carrito persistente |
| `ren_pending_payment` | Pago pendiente (orderId, total, createdAt) |
| `whatsappModalShown` | Control de modal |

---

## 6. ORDEN DE DATOS

```javascript
{
  customer_name: string,
  customer_phone: string,
  customer_address: string,
  sender_name: string,
  sender_phone: string,
  receiver_name: string,
  receiver_phone: string,
  delivery_notes: string,
  items: [{ id, nombre, precio, cantidad }],
  total: number,
  status: "pending"
}
```

---

## 7. FLUJO PRINCIPAL

```
1. Cargar página (GET /info, GET /food-combos, GET /productos)
2. Usuario agrega items → Carrito (localStorage)
3. Usuario abre checkout modal
4. Step 1: Datos remitente (sender_name, sender_phone)
5. Step 2: Datos receptor (receiver_name, address, phone)
6. Submit → POST /orders → Redirect a pago.html
7. Payment page: Select método + Upload comprobante
8. POST /payments/upload → Success screen
```

---

## REFERENCIAS RÁPIDAS

**Teléfono WhatsApp:** +53 5 8324155  
**Métodos de pago:** Zelle, Tocopay  
**Colores principales:** Navy (#0D47A1), Orange (#25D366), Green (#2E7D32)  
**Tipografía:** Lexend (headings), Source Sans 3 (body)  
**Breakpoints:** 375px (mobile), 600px (small), 768px (tablet), 1024px (desktop)

---

**Este documento es la fuente de verdad para toda la UI de Ready Express Now.**

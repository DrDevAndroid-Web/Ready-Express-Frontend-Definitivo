# ReadyExpressNow — Guía para el Agente

## Descripción del Proyecto

E-commerce para envío de productos y comida a domicilio. Los clientes navegan el catálogo, crean una orden y suben un comprobante de pago (Zelle / Tocopay). Un administrador revisa los pagos desde el dashboard y aprueba o rechaza. Al aprobar, se genera un PDF y se envía automáticamente a una impresora via email.

**URL de producción:** `https://readyexpressnowbackend.versabold.com`

## Arquitectura y Stack

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js 18+, Express 5.2.1, ES6 modules (`"type": "module"`) |
| Base de datos | Supabase (PostgreSQL) |
| Auth | Supabase Auth (JWT Bearer) |
| Storage | Supabase Storage |
| Email | Nodemailer (SMTP) + Resend SDK |
| Notificaciones | CallMeBot API (WhatsApp), Epson Connect (impresora) |
| IA | Google Gemini 2.5 Flash (OCR de comprobantes de pago) |
| Imágenes | Sharp (compresión a JPEG), PDFKit (generación de órdenes PDF) |
| Tests | `node:test` + `assert/strict` (nativos, sin dependencias externas) |
| Frontend | HTML5 + CSS3 + JavaScript Vanilla + Bootstrap 5 |

## Estructura de Directorios

```
ReadyExpressNow/
├── backend/
│   ├── server.js              # Punto de entrada (listen + manejo de señales SIGINT/SIGTERM)
│   ├── app.js                 # Express config + middlewares + error handler global
│   ├── package.json
│   ├── .env                   # Variables de entorno (NO commitear)
│   │
│   ├── config/
│   │   ├── env.js             # Carga de variables de entorno
│   │   └── supabase.js        # Crea y exporta el cliente Supabase (se inicializa al importar)
│   │
│   ├── middlewares/
│   │   ├── auth.js            # requireSupabaseUser — valida JWT de Supabase
│   │   ├── security.js        # Helmet + express-rate-limit (1000 req/15min)
│   │   └── upload.js          # Multer memory storage — solo imágenes, max 5MB
│   │
│   ├── routes/
│   │   └── index.js           # Mapa de todas las rutas
│   │
│   ├── modules/
│   │   ├── ai/
│   │   │   └── gemini.service.js      # analyzeWithGemini(base64) → JSON estructurado
│   │   ├── email/
│   │   │   ├── email.service.js       # sendEmail(order, pdfBuffer) via SMTP/Nodemailer
│   │   │   └── resend.js              # sendPrintableOrderEmail(order) via Resend
│   │   ├── orders/
│   │   │   ├── orders.service.js      # createOrder(), normalizeOrderInput() (privada)
│   │   │   └── orders.controller.js
│   │   ├── payments/
│   │   │   ├── payments.service.js    # processPayment(), getPendingPayments(), verifyPayment()
│   │   │   └── payments.controller.js
│   │   ├── products/
│   │   │   ├── products.service.js    # CRUD: food_combos, Productos, Electrodomesticos
│   │   │   └── products.controller.js
│   │   ├── storage/
│   │   │   └── storage.service.js     # uploadImage(), deleteImage()
│   │   └── whatsapp/
│   │       └── whatsapp.service.js    # sendWhatsApp(order) via CallMeBot API
│   │
│   ├── utils/
│   │   ├── http-error.js      # HttpError, badRequest, notFound, conflict, sendError, throwIfSupabaseError
│   │   ├── image.js           # compressImage(buffer) → JPEG buffer (resize 800px, quality 70)
│   │   ├── pdf.js             # generatePDF(order) → Buffer con PDFKit
│   │   └── logger.js
│   │
│   ├── assets/
│   │   └── logo-negocio.png   # Logo del negocio incluido en el PDF (con fallback si falta)
│   │
│   └── test/
│       ├── endpoints.test.js  # Tests de surface area de endpoints (patrón base de referencia)
│       ├── utils.test.js      # Tests unitarios de http-error.js
│       ├── auth.test.js       # Tests de rutas de autenticación
│       ├── orders.test.js     # Tests de validación de órdenes
│       ├── payments.test.js   # Tests de validación de pagos
│       ├── image.test.js      # Tests de compresión de imágenes con Sharp
│       ├── pdf.test.js        # Tests de generación de PDF con PDFKit
│       └── whatsapp.test.js   # Tests de comportamiento sin credenciales de WhatsApp
│
├── frontend/                  # Cliente HTML/JS Vanilla (imports con ?vN como cache-buster)
├── frontend_checkout_slides/  # Variante alternativa del frontend con carousel
└── dashboard/                 # Admin panel HTML/JS
```

## Variables de Entorno

Todas las variables se configuran en `backend/.env`. El servidor NO arranca sin las variables de Supabase.

| Variable | Descripción | Requerida en tests |
|----------|-------------|-------------------|
| `SUPABASE_URL` | URL del proyecto Supabase | Sí (stub: `https://example.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role key** — permite bypass de RLS | Sí (JWT stub con rol service_role) |
| `SUPABASE_ANON_KEY` | Anon key para auth del cliente | Sí (stub: `"anon-key"`) |
| `GEMINI_API_KEY` | API key de Google Gemini para OCR de comprobantes | No (tests la saltean con `skip`) |
| `SMTP_HOST/PORT/USER/PASS/FROM` | Servidor SMTP para envío de emails | No |
| `RESEND_API_KEY` | API key de Resend (email a impresora Epson) | No |
| `RESEND_FROM` | Email remitente en dominio @versabold.com | No |
| `IMPRESORA_EMAIL` | Email de destino Epson Connect | No |
| `WHATSAPP_PHONE` | Número para CallMeBot | No |
| `WHATSAPP_APIKEY` | API key de CallMeBot | No |
| `PORT` | Puerto del servidor (default: 3000) | No |
| `MAX_FILE_SIZE` | Tamaño máximo de imagen en MB (default: 5) | No |

**IMPORTANTE:** `SUPABASE_SERVICE_ROLE_KEY` debe ser la `service_role` key, **nunca** la `anon` key. Si ves errores 403 con código `42501`, estás usando la anon key. El código detecta esto y devuelve un mensaje específico sobre RLS.

## Comandos Frecuentes

```bash
# Desde el directorio backend/

# Instalar dependencias
npm install

# Desarrollo con recarga automática
npm run dev

# Producción
npm start

# Todos los tests (auto-descubrimiento de *.test.js en test/)
npm test

# Tests con reporte detallado (muestra nombre de cada test)
npm run test:verbose

# Solo tests unitarios (sin servidor HTTP, < 3 segundos)
npm run test:unit

# Solo tests que levantan servidor Express
npm run test:http

# Suite para CI (excluye servicios externos)
npm run test:ci

# Un archivo específico
node --test test/utils.test.js
```

## Rutas de la API

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/auth/config` | No | Config de auth para el dashboard |
| POST | `/api/auth/login` | No | Login con email/password |
| POST | `/api/auth/refresh` | No | Renovar sesión con refresh_token |
| GET | `/api/auth/me` | Sí | Usuario autenticado actual |
| GET | `/api/food-combos` | No | Listar combos de comida |
| POST | `/api/combos-comida` | Sí | Crear combo (con imagen) |
| PUT | `/api/combos-comida/:id` | Sí | Actualizar combo |
| DELETE | `/api/combos-comida/:id` | Sí | Eliminar combo |
| GET | `/api/productos` | No | Listar productos variados |
| POST | `/api/productos` | Sí | Crear producto |
| PUT | `/api/productos/:id` | Sí | Actualizar producto |
| DELETE | `/api/productos/:id` | Sí | Eliminar producto |
| GET | `/api/electrodomesticos` | No | Listar electrodomésticos |
| POST | `/api/electrodomesticos` | Sí | Crear electrodoméstico |
| PUT | `/api/electrodomesticos/:id` | Sí | Actualizar electrodoméstico |
| DELETE | `/api/electrodomesticos/:id` | Sí | Eliminar electrodoméstico |
| GET | `/api/info` | No | Información del negocio |
| POST | `/api/orders` | No | Crear orden |
| GET | `/api/orders` | Sí | Listar órdenes |
| POST | `/api/payments/upload` | No | Subir comprobante de pago |
| GET | `/api/payments/pending` | Sí | Pagos pendientes de revisión |
| PATCH | `/api/payments/:id/verify` | Sí | Aprobar o rechazar pago |

## Guía de Testing

### Patrón base (seguir en todos los archivos de test HTTP)

Ver `test/endpoints.test.js`. El patrón es:

```js
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

// 1. Stubs de entorno ANTES del import dinámico de app.js
//    ||= no sobreescribe si ya hay un valor real (permite staging con .env real)
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCIsImlzcyI6InN1cGFiYXNlIn0",
  "test-signature"
].join(".");
process.env.SUPABASE_ANON_KEY ||= "anon-key";

// 2. Import dinámico DESPUÉS de los stubs (el cliente Supabase se crea al importar)
const { default: app } = await import("../app.js");

// 3. Servidor en puerto efímero para evitar conflictos entre archivos de test
let server, baseUrl;
before(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// 4. Helper de request
async function request(path, options) {
  return fetch(`${baseUrl}${path}`, options);
}
```

**Regla clave:** `node --test` corre cada archivo en un proceso separado. Los stubs con `||=` no afectan a otros archivos.

### Qué se puede testear sin `.env`

| Módulo | Archivo de test | Tipo |
|--------|----------------|------|
| `utils/http-error.js` | `utils.test.js` | Unitario puro, sin red |
| `utils/pdf.js` | `pdf.test.js` | Unitario, usa PDFKit (sin red) |
| `utils/image.js` | `image.test.js` | Unitario, usa Sharp (sin red) |
| Rutas de auth (validaciones) | `auth.test.js` | HTTP con stub Supabase |
| Validación de órdenes | `orders.test.js` | HTTP con stub Supabase |
| Validación de pagos | `payments.test.js` | HTTP con stub Supabase |
| WhatsApp sin vars | `whatsapp.test.js` | Unitario, verifica fallo sin credenciales |

### Qué NO testear en automático

- `analyzeWithGemini()` — consume cuota de Gemini API. Usar `{ skip: !process.env.GEMINI_API_KEY }`.
- `sendWhatsApp()` con credenciales reales — llamaría a CallMeBot en producción.
- `sendEmail()` / `sendPrintableOrderEmail()` con SMTP o Resend reales.
- `PATCH /api/payments/:id/verify` con `action: "approve"` — envía email a la impresora física.
- Cualquier operación que confirme datos en Supabase de producción (INSERT/UPDATE real).
- `POST /api/payments/upload` con imagen real que llegue a escribirse en Supabase Storage.

### Tests condicionales para servicios externos

```js
// Al inicio del archivo:
const SKIP_EXTERNAL = !process.env.GEMINI_API_KEY;

// CI: requiere API key real
it("analiza comprobante con Gemini", { skip: SKIP_EXTERNAL }, async () => {
  const result = await analyzeWithGemini(base64Image);
  assert.ok(result.amount > 0);
});
```

### Tests por módulo

#### `utils/http-error.js`
- `HttpError` hereda de `Error`, tiene `.status` y `.details`
- `badRequest(msg)` → status 400, `notFound(msg)` → 404, `conflict(msg)` → 409
- `sendError(fakeRes, err)` → llama `res.status(N).json(...)` con el status del error
- `sendError` sin `.status` en el error → usa 500 como fallback
- `sendError` con error ≥ 500 → llama `console.error`
- `sendError` con `.details` en el error → los incluye en el body JSON
- `throwIfSupabaseError(null)` → no lanza nada
- `throwIfSupabaseError({ code: "42501" })` → lanza `HttpError` 403
- `throwIfSupabaseError({ message: "fallo" })` → lanza `HttpError` 500

#### `utils/pdf.js`
- `generatePDF(order)` con orden completa → Buffer que empieza con `%PDF`
- Con `items` como JSON string → parsea correctamente, no lanza
- Con `items: []` → no lanza, genera PDF válido
- Con `items: null` → no lanza (normaliza a `[]` internamente)
- Con `total: "50.00"` (string) → no lanza

#### `utils/image.js`
- `compressImage(jpegBuffer)` → devuelve Buffer con magic bytes JPEG (`0xFF 0xD8 0xFF`)
- Buffer resultante ≤ tamaño del input para imágenes grandes (se redimensiona a 800px)
- `compressImage(bufferInválido)` → lanza error de Sharp

#### Auth routes
- `GET /api/auth/config` → 200, `{ auth: "backend" }`
- `GET /api/auth/me` sin token → 401, `/Sesion requerida/i`
- `GET /api/auth/me` con formato inválido (`Token xxx`) → 401
- `GET /api/auth/me` con Bearer inválido → 401, `/Sesion invalida/i`
- `POST /api/auth/login` sin body → 400, `/Email y contraseña/i`
- `POST /api/auth/refresh` sin `refresh_token` → 400, `/Refresh token/i`

#### Orders
Testea `normalizeOrderInput()` y `normalizeItem()` via `POST /api/orders`:
- Body vacío `{}` → 400, `/item/i`
- Sin `total` → 400, `/mayor que cero/i`
- `total: 0` → 400
- `total: -5` → 400
- Sin `sender_name` ni `customer_name` → 400, `/remitente/i`
- Sin `sender_phone` ni `customer_phone` → 400, `/telefono/i`
- Sin `receiver_name` → 400, `/receptor/i`
- Sin `receiver_phone` → 400, `/telefono/i`
- Sin `customer_address` → 400, `/direccion/i`
- Item sin nombre → 400, `/nombre/i`
- Item con `precio: -1` → 400, `/precio/i`
- Item con `cantidad: 0` → 400, `/cantidad/i`

#### Payments
Testea `processPayment()` via `POST /api/payments/upload`:
- Sin archivo → 400, `/imagen|comprobante/i`
- Archivo + sin `order_id` → 400, `/orden/i`
- Archivo + method `"PayPal"` → 400, `/Metodo de pago/i`
- Archivo + `amount: 0` → 400, `/monto/i`
- Archivo con MIME `text/plain` → 400, `/imagen/i` (rechazado por Multer)
- `GET /api/payments/pending` sin token → 401
- `PATCH /api/payments/:id/verify` sin token → 401

#### WhatsApp service
- Sin `WHATSAPP_PHONE` ni `WHATSAPP_APIKEY` → lanza `Error` con mensaje sobre configuración
- El error es instancia de `Error` con `.message` no vacío

## Convenciones del Código

### Nombres de tablas Supabase (respetar capitalización exacta)

| Tabla | Nombre en Supabase |
|-------|-------------------|
| Combos de comida | `food_combos` |
| Órdenes | `orders` |
| Pagos | `payments` |
| Productos variados | `Productos` ← **P mayúscula** |
| Electrodomésticos | `Electrodomesticos` ← **E mayúscula** |
| Info del negocio | `informacion_cambiante` |

### Buckets de Supabase Storage

| Bucket | Contenido |
|--------|-----------|
| `payments` | Comprobantes de pago |
| `combos-comida` | Imágenes de combos |
| `porductos-variados` | Imágenes de productos variados — ⚠️ **typo existente, NO corregir** |
| `Electrodomesticos` | Imágenes de electrodomésticos |

**`porductos-variados` tiene un typo heredado.** No renombrar el bucket sin coordinar, ya que rompería las URLs públicas de imágenes existentes.

### Error handling en controllers

```js
// ✅ Correcto — siempre usar sendError de utils/http-error.js
export async function miController(req, res) {
  try {
    const result = await miServicio(req.body);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

// ❌ Incorrecto — nunca hardcodear status directo
res.status(500).json({ error: "algo salió mal" });
```

### Validaciones en servicios

```js
import { badRequest, notFound, conflict, throwIfSupabaseError } from "../../utils/http-error.js";

if (!valor) throw badRequest("Mensaje descriptivo del campo");
if (!data) throw notFound("Recurso no encontrado");
if (existing) throw conflict("Ya existe un registro igual");
throwIfSupabaseError(error, "Contexto de la operación fallida");
```

### IDs de combos de comida

Formato: `combo-{timestamp_en_base36}` — se genera en el frontend antes de enviar al backend.

### Cache-buster del frontend

Los `<script>` tags en los HTML del frontend usan `?vN` (ej: `?v6`). Al modificar archivos JS del frontend, incrementar el número de versión en todos los HTML que lo importan para forzar recarga en producción.

## Checklist de Verificación del Agente

Antes de dar una tarea por completada, verificar:

1. [ ] `npm test` en `backend/` pasa sin `.env`
2. [ ] Nuevo endpoint: controller → service → `sendError(res, err)` en el catch
3. [ ] `SUPABASE_SERVICE_ROLE_KEY` = service_role key, nunca la anon key
4. [ ] Tabla `Productos` con P mayúscula, `Electrodomesticos` con E mayúscula
5. [ ] Bucket `porductos-variados` respeta el typo existente
6. [ ] Tests de servicios externos usan `{ skip: !process.env.API_KEY }`
7. [ ] Nuevos archivos JS del frontend: incrementar `?vN` en los `<script>` del HTML correspondiente
8. [ ] **Cambios en el frontend: ejecutar `node test-android-compat.mjs` y verificar que pase** (ver sección abajo)

---

## Compatibilidad Android — Verificación Obligatoria en Cambios de Frontend

**Cada vez que se modifiquen archivos en `css/`, `js/` o HTML del frontend, ejecutar el test de compatibilidad Android antes de hacer commit:**

```bash
# Levantar servidor local desde frontend/
npx serve frontend -p 4444 &

# Ejecutar test de compatibilidad Android + iOS (Playwright global)
node "C:/Users/100270999/Documents/PRPOGRAMACION/VersaBold_Innovations/Navegador de Prueba/tests/readyexpressnow-android-compat.mjs"
```

El script simula un dispositivo Android (Chrome Mobile, viewport 412×915 — Galaxy S21) usando Playwright con el motor Chromium.

### Qué verifica el test

| Check | Qué detecta |
|-------|-------------|
| `body.style.overflow` limpio | Sin inline overflow que bloquee scroll en Android |
| `body.modal-open` al abrir modal/carrito | La clase CSS controla el bloqueo, no el style inline |
| `modal-open` se limpia al cerrar | No deja el scroll permanentemente bloqueado |
| `cart-panel` height válido | Sin `height:0` ni `height:100vh` roto |
| Navegación paso 1 → 2 → 3 del checkout | El flujo de pasos completo funciona |
| `scrollTo` sin errores JS | El fallback no lanza excepciones en Chrome Mobile |
| `:hover` inactivo en dispositivo touch | `@media (hover:hover) and (pointer:fine)` bien aplicado |
| Métodos de pago cargados (mock) | El render del paso 3 funciona |
| Selección de método de pago por tap | `click` registra `.selected` correctamente |
| Sin errores JS críticos | Sin excepciones no capturadas en consola |

### Problemas comunes en Android a revisar manualmente

Estos no se pueden verificar con Playwright headless — revisarlos al hacer cambios de layout:

- **`position: sticky` en headers dentro de `overflow:auto`** — en Chrome Android puede no funcionar si el padre tiene `overflow:hidden`.
- **`vh` en inputs dentro de modales** — el teclado virtual en Android reduce el viewport, los elementos con `height:100vh` se comprimen. Usar `dvh` o `min-height` relativo.
- **`type="number"` en inputs** — en Android muestra teclado numérico correcto, pero `e`, `+`, `-` pasan como valores. Validar en JS.
- **`tap` delay de 300ms** — ya resuelto con `touch-action:manipulation` si el CSS lo incluye. Verificar que los botones de navegación entre pasos lo tengan.
- **Autofill de Chrome** — Chrome Android puede autocompletar campos con datos incorrectos. Los inputs tienen `autocomplete` apropiado.
- **Zoom en inputs < 16px** — Android Chrome también hace zoom si `font-size < 16px`. El media query `@media (max-width:600px) { font-size: 16px }` ya cubre esto, pero verificar que aplique a inputs nuevos.

### Cómo interpretar fallos del test

- **Fallo en WebKit + pasa en Chromium** → bug específico de iOS/Safari
- **Fallo en Chromium + pasa en WebKit** → bug específico de Android/Chrome
- **Fallo en ambos** → bug general (puede ser de entorno local o un bug real en ambas plataformas)
- **Fallo solo en "Métodos de pago cargados"** → limitación de CORS en localhost, no es un bug real; pasa en producción

## Notas de Despliegue

- **Backend productivo:** `https://readyexpressnowbackend.versabold.com`
- `app.set("trust proxy", 1)` está configurado — necesario para que rate limiting funcione correctamente detrás de proxy reverso
- Para actualizar variables de entorno en producción: reiniciar el servidor después del cambio
- El servidor carga variables de entorno desde el entorno del proceso (no desde `dotenv.config()` en runtime) — verificar que el hosting inyecta las variables directamente

## Flujo de Deploy del Frontend

### Repositorio y Vercel
- **Repo GitHub:** `https://github.com/DrDevAndroid-Web/Ready-Express-Frontend-Definitivo`
- **Proyecto Vercel:** `ready-express-frontend-definitivo`
- **URL de preview (última):** `ready-express-frontend-definitivo-awh3hrf58.vercel.app`
- **URL de producción:** `https://readyexpressnow.versabold.com`
- **Rama principal:** `master`

### Reglas de Deploy

⚠️ **NUNCA hacer push directo a `master` sin instrucción explícita del usuario.**

| Acción | Cuándo | Comando |
|--------|--------|---------|
| Preview | Por defecto, en cada cambio | Crear rama `preview/descripcion`, hacer push, Vercel genera URL de preview automáticamente |
| Producción | **Solo cuando el usuario lo indique explícitamente** | `git push origin master` → Vercel despliega a producción |

### Flujo estándar para cambios en el frontend

```bash
# 1. Crear rama de preview desde master
git checkout -b preview/descripcion-del-cambio

# 2. Hacer los cambios y commit
git add frontend/archivo-modificado.html frontend/js/archivo.js
git commit -m "tipo: descripción"

# 3. Push → Vercel crea preview automáticamente
git push origin preview/descripcion-del-cambio

# 4. Vercel genera URL de preview (NOT producción)
# → El usuario revisa y cuando confirme, se hace merge a master
```

### Promover preview a producción

Solo cuando el usuario diga explícitamente "sube a producción" o equivalente:

```bash
git checkout master
git merge preview/descripcion-del-cambio
git push origin master
# → Vercel despliega automáticamente a readyexpressnow.versabold.com
```

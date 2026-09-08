# ReadyExpressNow — SEO Pendientes
**Auditoría:** Agosto 30, 2026 · **Sprint 1 completado:** Septiembre 1, 2026

---

## Sprint 1 — COMPLETADO ✓

- [x] `sitemap.xml` actualizado a URLs canónicas (`www.` + sin `.html`)
- [x] `vercel.json` con redirect no-www → www y `cleanUrls: true`
- [x] Canonical tag en las 5 páginas
- [x] Open Graph + Twitter Card en `index.html`
- [x] JSON-LD `Organization` + `FAQPage` en `index.html`
- [x] Enlaces internos (navbar/footer/mobile) migrados a rutas canónicas
- [x] Alt text del carrusel con descripción real por slide

---

## Mes 1 — CRÍTICO

### 1. Página `/guantanamo` — mayor techo de tráfico orgánico
**Por qué:** Dímelo Cubano y EnviosCuba ya tienen páginas dedicadas a Guantánamo.
Ready Express Now opera exclusivamente ahí y no tiene ninguna URL que compita por ese término.

**Estructura prevista:**
- H1: "Envío de comida a Guantánamo, Cuba"
- Sección municipios cubiertos (requiere confirmar cuáles)
- Combos más vendidos en HTML estático (no depende de JS — indexable por Google)
- Tiempos de entrega por zona (city 24h / municipios alejados 48–72h)
- FAQ específico de Guantánamo (Baracoa, Caimanera, etc.)
- Testimonios con contexto geográfico
- Schema `Service` con `areaServed: Guantánamo, Cuba`

**Datos pendientes de confirmar antes de implementar:**
- [ ] ¿Qué municipios de Guantánamo cubren exactamente?
- [ ] ¿Tiempos de entrega diferenciados por zona?
- [ ] ¿Cuáles son los 3–5 combos más vendidos (nombre + precio)?

**Esfuerzo estimado:** Medio día una vez confirmados los datos.

---

### 2. URLs propias por combo/producto — el catálogo invisible
**Por qué:** Todo el catálogo vive en divs vacíos que `products.js` rellena en cliente.
Google no puede indexar ningún producto por nombre. Es el contenido con mayor intención de compra y hoy no posiciona.

**Opciones de implementación:**
- **Opción A — Migración a Next.js** *(recomendada)*: SSG/ISR genera una URL por producto automáticamente desde la API. Resuelve el problema de raíz y escala con el catálogo.
- **Opción B — HTMLs estáticos por combo**: Generar un `.html` por combo desde el backend. Funciona pero requiere regenerar manualmente al cambiar precios/disponibilidad.

**Schema necesario:** `Product` + `Offer` por página de combo.

**Nota:** Este ítem es el argumento más fuerte para hacer la migración a Next.js ahora.

---

### 3. Google Business Profile
**Por qué:** Sin ficha en Google. Competidores aparecen en búsquedas del nicho; Ready Express Now no.
Los 4 testimonios reales del sitio son contenido listo para pedir reseñas verificadas.

**Acciones (gestión manual, sin código):**
- [ ] Crear/reclamar ficha en Google Business Profile
- [ ] Completar: nombre, categoría, descripción, fotos, horario
- [ ] Pedir reseñas a clientes con pedidos ya entregados

---

### 4. Conectar GSC + GA4 — BLOQUEADOR DE MÉTRICAS
**Por qué:** Sin esto no hay datos reales de tráfico, keywords ni conversión del checkout.
Bloquea medir el impacto de todo lo demás.

**Acciones (gestión del cliente):**
- [ ] Compartir acceso de lectura a Google Search Console
- [ ] Compartir acceso a propiedad de Google Analytics 4
- [ ] Verificar que los eventos de ecommerce (add_to_cart, purchase) estén configurados en GA4

---

## Mes 1–2 — ALTA

### 5. Aparecer en comparativas del nicho
**Por qué:** Se identificó "Cuba a Pulso" como medio que publica comparativas de tiendas de envío a Cuba.
Ready Express Now no aparece en ninguna. Es una vía de autoridad más rápida que el ranking orgánico puro.

**Acciones (gestión manual, sin código):**
- [ ] Identificar artículos de comparativas donde aparecen Cubatel, Dímelo Cubano, EnviosCuba
- [ ] Contactar a "Cuba a Pulso" y medios similares para solicitar inclusión
- [ ] Preparar ficha del negocio: descripción, precios, zonas, métodos de pago

---

## Mes 2 — MEDIA

### 6. Ampliar FAQ con zonas de entrega en Guantánamo
**Por qué:** El FAQ actual menciona "24–72h según la zona" sin desglosar.
Preguntas específicas capturan long-tail con intención alta.

**Preguntas a añadir (propuesta):**
- ¿Entregan en todos los municipios de Guantánamo?
- ¿Cuánto tarda la entrega a Baracoa o Caimanera?
- ¿Cómo me confirman que el pedido llegó a Guantánamo?

**Impacto:** Alimenta también el JSON-LD `FAQPage` ya implementado — solo añadir las nuevas preguntas al bloque existente.

---

### 7. SRI de Font Awesome
**Por qué:** `index.html` carga Font Awesome sin atributo `integrity`. Bootstrap sí lo tiene.
Señalado en auditoría como optimizable. Impacto SEO bajo pero mejora de seguridad.

**Fix:** Añadir `integrity` y `crossorigin` al `<link>` de Font Awesome en las 3 páginas que lo cargan (`index.html`, `quienes-somos.html`, `terminos.html`).

**Esfuerzo:** 5 minutos.

---

## Referencia — Competidores del nicho

| Competidor | Dominio | Solapamiento | Ventaja que tienen |
|---|---|---|---|
| Dímelo Cubano | dimelocubano.com | Alto | Página propia para Guantánamo |
| EnviosCuba | envioscuba.com | Alto | Directorio por provincia incl. Guantánamo |
| Cubatel | cubatel.com | Alto | Tienda establecida, toda la isla |
| Cuballama | cuballama.com | Medio | Catálogo más amplio |
| Combitos | combitos.com | Medio | Combos por categoría |

---

## Métricas objetivo — 90 días

| Métrica | Hoy | Objetivo |
|---|---|---|
| Saltos de redirección por URL | 2 | 0 ✓ resuelto |
| Productos con URL propia | 0 | 100% del catálogo |
| Tipos de Schema implementados | 2 (Org + FAQ) | 3+ (+ Service/Product) |
| Página de destino Guantánamo | No | Sí |
| Ficha Google Business Profile | No | Sí |
| Acceso GSC/GA4 | No | Sí |

# Tarifas de TropiPay y coste real de cobrar y mover el dinero a EE. UU.

**Fecha:** 30 de septiembre de 2026 · **Proyecto:** ReadyExpressNow · **Tipo de cambio usado:** 1 € = 1,16 USD (media de septiembre de 2026)

## 1. Respuesta corta

- **Decisión aplicada (30/09/2026): recargo del 7 % sobre todos los precios de la tienda (productos y entrega), con el precio final terminado en ,99.** Se configura en la APK de administración → Configuración → Precios de la tienda.
  - El cliente ve el precio final desde el catálogo, igual para todos los métodos de pago. Un producto configurado a 100 USD se muestra a 107,99.
  - Pedido típico (combo de 57 + entrega de 18,99 = 75,99): el cliente paga **81,98 USD** y, tras las comisiones de TropiPay y el traslado del dinero (ruta A), quedan **~0,94 USD** de margen.
  - La parte fija de TropiPay (0,50 €) va incluida en el porcentaje. Solo un pedido de un único artículo de ~10 USD queda ligeramente por debajo (−0,19 USD).
  - En pedidos pagados con Zelle o TocoPay (sin comisión de tarjeta), el recargo es margen.
- Fórmula alternativa calculada inicialmente, por pago y no por precio: `6 % del pedido + 0,65 USD` (sección 6).
  - Cubre el cobro de TropiPay, las conversiones de divisa y el traslado del dinero a un banco de EE. UU., con un margen pequeño (unos 0,20–0,28 USD por pedido).
- **Ruta recomendada para llevar el dinero a EE. UU.:** no uses la transferencia SWIFT de TropiPay (es la más cara, ~9 % en total). Usa una de estas dos:
  - **Ruta A:** EUR → USDC dentro de TropiPay → envío de USDC por la red Solana (0 % + gas) → exchange en EE. UU. (p. ej. Coinbase: USDC→USD 1:1 sin comisión) → ACH gratis a tu banco.
  - **Ruta C (sin cripto):** SEPA desde TropiPay a una cuenta en EUR a tu nombre (p. ej. Wise) → conversión a USD → ACH a tu banco.
- **Cuando TropiPay active el cobro con tarjeta directo a USDC** (hoy figura como "Próximamente"), el coste baja a ~5,5 % y el mismo recargo te deja ~1 USD de margen por pedido.
- **Antes de fijar el precio definitivo**, pide a TropiPay por escrito los tres datos que no publica (sección 4). El recargo está calculado suponiendo un 1 % en cada conversión de divisa.

## 2. Aclaraciones sobre los supuestos

| Supuesto | Qué dicen la documentación y nuestras pruebas |
|---|---|
| "EU" = destino del dinero | En este informe interpreto **EU = Estados Unidos (EE. UU.)**, y Europa aparte. Si era la Unión Europea, la ruta barata es SEPA directo (sección 5, nota). |
| "TropiPay solo acepta VISA en euros" | **No es así.** TropiPay acepta VISA, Mastercard, Discover, UnionPay y Diners. Nuestra integración ya cobra en **USD**: en el sandbox la pasarela mostró "75,99 USD" y la procesadora (Trust Payments) recibió la moneda `USD`. Lo que ocurre es que **la cuenta** de TropiPay solo tiene saldo en **EUR o USDC**, así que un cobro en USD se convierte a la moneda de la cuenta. |
| "Mi cuenta es en USDC" | TropiPay tiene cuentas business en **EUR y USDC**, independientes. **El cobro con tarjeta a clientes directo a USDC está anunciado como "Próximamente"**, así que hoy los cobros con tarjeta llegan a la cuenta en EUR. Desde USDC se puede enviar a wallets externas (solo red **Solana**) y a bancos **SEPA** (el destinatario recibe euros). |

## 3. Tarifas oficiales de TropiPay

Leídas de `tropipay.com/precios` el 30/09/2026 (página dinámica, capturada con navegador).

### Cuenta business en EUR

| Concepto | Tarifa |
|---|---|
| Apertura y mantenimiento | Gratis |
| **Cobros a tarjetas de terceros** (enlace de pago / web) | **3,45 % + 0,50 €** |
| Cobros con saldo TropiPay | 1 % |
| Cobros con giftcards | 1 % |
| Cobros de tarjetas de alquiler vacacional | 6 % |
| Ingresos por transferencia bancaria / por tarjeta propia | 3 % |
| Solicitud de retroceso de una transferencia | 25 € |
| Modificación de una transferencia SWIFT internacional | 25 € |

**Transferencias bancarias de salida desde la cuenta EUR (tarifa fija por envío):**

| Importe enviado | España | Europa (SEPA) | **Internacional (SWIFT; aquí entra EE. UU.)** | Cuba |
|---|---|---|---|---|
| Hasta 1.000 € | 3 € | 5 € | **20 €** | 13,40–16,40 € |
| 1.000,01–1.500 € | 3 € | 5 € | **30 €** | 19,40 € |
| 1.500,01–2.500 € | 5 € | 10 € | **30 €** | 19,40 € |
| 2.500,01–5.000 € | 5 € | 11 € | **35 €** | 26,40 € |
| 5.000,01–8.000 € | 6 € | 12 € | **55 €** | 52 € |
| 8.000,01–15.000 € | 12 € | 22 € | **75 €** | 72 € |
| Más de 15.000 € | 27 € | 42 € | **180 €** | 182 € |

Mínimos por envío: 0,5 € interno, 5 € zona SEPA, 10 € fuera de SEPA, 21 € a Cuba (centro de ayuda de TropiPay).

### Cuenta business en USDC

| Concepto | Tarifa |
|---|---|
| Apertura y mantenimiento | Gratis (oferta de lanzamiento) |
| **Cobros a tarjetas de terceros** | **4,5 % + 0,50 €** (el cobro directo a USDC figura como "Próximamente") |
| Cobros con saldo TropiPay / ingreso desde saldo TropiPay | 0 % (oferta de lanzamiento) |
| **Envío a transferencia bancaria SEPA** (el destinatario recibe EUR) | **1,75 % + 0,40 €** |
| **Envío a wallet cripto externa** (misma red y token; solo Solana) | **0 % + gas** (céntimos) |
| Ingreso con tarjeta | 4,5 % + 0,50 € |
| Ingreso por transferencia bancaria (mismo titular) | 1,75 % + 0,40 € |
| Ingreso por cripto (misma red y token) | 0 % |
| Transferencias USDC entre usuarios TropiPay | Gratis |

**Tarifas negociables:** en su página de pagos, TropiPay indica que para cuentas business puede ofrecer "una estructura de comisiones personalizada según tu volumen de negocio". Con volumen, vale la pena negociar el 3,45 %.

## 4. Lo que TropiPay no publica (pedir por escrito)

1. **Tipo de cambio al cobrar en USD con la cuenta en EUR:** qué margen aplican sobre el cambio de mercado. En los cálculos supongo **1 %**.
2. **Coste de convertir EUR ↔ USDC** ("Dólares digitales"): comisión o margen. Supongo **1 %**.
3. **Fecha de activación del cobro con tarjeta directo a USDC**, y si esa tarifa (4,5 % + 0,50 €) será negociable.
4. Coste de un **contracargo** (chargeback) y de una **devolución** al cliente.

Si alguno de los dos márgenes resulta ser 0,5 %, el coste total baja ~0,5 puntos; si fuera 2 %, sube ~1 punto. En ese caso habría que subir el recargo al 7 %.

## 5. Rutas para llevar el dinero a un banco de EE. UU.

Coste total sobre lo que paga el cliente, incluyendo el cobro con tarjeta (3,45 % + 0,50 €) y una conversión de 1 % al cobrar en USD:

| Ruta | Pasos | Coste de mover el dinero | **Coste total** (pedido de 75,99 USD) |
|---|---|---|---|
| **A** (recomendada, hoy) | Cuenta EUR → convertir a USDC → enviar USDC por Solana (0 % + gas) → Coinbase (USDC→USD 1:1, sin comisión) → ACH gratis | ~1 % (conversión EUR→USDC, sin confirmar) | **≈ 6,2 %** |
| **C** (recomendada, sin cripto) | Cuenta EUR → SEPA "Europa" a una cuenta EUR a tu nombre (p. ej. Wise) → convertir a USD → ACH a tu banco | SEPA 22 € por lote de ~8.600 € (0,26 %) + conversión ~0,5–0,7 % | **≈ 6,1 %** |
| B (desaconsejada) | Cuenta EUR → SWIFT "Internacional" → banco EE. UU. | SWIFT 75 € por lote (0,87 %) + bancos intermediarios y cobro de recepción (~40 USD, 0,4 %) + conversión EUR→USD del banco (1–3 %) | **≈ 8,5 %** |
| D (futuro) | Cobro con tarjeta directo a USDC (4,5 % + 0,50 €) → Solana → Coinbase → ACH | ~0 % | **≈ 5,3 %** |

Lote de referencia: 10.000 USD al mes (~130 pedidos), enviado una vez al mes. Con lotes más pequeños, la tarifa fija de SEPA o SWIFT pesa más, así que conviene agrupar los envíos.

**Notas por ruta:**
- **A:**
  - Tu exchange debe aceptar **USDC en la red Solana** (Coinbase lo acepta). Los retiros ACH de Coinbase son gratuitos, con un límite habitual de 25.000 USD/día para cuentas nuevas.
  - Si conviertes más de 5 millones al mes, Coinbase aplica un 0,10 % sobre el exceso.
  - Revisa con tu contable cómo registrar el paso por USDC.
- **C:** comprueba las tarifas de Wise o de tu banco en el momento; las fuentes externas dan entre 0,5 % y 1,5 % para EUR→USD.
- **Si "EU" era la Unión Europea:** con la cuenta EUR, basta la transferencia SEPA (5–22 € por envío). Desde la cuenta USDC, cuesta 1,75 % + 0,40 €.

## 6. Cuánto sumar a cada pago

### Fórmula exacta
Para que te llegue el precio del producto `N` libre de comisiones, el cliente debe pagar:

```
P = (N + 0,58) / (1 − p)
```

- `0,58 USD` = los 0,50 € fijos del cobro.
- `p` = porcentaje total de la ruta: A 5,45 %, C 5,36 %, B 7,72 %, D 4,50 %.

| Pedido `N` | Ruta A | Ruta C | Ruta B | Ruta D |
|---|---|---|---|---|
| 40 USD | +2,92 (7,3 %) | +2,88 (7,2 %) | +3,97 (9,9 %) | +2,49 (6,2 %) |
| 75,99 USD | +4,99 (6,6 %) | +4,92 (6,5 %) | +6,99 (9,2 %) | +4,19 (5,5 %) |
| 150 USD | +9,26 (6,2 %) | +9,11 (6,1 %) | +13,18 (8,8 %) | +7,68 (5,1 %) |

### Recargo propuesto: `6 % + 0,65 USD`
Es fácil de explicar al cliente ("cargo por pago con tarjeta") y cubre las rutas A, C y D en pedidos de 20 a 300 USD. **No cubre la ruta B.**

| Pedido | Recargo | Total que paga el cliente | Margen neto que te queda (ruta A / C / D) |
|---|---|---|---|
| 40 USD | 3,05 | 43,05 | positivo en las tres |
| 75,99 USD | 5,21 | 81,20 | 0,20 / 0,28 / 0,98 |
| 150 USD | 9,65 | 159,65 | positivo en las tres |

**Recomendación de implementación:** calcularlo en el backend (`backend/modules/orders/pricing.js`, igual que el recargo de entrega). Mostrarlo en el checkout como una línea aparte, **solo al elegir TropiPay**. Zelle y TocoPay no tienen este coste.

## 7. Escenarios por país del cliente

Pedido de **75,99 USD** con el recargo propuesto: **81,20 USD cobrados por TropiPay** (≈ 70,00 €). A eso se suma lo que cobra **el banco del cliente**, que no pasa por nosotros pero influye en si termina comprando:

| País | Qué añade el banco del cliente | Total aproximado para el cliente | Notas |
|---|---|---|---|
| **EE. UU.** | 0–3 % de "foreign transaction fee" en algunas tarjetas, porque el comercio (TropiPay/Trust Payments) está en España aunque se cobre en USD. Muchas tarjetas cobran 0 %. | 81,20 – 83,64 USD | Cobrar en USD le evita al cliente la conversión de divisa. |
| **México** | 1–3 % por transacción internacional + tipo de cambio del banco (Banxico + ~1 %) | 82,01 – 83,64 USD | Tarjetas en MXN: el cliente ve el cargo en pesos. |
| **Brasil** | **IOF 3,5 %** (en vigor desde el 23/05/2025) + margen cambiario del banco | ≈ 85,7 USD o más | El más caro para el cliente. Conviene mostrarle Zelle o PIX (vía pago asistido) como alternativa. |
| **Uruguay** | 0–1,5 % + IVA (≈ 0–1,83 %). Muchas tarjetas uruguayas facturan en USD. | 81,20 – 82,69 USD | Suele ser barato. |
| **Europa** | Tarjeta en EUR pagando en USD: 0–3 % según el banco (neobancos, 0 %) | 81,20 – 83,64 USD (≈ 70–72 €) | Si hubiera mucho cliente europeo, se podría cobrar en EUR, lo que ahorra una conversión, pero hoy toda la tienda está en USD. |

Las comisiones de red por pago internacional (Visa ~1 %, Mastercard ~0,6 %) las asume el procesador. Supongo que están incluidas en la tarifa plana de TropiPay (3,45 %).

## 8. Riesgos y recomendaciones

1. **Pedir a TropiPay los datos de la sección 4** antes de publicar el recargo. Si las conversiones cuestan más del 1 %, sube el recargo al 7 %.
2. **Negociar la tarifa de cobro** con el equipo comercial de TropiPay cuando haya volumen.
3. **Agrupar las retiradas** (semanal o mensual) para diluir las tarifas fijas.
4. **Contracargos y devoluciones:** reservar un colchón (el margen actual es pequeño) y registrar en la orden el recargo cobrado, para devolverlo si se cancela.
5. **Brasil:** es el país donde el cliente paga más por su banco. Ofrecerle métodos locales puede mejorar la conversión.
6. **Legal y comunicación:** mostrar el recargo **antes** de pagar, con su nombre ("Cargo por pago con tarjeta"), y actualizar los términos. Algunas marcas de tarjeta y países limitan los recargos al cliente; revisarlo con TropiPay.
7. **Primer cobro real en producción:** verificar en el panel de TropiPay a qué cuenta llega (EUR o USD convertido) y con qué tipo de cambio, para confirmar el supuesto del 1 %.

## 9. Supuestos y fuentes

**Supuestos:**
- 1 € = 1,16 USD.
- Conversiones de divisa de TropiPay al 1 % cada una (no publicadas).
- Lote mensual de 10.000 USD.
- Wise o banco EUR→USD al 0,65 %.
- Bancos intermediarios y cobro de recepción de SWIFT: ~40 USD.
- Gas de Solana despreciable.

**Fuentes:**
- TropiPay, precios oficiales (EUR, USDC y tabla de transferencias), leídos el 30/09/2026: https://www.tropipay.com/precios
- TropiPay, cuentas empresariales en USDC: https://lp.tropipay.com/cuentas-empresariales-usdc
- TropiPay, cuentas multimoneda y adquirencia: https://www.tropipay.com/cuentas-multimoneda
- TropiPay, ayuda "Tarifas": https://help.tropipay.com/knowledge-base/tarifas-que-costes-y-comisiones-tiene-tropipay/
- TropiPay, ayuda "Nuevos precios para las transferencias de salida": https://help.tropipay.com/knowledge-base/nuevos-precios-para-las-transferencias-de-salida/
- TropiPay, ayuda "¿Con qué tarjetas se puede pagar?": https://help.tropipay.com/knowledge-base/con-que-tarjetas-se-puede-pagar/
- Verificación propia en el sandbox de TropiPay (30/09/2026): cobro en USD de 75,99, pasarela Trust Payments con moneda USD.
- Coinbase, USDC→USD y ACH: https://eco.com/support/en/articles/15039728-convert-usdc-to-bank-account-fastest-routes-in-2026 y https://www.theblock.co/amp/post/274986/coinbase-to-charge-fees-on-usdc-to-usd-conversions-over-75-million
- Wise, EUR→USD (referencia externa): https://remitanalyst.com/send-money-to-european-union-from-usa/remit-profiles/transferwise/
- Comisiones de red por pago internacional: https://www.merchantmaverick.com/what-is-a-cross-border-fee-for-credit-card-processing
- Brasil, IOF 3,5 %: https://passageirodeprimeira.com/governo-federal-anuncia-aumento-das-aliquotas-de-iof-cartao-de-credito-e-compra-de-moeda-estrangeira-serao-impactados/
- México, comisión internacional: https://www.mercadopago.com.mx/blog/evitar-comisiones-tarjeta-fuera-mexico
- Uruguay, cartilla Scotiabank Visa Infinite: https://cdn.agilitycms.com/scotiabank-uruguay/pdf/F2387_Cartilla_Visa_Infinite.pdf
- Tipo de cambio EUR/USD, septiembre de 2026: https://www.valutafx.com/history/usd-eur-2026-09-10

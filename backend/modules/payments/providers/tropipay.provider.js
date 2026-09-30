const TOKEN_MARGIN_MS = 60_000;
let tokenCache = null;

function baseUrl() {
  return String(process.env.TROPIPAY_URL_BASE || process.env.TROPIPAY_API_BASE_URL || "https://sandbox.tropipay.me").replace(/\/$/, "");
}

async function tropipayFetch(path, options = {}) {
  const response = await fetch(`${baseUrl()}${path}`, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.message || body?.error || `TropiPay respondió HTTP ${response.status}`);
    error.status = response.status;
    error.providerBody = body;
    throw error;
  }
  return body;
}

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + TOKEN_MARGIN_MS) return tokenCache.value;

  const clientId = process.env.TROPIPAY_CLIENT_ID;
  const clientSecret = process.env.TROPIPAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Faltan TROPIPAY_CLIENT_ID o TROPIPAY_CLIENT_SECRET");

  const body = await tropipayFetch("/api/v3/access/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" })
  });

  if (!body?.access_token) throw new Error("TropiPay no devolvió access_token");
  tokenCache = { value: body.access_token, expiresAt: now + Number(body.expires_in || 300) * 1000 };
  return tokenCache.value;
}

// Pide (o reutiliza) el token en segundo plano mientras se consultan la orden y la transacción
export function warmTropipayToken() {
  getAccessToken().catch(error => console.warn("[tropipay] No se pudo precargar el token:", error.message));
}

export function getTropipayConfigurationStatus() {
  return {
    baseUrl: baseUrl(),
    hasClientId: Boolean(process.env.TROPIPAY_CLIENT_ID),
    hasClientSecret: Boolean(process.env.TROPIPAY_CLIENT_SECRET),
    hasApiKey: Boolean(process.env.TROPIPAY_API_KEY || process.env.TROPIPAY_CLIENT_ID),
    hasApiSecret: Boolean(process.env.TROPIPAY_API_SECRET || process.env.TROPIPAY_CLIENT_SECRET),
    currency: String(process.env.TROPIPAY_CURRENCY || "USD").toUpperCase()
  };
}

// Objeto `client` de POST /api/v3/paymentcards. Con singleUse=true TropiPay exige
// name, lastName, email, phone, address, countryIso/countryId y termsAndConditions.
export function buildTropipayClient(order) {
  const payer = order?.payer_details || {};
  const fullName = String(order?.sender_name || order?.customer_name || "").trim();
  const [firstFromFull, ...restFromFull] = fullName.split(/\s+/);

  const client = {
    name: String(order?.sender_first_name || firstFromFull || "").trim(),
    lastName: String(order?.sender_last_name || restFromFull.join(" ")).trim(),
    email: String(order?.customer_email || "").trim(),
    phone: String(order?.sender_phone || order?.customer_phone || "").trim(),
    address: String(payer.address || "").trim(),
    countryIso: String(payer.country_iso || "").trim().toUpperCase(),
    termsAndConditions: Boolean(payer.terms_accepted_at)
  };
  if (payer.city) client.city = String(payer.city).trim();
  if (payer.state) client.state = String(payer.state).trim();
  if (payer.post_code) client.postCode = String(payer.post_code).trim();
  return client;
}

// Devuelve la lista de campos requeridos que faltan (vacía si el cliente es válido)
export function missingTropipayClientFields(client) {
  const labels = { name: "nombre", lastName: "apellidos", email: "email", phone: "telefono", address: "direccion", countryIso: "pais", termsAndConditions: "aceptacion de terminos" };
  return Object.keys(labels).filter(key => !client[key]).map(key => labels[key]);
}

export async function createTropipayPayment({ order, transactionId }) {
  const token = await getAccessToken();
  const currency = String(process.env.TROPIPAY_CURRENCY || "USD").toUpperCase();
  const frontend = String(process.env.FRONTEND_PUBLIC_URL || "https://www.readyexpressnow.com").replace(/\/$/, "");
  const webhook = String(process.env.TROPIPAY_NOTIFICATION_URL || `${process.env.BACKEND_PUBLIC_URL || "https://readyexpressnowbackend.versabold.com"}/api/payments/tropipay/webhook`);
  const reference = order.order_reference || order.id;
  const amount = Math.round(Number(order.total) * 100);

  const client = buildTropipayClient(order);

  const payment = await tropipayFetch("/api/v3/paymentcards", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      reference,
      concept: `ReadyExpressNow ${reference}`,
      description: `Pedido ${reference}`,
      amount,
      currency,
      singleUse: true,
      favorite: false,
      reasonId: 4,
      serviceDate: new Date().toISOString().slice(0, 10), // TropiPay espera YYYY-MM-DD
      lang: "es",
      urlSuccess: `${frontend}/pago-confirmado.html?order=${encodeURIComponent(reference)}&payment=${encodeURIComponent(transactionId)}&estado=procesando`,
      urlFailed: `${frontend}/pago-rechazado.html?order=${encodeURIComponent(reference)}&payment=${encodeURIComponent(transactionId)}&estado=rechazado`,
      urlNotification: webhook,
      paymentMethods: ["EXT", "TPP"],
      client
    })
  });

  return payment;
}

export async function getTropipayPayment(paymentcardId) {
  const token = await getAccessToken();
  return tropipayFetch(`/api/v3/paymentcards/${encodeURIComponent(paymentcardId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
}

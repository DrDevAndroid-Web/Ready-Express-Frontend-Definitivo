import { createHash } from "node:crypto";

const entries = new Map();
const pending = new Map();

export const PUBLIC_CACHE_KEYS = Object.freeze({
  catalog: "public:catalog",
  foodCombos: "public:food-combos",
  products: "public:products",
  appliances: "public:appliances",
  info: "public:info",
  locations: "public:locations",
  paymentMethods: "public:payment-methods"
});

export async function getCached(key, loader, ttlMs) {
  const cached = entries.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const running = pending.get(key);
  if (running) return running;

  const promise = Promise.resolve().then(loader).then(value => {
    entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

export function invalidateCache(...keys) {
  keys.flat().filter(Boolean).forEach(key => entries.delete(key));
}

export function sendPublicJson(req, res, payload, { maxAge = 60, staleWhileRevalidate = 300 } = {}) {
  const serialized = JSON.stringify(payload);
  const etag = `"${createHash("sha1").update(serialized).digest("hex")}"`;
  res.set("Cache-Control", `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`);
  res.set("ETag", etag);
  res.set("Vary", "Accept-Encoding");
  if (req.get("If-None-Match") === etag) return res.status(304).end();
  return res.type("json").send(serialized);
}

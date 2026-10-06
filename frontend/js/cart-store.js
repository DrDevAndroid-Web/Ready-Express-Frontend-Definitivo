const STORAGE_KEY = "ren_cart";

let snapshot = readCart();
const subscribers = new Set();

function readStorage(key) {
  try {
    return { ok: true, value: localStorage.getItem(key) };
  } catch (error) {
    return { ok: false, error };
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function quantity(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeItem(item) {
  if (!item || item.id === undefined || item.id === null) return null;
  const qty = quantity(item.qty);
  const price = Number(item.precio);
  if (!qty || !Number.isFinite(price) || price < 0) return null;
  return { ...item, qty, precio: price };
}

function normalizeCart(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeItem).filter(Boolean);
}

function decodeStored(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    // Accept the old array format and the versioned format going forward.
    return normalizeCart(Array.isArray(parsed) ? parsed : parsed?.items);
  } catch {
    return [];
  }
}

function readCart() {
  const result = readStorage(STORAGE_KEY);
  return result.ok ? decodeStored(result.value) : [];
}

function notify() {
  subscribers.forEach(listener => {
    try { listener([...snapshot]); } catch (error) { console.warn("[cart-store] subscriber", error); }
  });
}

export function getCartSnapshot() {
  return [...snapshot];
}

export function persistCart(nextCart) {
  const next = normalizeCart(nextCart);
  // Se conserva el formato de arreglo por compatibilidad con páginas antiguas
  // que leen ren_cart directamente.
  const result = writeStorage(STORAGE_KEY, JSON.stringify(next));
  if (!result.ok) return false;
  snapshot = next;
  notify();
  return true;
}

export function subscribeCart(listener) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function getCartStorageStatus() {
  const result = readStorage(STORAGE_KEY);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", event => {
    if (event.key !== STORAGE_KEY) return;
    snapshot = decodeStored(event.newValue);
    notify();
  });
}

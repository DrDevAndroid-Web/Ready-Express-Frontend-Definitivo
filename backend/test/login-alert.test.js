import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCIsImlzcyI6InN1cGFiYXNlIn0",
  "test-signature"
].join(".");
process.env.SUPABASE_ANON_KEY ||= "anon-key";

const { buildLoginAlertEmail, describeUserAgent, deviceHash, notifyNewDeviceLogin } = await import("../modules/auth/login-alert.service.js");

const USER = { id: "user-1", email: "ana@example.com" };
const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

// Repositorio en memoria y email capturado: sin Supabase ni Resend
function fakeDeps(initialHashes = []) {
  const state = { devices: initialHashes.map(device_hash => ({ device_hash })), emails: [], touched: 0 };
  return {
    state,
    deps: {
      async findDevices() { return state.devices.map(d => ({ ...d })); },
      async touchDevice() { state.touched++; },
      async insertDevice(_userId, hash) {
        if (state.devices.some(d => d.device_hash === hash)) return false;
        state.devices.push({ device_hash: hash });
        return true;
      },
      async sendEmail(message) { state.emails.push(message); }
    }
  };
}

describe("Aviso de inicio de sesión en dispositivo nuevo", () => {
  it("primer dispositivo de la cuenta: se registra sin email", async () => {
    const { state, deps } = fakeDeps();
    const result = await notifyNewDeviceLogin({ user: USER, deviceId: "dev-a", userAgent: CHROME_WIN, ip: "1.2.3.4" }, deps);
    assert.equal(result.reason, "FIRST_DEVICE");
    assert.equal(state.devices.length, 1);
    assert.equal(state.emails.length, 0);
  });

  it("dispositivo conocido: solo actualiza last_seen, sin email", async () => {
    const { state, deps } = fakeDeps([deviceHash(USER.id, "dev-a", CHROME_WIN)]);
    const result = await notifyNewDeviceLogin({ user: USER, deviceId: "dev-a", userAgent: CHROME_WIN }, deps);
    assert.equal(result.reason, "KNOWN_DEVICE");
    assert.equal(state.touched, 1);
    assert.equal(state.emails.length, 0);
  });

  it("dispositivo nuevo con otros ya conocidos: email al usuario con dispositivo, IP y user agent", async () => {
    const { state, deps } = fakeDeps([deviceHash(USER.id, "dev-a", CHROME_WIN)]);
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const result = await notifyNewDeviceLogin({ user: USER, deviceId: "dev-b", userAgent: iphone, ip: "5.6.7.8" }, deps);
    assert.equal(result.sent, true);
    assert.equal(state.emails.length, 1);
    const [email] = state.emails;
    assert.equal(email.to, USER.email);
    assert.match(email.text, /Safari en iPhone/);
    assert.match(email.text, /5\.6\.7\.8/);
    assert.match(email.html, /recuperar-password\.html/);
  });

  it("sin id de dispositivo usa el user agent (APK, dashboard)", () => {
    assert.equal(deviceHash(USER.id, "", "ua-1"), deviceHash(USER.id, undefined, "ua-1"));
    assert.notEqual(deviceHash(USER.id, "", "ua-1"), deviceHash(USER.id, "", "ua-2"));
    assert.notEqual(deviceHash("user-2", "", "ua-1"), deviceHash(USER.id, "", "ua-1"));
  });

  it("un fallo (p. ej. falta la tabla) no lanza: el login sigue", async () => {
    const { deps } = fakeDeps();
    deps.findDevices = async () => { throw Object.assign(new Error("relation does not exist"), { code: "42P01" }); };
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const result = await notifyNewDeviceLogin({ user: USER, deviceId: "dev-a", userAgent: CHROME_WIN }, deps);
      assert.equal(result.reason, "ERROR");
    } finally {
      console.warn = originalWarn;
    }
  });

  it("el user agent se escapa en el HTML", () => {
    const { html } = buildLoginAlertEmail({ device: "Chrome en Windows", ip: "1.1.1.1", userAgent: "<script>x</script>", when: new Date() });
    assert.doesNotMatch(html, /<script>x/);
  });

  it("describe navegadores y sistemas habituales", () => {
    assert.equal(describeUserAgent(CHROME_WIN), "Chrome en Windows");
    assert.equal(describeUserAgent("Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36"), "Samsung Internet en Android");
    assert.equal(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0"), "Microsoft Edge en macOS");
    assert.equal(describeUserAgent(""), "Dispositivo desconocido");
  });
});

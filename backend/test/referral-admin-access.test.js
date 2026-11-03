import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.test";
process.env.SUPABASE_ANON_KEY ||= "anon-key";

const { default: app } = await import("../app.js");

let server;
let baseUrl;

before(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const adminRoutes = [
  ["GET", "/api/admin/referrals/program"],
  ["PATCH", "/api/admin/referrals/program"],
  ["POST", "/api/admin/referrals/rules"],
  ["PATCH", "/api/admin/referrals/rules/00000000-0000-0000-0000-000000000000"],
  ["GET", "/api/admin/referrals"],
  ["GET", "/api/admin/referral-rewards"],
  ["POST", "/api/admin/referral-rewards/00000000-0000-0000-0000-000000000000/reverse"],
  ["GET", "/api/admin/referrals/stats"]
];

describe("referidos — acceso administrativo", () => {
  for (const [method, path] of adminRoutes) {
    it(`${method} ${path} rechaza una solicitud sin sesión`, async () => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "PATCH" || method === "POST" ? "{}" : undefined
      });
      assert.equal(response.status, 401);
    });
  }
});

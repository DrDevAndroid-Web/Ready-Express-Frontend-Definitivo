import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test("preferencias de pago — migración cerrada y sin datos de tarjeta", async () => {
  const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
  const sql = await readFile(`${migrationsDir}20261103_customer_payment_preferences.sql`, "utf8");
  assert.match(sql, /create table if not exists public\.customer_payment_preferences/);
  assert.match(sql, /preferred_methods jsonb/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.customer_payment_preferences from anon, authenticated/);
  assert.match(sql, /grant all on table public\.customer_payment_preferences to service_role/);
  assert.doesNotMatch(sql, /card_number|cvv|pan/i);
});

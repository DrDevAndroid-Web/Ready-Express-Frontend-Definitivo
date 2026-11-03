import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.join(here, "../migrations/20261103_referral_push_notifications.sql"), "utf8");

test("notificaciones push de referidos — migración cerrada y preferencias opt-in", () => {
  assert.match(migration, /customer_notification_preferences/i);
  assert.match(migration, /referral_purchase_push_enabled\s+boolean\s+not null default false/i);
  assert.match(migration, /customer_push_subscriptions/i);
  assert.match(migration, /endpoint\s+text\s+not null unique/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table/i);
  assert.match(migration, /grant all on table .*service_role/i);
});


import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

test("migración de referidos — contiene límites, RLS y grants cerrados", async () => {
  const sql = await readFile(`${migrationsDir}20261103_referrals_foundation.sql`, "utf8");
  for (const table of ["referral_programs", "referral_rules", "referral_codes", "referrals", "referral_rewards", "referral_wallet_entries", "order_adjustments"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`'${table}'`));
  }
  assert.match(sql, /alter table public\.%I enable row level security/);
  assert.match(sql, /revoke all on table public\.%I from anon, authenticated/);
  assert.match(sql, /create unique index if not exists referrals_one_attribution_per_customer/);
  assert.match(sql, /create unique index if not exists referral_rewards_one_type_per_referral/);
  assert.match(sql, /qualification_event = 'payment_successful'/);
});

test("migraciones de referidos — calificación y reversión son SECURITY DEFINER cerradas", async () => {
  const qualification = await readFile(`${migrationsDir}20261103_referrals_qualification_rpc.sql`, "utf8");
  const reversals = await readFile(`${migrationsDir}20261103_referrals_admin_reversals.sql`, "utf8");
  assert.match(qualification, /create or replace function public\.qualify_referral_order/);
  assert.match(qualification, /security definer/);
  assert.match(qualification, /revoke all on function public\.qualify_referral_order\(uuid\) from public, anon, authenticated/);
  assert.match(qualification, /from public\.referrals[\s\S]*for update/);
  assert.match(qualification, /pg_advisory_xact_lock/);
  assert.match(reversals, /create or replace function public\.reverse_referral_reward/);
  assert.match(reversals, /status = 'reversed'/);
  assert.match(reversals, /create table if not exists public\.referral_admin_actions/);
});

test("referidos — las rutas administrativas exigen rol admin explícito", async () => {
  const routes = await readFile(`${migrationsDir}../routes/index.js`, "utf8");
  const adminReferralRoutes = routes.split("\n").filter(line => line.includes("/admin/referral"));
  assert.equal(adminReferralRoutes.length, 8);
  for (const route of adminReferralRoutes) {
    assert.match(route, /requireSupabaseUser/);
    assert.match(route, /requireRoles\("admin"\)/);
  }
});

test("referidos — el snapshot de compra conserva reglas de ambos beneficiarios", async () => {
  const service = await readFile(`${migrationsDir}../modules/referrals/referral.service.js`, "utf8");
  assert.match(service, /ruleSnapshot:\s*\{\s*referred:/s);
  assert.match(service, /referrerRule/);
});

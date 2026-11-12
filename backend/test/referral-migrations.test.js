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

test("migración de referidos — permite consumir el saldo con bloqueo e idempotencia", async () => {
  const wallet = await readFile(`${migrationsDir}20261103_referral_wallet_redemption.sql`, "utf8");
  assert.match(wallet, /create unique index if not exists order_adjustments_one_referral_credit_per_order/);
  assert.match(wallet, /create or replace function public\.redeem_referral_wallet_credit/);
  assert.match(wallet, /pg_advisory_xact_lock/);
  assert.match(wallet, /on conflict \(idempotency_key\) do nothing/);
  assert.match(wallet, /revoke all on function public\.redeem_referral_wallet_credit/);
});

test("migración de referidos — devuelve el débito al cancelar sin restaurar crédito anulado", async () => {
  const sql = await readFile(`${migrationsDir}20261108_referral_wallet_refunds.sql`, "utf8");
  assert.match(sql, /entry_type = 'reversal' and metadata->>'source' = 'order_cancelled'/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /revoke all on function public\.redeem_referral_wallet_credit\(uuid, uuid, numeric, text\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.redeem_referral_wallet_credit\(uuid, uuid, numeric, text\) to service_role/);
});

test("migración de referidos — consume el descuento del referido una sola vez", async () => {
  const once = await readFile(`${migrationsDir}20261106_referral_discount_once.sql`, "utf8");
  assert.match(once, /alter table public\.referrals[\s\S]*add column if not exists discount_used_at timestamptz/);
  assert.match(once, /update public\.referrals[\s\S]*discount_used_at/);
  assert.match(once, /create or replace function public\.mark_referral_discount_used/);
  assert.match(once, /create trigger orders_mark_referral_discount_used/);
  assert.match(once, /new\.payment_status = 'successful'/);
});

test("referidos — las rutas administrativas exigen rol admin explícito", async () => {
  const routes = await readFile(`${migrationsDir}../routes/index.js`, "utf8");
  const adminReferralRoutes = routes.split("\n").filter(line => line.includes("/admin/referral"));
  assert.equal(adminReferralRoutes.length, 10);
  for (const route of adminReferralRoutes) {
    assert.match(route, /requireSupabaseUser/);
    assert.match(route, /requireRoles\("admin"\)/);
  }
});

test("referidos — registra riesgos sin exponer IP cruda y deja la administración cerrada", async () => {
  const migration = await readFile(`${migrationsDir}20261108_referral_fraud_controls.sql`, "utf8");
  const fraud = await readFile(`${migrationsDir}../modules/referrals/referral.fraud.service.js`, "utf8");
  const routes = await readFile(`${migrationsDir}../routes/index.js`, "utf8");
  assert.match(migration, /create table if not exists public\.referral_risk_events/);
  assert.match(migration, /ip_hash text/);
  assert.doesNotMatch(migration, /ip text[^_]/);
  assert.match(migration, /alter table public\.referral_risk_events enable row level security/);
  assert.match(migration, /revoke all on table public\.referral_risk_events from anon, authenticated/);
  assert.match(fraud, /REFERRAL_ANTIFRAUD_MODE/);
  assert.match(fraud, /self_referral/);
  assert.match(fraud, /shared_device_accounts/);
  assert.match(routes, /router\.get\("\/admin\/referral-fraud"/);
  assert.match(routes, /requireRoles\("admin"\)/);
});

test("referidos — el snapshot de compra conserva reglas de ambos beneficiarios", async () => {
  const service = await readFile(`${migrationsDir}../modules/referrals/referral.service.js`, "utf8");
  assert.match(service, /ruleSnapshot:\s*\{\s*referred:/s);
  assert.match(service, /referrerRule/);
});

test("referidos — bloquea clientes con compras confirmadas", async () => {
  const migration = await readFile(`${migrationsDir}20261108_referral_existing_customer_gate.sql`, "utf8");
  const service = await readFile(`${migrationsDir}../modules/referrals/referral.service.js`, "utf8");
  assert.match(migration, /create index if not exists orders_customer_successful_payment_idx/);
  assert.match(migration, /where payment_status = 'successful'/);
  assert.match(service, /hasSuccessfulCustomerOrder/);
  assert.match(service, /\.eq\("customer_id", authUserId\)/);
  assert.match(service, /eq\("payment_status", "successful"\)/);
  assert.match(service, /no puede recibir la promoción de nuevo referido/);
});

test("referidos — guarda el embudo de analíticas con RLS cerrado e idempotencia", async () => {
  const migration = await readFile(`${migrationsDir}20261108_referral_analytics.sql`, "utf8");
  const analytics = await readFile(`${migrationsDir}../modules/referrals/referral.analytics.service.js`, "utf8");
  const routes = await readFile(`${migrationsDir}../routes/index.js`, "utf8");
  assert.match(migration, /create table if not exists public\.referral_events/);
  assert.match(migration, /event_type text not null check/);
  assert.match(migration, /referral_events_idempotency_key_uidx/);
  assert.match(migration, /alter table public\.referral_events enable row level security/);
  assert.match(migration, /revoke all on table public\.referral_events from anon, authenticated/);
  assert.match(analytics, /cta_click/);
  assert.match(analytics, /first_purchase/);
  assert.match(analytics, /reward_issued/);
  assert.match(routes, /router\.post\("\/referrals\/events"/);
});

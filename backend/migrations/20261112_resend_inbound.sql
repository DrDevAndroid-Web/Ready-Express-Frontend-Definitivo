-- Resend inbound: una fila por correo para deduplicar el aviso SMS.
create table if not exists public.resend_inbound_emails (
  email_id uuid primary key,
  webhook_id text not null unique,
  sender text not null,
  subject text not null,
  received_at timestamptz not null,
  sms_status text not null default 'pending' check (sms_status in ('pending', 'processing', 'sent', 'skipped')),
  sms_claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists resend_inbound_received_idx on public.resend_inbound_emails(received_at desc);
create index if not exists resend_inbound_sms_pending_idx on public.resend_inbound_emails(sms_status, sms_claimed_at) where sms_status in ('pending', 'processing');

create table if not exists public.resend_inbound_sms_alerts (
  email_id uuid not null references public.resend_inbound_emails(email_id) on delete cascade,
  recipient text not null,
  sent_at timestamptz not null default now(),
  primary key (email_id, recipient)
);

create table if not exists public.resend_email_replies (
  id uuid primary key default gen_random_uuid(),
  inbound_email_id uuid not null,
  resend_email_id uuid not null unique,
  recipient text not null,
  cc text[] not null default '{}',
  bcc text[] not null default '{}',
  subject text not null,
  text text,
  html text,
  request_key text,
  sent_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz not null default now()
);

create index if not exists resend_email_replies_inbound_idx on public.resend_email_replies(inbound_email_id, sent_at);
create unique index if not exists resend_email_replies_request_key_uidx on public.resend_email_replies(inbound_email_id, request_key) where request_key is not null;

-- Cada webhook de correo saliente puede corresponder a un destinatario distinto.
-- La clave compuesta permite deduplicar reintentos de Svix sin perder el estado individual.
create table if not exists public.resend_email_events (
  webhook_id text not null,
  email_id uuid not null,
  recipient text not null default '',
  event_type text not null,
  occurred_at timestamptz not null,
  message_id text,
  reason text,
  created_at timestamptz not null default now(),
  primary key (webhook_id, recipient)
);

create index if not exists resend_email_events_email_recipient_time_idx
  on public.resend_email_events(email_id, recipient, occurred_at desc);
create index if not exists resend_email_events_email_status_time_idx
  on public.resend_email_events(email_id, event_type, occurred_at desc);

alter table public.resend_inbound_emails enable row level security;
alter table public.resend_inbound_sms_alerts enable row level security;
alter table public.resend_email_replies enable row level security;
alter table public.resend_email_events enable row level security;
revoke all on table public.resend_inbound_emails, public.resend_inbound_sms_alerts, public.resend_email_replies, public.resend_email_events from anon, authenticated;
grant all on table public.resend_inbound_emails, public.resend_inbound_sms_alerts, public.resend_email_replies, public.resend_email_events to service_role;

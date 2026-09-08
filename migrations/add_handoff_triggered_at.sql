-- Añade columna para registrar cuándo se activó el handoff
-- Necesaria para el job de timeout (handoff-timeout.job.js)
alter table chat_sessions
  add column if not exists handoff_triggered_at timestamptz;

-- Índice para que la query del job sea eficiente
create index if not exists chat_sessions_handoff_timeout_idx
  on chat_sessions(status, handoff_triggered_at)
  where status = 'handoff';

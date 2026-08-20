export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Append-only record of the failure that opened a case.
CREATE TABLE IF NOT EXISTS payment_event (
  event_id            TEXT PRIMARY KEY,
  case_id             TEXT NOT NULL,
  entity              TEXT NOT NULL,
  amount_paise        INTEGER NOT NULL,
  error_code          TEXT,
  error_reason        TEXT,
  error_description   TEXT NOT NULL,
  error_source        TEXT,
  error_step          TEXT,
  received_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnosis (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id        TEXT NOT NULL,
  event_id       TEXT NOT NULL REFERENCES payment_event(event_id),
  failure_class  TEXT NOT NULL,
  confidence     REAL NOT NULL,
  source         TEXT NOT NULL,
  rationale      TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

-- Why the guard allowed, deferred, or stopped an action. Never overwritten.
CREATE TABLE IF NOT EXISTS gate_decision (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id      TEXT NOT NULL,
  action_key   TEXT,
  decision     TEXT NOT NULL,
  rules_json   TEXT NOT NULL,
  expected_value_paise INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  action_key   TEXT NOT NULL REFERENCES action(action_key),
  decision     TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  approver     TEXT NOT NULL,
  note         TEXT,
  created_at   TEXT NOT NULL
);

-- One row per intended external effect. action_key is the durable identity.
CREATE TABLE IF NOT EXISTS action (
  action_key        TEXT PRIMARY KEY,
  case_id           TEXT NOT NULL,
  policy_version    TEXT NOT NULL,
  action_kind       TEXT NOT NULL,
  channel           TEXT NOT NULL,
  scheduled_at      TEXT NOT NULL,
  attempt_number    INTEGER NOT NULL,
  reference_id      TEXT NOT NULL UNIQUE,
  state             TEXT NOT NULL,
  provider_id       TEXT,
  claimed_at        TEXT,
  lease_expires_at  TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (case_id, policy_version, action_kind, scheduled_at, attempt_number)
);

CREATE INDEX IF NOT EXISTS action_state_idx ON action(state);
CREATE INDEX IF NOT EXISTS action_case_idx ON action(case_id);

-- Append-only state history. Earlier decisions are superseded, never edited.
CREATE TABLE IF NOT EXISTS action_transition (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action_key  TEXT NOT NULL REFERENCES action(action_key),
  from_state  TEXT NOT NULL,
  to_state    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- One row per attempt to contact the provider, inserted before the call.
CREATE TABLE IF NOT EXISTS execution_attempt (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  action_key    TEXT NOT NULL REFERENCES action(action_key),
  attempt_index INTEGER NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  result        TEXT,
  detail        TEXT,
  UNIQUE (action_key, attempt_index)
);

CREATE TABLE IF NOT EXISTS provider_reconciliation (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  action_key    TEXT NOT NULL REFERENCES action(action_key),
  result        TEXT NOT NULL,
  provider_id   TEXT,
  provider_status TEXT,
  detail        TEXT,
  created_at    TEXT NOT NULL
);

-- A delivery is processed at most once, whatever the provider retries.
CREATE TABLE IF NOT EXISTS webhook_receipt (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider     TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  body_hash    TEXT NOT NULL,
  received_at  TEXT NOT NULL,
  UNIQUE (provider, event_id)
);

CREATE TABLE IF NOT EXISTS outcome (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id             TEXT NOT NULL,
  action_key          TEXT REFERENCES action(action_key),
  kind                TEXT NOT NULL,
  amount_paise        INTEGER NOT NULL,
  attributed          INTEGER NOT NULL,
  occurred_at         TEXT NOT NULL,
  webhook_receipt_id  INTEGER REFERENCES webhook_receipt(id),
  UNIQUE (case_id, action_key, kind, occurred_at)
);

CREATE TABLE IF NOT EXISTS exception (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action_key  TEXT REFERENCES action(action_key),
  case_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  detail      TEXT NOT NULL,
  resolved    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
`;

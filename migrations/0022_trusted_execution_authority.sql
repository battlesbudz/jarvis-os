CREATE TABLE IF NOT EXISTS trusted_execution_global_controls (
  id VARCHAR PRIMARY KEY DEFAULT 'global',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  kill_switch_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  execution_epoch INTEGER NOT NULL DEFAULT 0 CHECK (execution_epoch >= 0),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO trusted_execution_global_controls (id)
VALUES ('global')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS trusted_execution_user_controls (
  user_id VARCHAR PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  execution_epoch INTEGER NOT NULL DEFAULT 0 CHECK (execution_epoch >= 0),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS standing_execution_grant_heads (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked', 'expired', 'replaced')),
  category VARCHAR NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version > 0),
  state_revision INTEGER NOT NULL DEFAULT 1 CHECK (state_revision > 0),
  trigger_lineage_id VARCHAR NOT NULL,
  allowed_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_targets JSONB NOT NULL DEFAULT '[]'::jsonb,
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMP NOT NULL,
  paused_at TIMESTAMP,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (id, trigger_lineage_id)
);

CREATE INDEX IF NOT EXISTS standing_execution_grant_user_status_idx
  ON standing_execution_grant_heads (user_id, status, updated_at);

CREATE TABLE IF NOT EXISTS standing_execution_grant_versions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id VARCHAR NOT NULL REFERENCES standing_execution_grant_heads(id) ON DELETE CASCADE,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  actor_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_source_turn_id VARCHAR NOT NULL,
  source_action_kind VARCHAR NOT NULL,
  source_action_key VARCHAR NOT NULL,
  category VARCHAR NOT NULL,
  trigger_lineage_id VARCHAR NOT NULL,
  allowed_actions JSONB NOT NULL,
  allowed_targets JSONB NOT NULL,
  limits JSONB NOT NULL,
  effective_from TIMESTAMP NOT NULL,
  effective_through TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (grant_id, version),
  UNIQUE (user_id, source_action_kind, source_action_key)
);

CREATE TABLE IF NOT EXISTS execution_authorities (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type VARCHAR NOT NULL CHECK (source_type IN ('direct_command', 'standing_grant')),
  source_turn_id VARCHAR,
  source_action_kind VARCHAR,
  source_action_key VARCHAR,
  standing_grant_id VARCHAR REFERENCES standing_execution_grant_heads(id) ON DELETE SET NULL,
  standing_grant_version INTEGER,
  standing_grant_state_revision INTEGER,
  standing_grant_category VARCHAR,
  standing_grant_limit_snapshot JSONB,
  standing_grant_consent_source_turn_id VARCHAR,
  standing_grant_trigger_lineage_id VARCHAR,
  trigger_occurrence_key VARCHAR,
  standing_grant_usage_snapshot JSONB,
  global_execution_epoch INTEGER NOT NULL CHECK (global_execution_epoch >= 0),
  user_execution_epoch INTEGER NOT NULL CHECK (user_execution_epoch >= 0),
  origin_channel VARCHAR NOT NULL,
  task_id VARCHAR NOT NULL,
  intent TEXT NOT NULL,
  allowed_actions JSONB NOT NULL,
  allowed_targets JSONB NOT NULL,
  risk_tier VARCHAR NOT NULL CHECK (risk_tier IN ('low', 'medium', 'high')),
  max_attempts_per_step INTEGER NOT NULL CHECK (max_attempts_per_step > 0),
  idempotency_lineage_id VARCHAR NOT NULL,
  workflow_plan_revision INTEGER NOT NULL DEFAULT 1 CHECK (workflow_plan_revision > 0),
  workflow_plan_status VARCHAR NOT NULL DEFAULT 'planning' CHECK (workflow_plan_status IN ('planning', 'closed')),
  required_step_manifest_hash VARCHAR,
  issued_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  compensation_expires_at TIMESTAMP NOT NULL,
  forward_admission_status VARCHAR NOT NULL DEFAULT 'open' CHECK (forward_admission_status IN ('open', 'closed')),
  forward_admission_closed_at TIMESTAMP,
  compensation_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'compensating', 'completed', 'failed', 'cancelled', 'expired')),
  reconciliation_status VARCHAR NOT NULL DEFAULT 'none' CHECK (reconciliation_status IN ('none', 'required', 'resolved')),
  terminal_reason_ref VARCHAR,
  audit_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  failed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (
    (source_type = 'direct_command' AND source_turn_id IS NOT NULL AND source_action_kind IS NOT NULL AND source_action_key IS NOT NULL AND standing_grant_id IS NULL)
    OR
    (source_type = 'standing_grant' AND source_turn_id IS NULL AND source_action_key IS NULL AND standing_grant_id IS NOT NULL AND standing_grant_version IS NOT NULL AND standing_grant_state_revision IS NOT NULL AND standing_grant_trigger_lineage_id IS NOT NULL AND trigger_occurrence_key IS NOT NULL)
  ),
  CHECK (compensation_expires_at >= expires_at),
  CHECK ((workflow_plan_status = 'planning' AND required_step_manifest_hash IS NULL) OR (workflow_plan_status = 'closed' AND required_step_manifest_hash IS NOT NULL)),
  UNIQUE (user_id, source_action_kind, source_action_key),
  UNIQUE (user_id, idempotency_lineage_id)
);

CREATE INDEX IF NOT EXISTS execution_authority_user_status_idx
  ON execution_authorities (user_id, status, updated_at);

CREATE TABLE IF NOT EXISTS authority_execution_steps (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id VARCHAR NOT NULL REFERENCES execution_authorities(id) ON DELETE CASCADE,
  step_key VARCHAR NOT NULL,
  action VARCHAR NOT NULL,
  target_fingerprint VARCHAR NOT NULL,
  idempotency_key VARCHAR NOT NULL,
  role VARCHAR NOT NULL CHECK (role IN ('forward', 'compensation')),
  depends_on_step_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  compensates_step_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  compensation_triggers JSONB NOT NULL DEFAULT '[]'::jsonb,
  compensation_eligibility VARCHAR NOT NULL DEFAULT 'inactive' CHECK (compensation_eligibility IN ('inactive', 'executable', 'awaiting_trigger', 'awaiting_effect_reconciliation', 'inapplicable')),
  max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  current_attempt_id VARCHAR,
  status VARCHAR NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'consuming', 'consumed', 'retryable_failed', 'failed', 'cancelled', 'skipped', 'reconciliation_required')),
  result_ref VARCHAR,
  recovery_ref VARCHAR,
  started_at TIMESTAMP,
  consumed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (
    (role = 'forward' AND jsonb_array_length(compensates_step_keys) = 0 AND jsonb_array_length(compensation_triggers) = 0)
    OR
    (role = 'compensation' AND jsonb_array_length(compensates_step_keys) > 0 AND jsonb_array_length(compensation_triggers) > 0)
  ),
  UNIQUE (authority_id, step_key),
  UNIQUE (authority_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS authority_execution_step_status_idx
  ON authority_execution_steps (authority_id, status);

CREATE TABLE IF NOT EXISTS authority_execution_attempts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_execution_step_id VARCHAR NOT NULL REFERENCES authority_execution_steps(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  lease_owner_id VARCHAR NOT NULL,
  lease_generation INTEGER NOT NULL CHECK (lease_generation > 0),
  lease_expires_at TIMESTAMP NOT NULL,
  boundary_state VARCHAR NOT NULL DEFAULT 'not_started' CHECK (boundary_state IN ('not_started', 'started', 'confirmed_no_effect', 'confirmed_effect', 'uncertain')),
  status VARCHAR NOT NULL DEFAULT 'leased' CHECK (status IN ('leased', 'completed', 'abandoned', 'reconciliation_required')),
  boundary_started_at TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (authority_execution_step_id, attempt_number),
  UNIQUE (authority_execution_step_id, lease_generation)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'authority_execution_steps_current_attempt_fk'
  ) THEN
    ALTER TABLE authority_execution_steps
      ADD CONSTRAINT authority_execution_steps_current_attempt_fk
      FOREIGN KEY (current_attempt_id) REFERENCES authority_execution_attempts(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS authority_execution_attempt_lease_idx
  ON authority_execution_attempts (status, lease_expires_at);

CREATE TABLE IF NOT EXISTS standing_execution_occurrences (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id VARCHAR NOT NULL REFERENCES standing_execution_grant_heads(id) ON DELETE CASCADE,
  trigger_lineage_id VARCHAR NOT NULL,
  trigger_occurrence_key VARCHAR NOT NULL,
  authority_id VARCHAR NOT NULL UNIQUE REFERENCES execution_authorities(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (grant_id, trigger_lineage_id, trigger_occurrence_key)
);

CREATE TABLE IF NOT EXISTS standing_execution_usage_allocations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id VARCHAR NOT NULL REFERENCES standing_execution_grant_heads(id) ON DELETE CASCADE,
  authority_id VARCHAR NOT NULL REFERENCES execution_authorities(id) ON DELETE CASCADE,
  authority_execution_step_id VARCHAR REFERENCES authority_execution_steps(id) ON DELETE SET NULL,
  limit_key VARCHAR NOT NULL,
  window_start TIMESTAMP NOT NULL,
  window_end TIMESTAMP NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status VARCHAR NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'committed', 'released', 'reconciliation_required')),
  reconciliation_owner VARCHAR,
  reconciliation_deadline TIMESTAMP,
  recovery_ref VARCHAR,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (authority_id, limit_key, window_start, window_end)
);

CREATE INDEX IF NOT EXISTS standing_execution_usage_counter_idx
  ON standing_execution_usage_allocations (grant_id, limit_key, window_start, window_end, status);

CREATE TABLE IF NOT EXISTS trusted_execution_audit_events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  authority_id VARCHAR REFERENCES execution_authorities(id) ON DELETE SET NULL,
  step_id VARCHAR REFERENCES authority_execution_steps(id) ON DELETE SET NULL,
  event_type VARCHAR NOT NULL,
  target_fingerprint VARCHAR,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS trusted_execution_audit_user_created_idx
  ON trusted_execution_audit_events (user_id, created_at);
CREATE INDEX IF NOT EXISTS trusted_execution_audit_authority_idx
  ON trusted_execution_audit_events (authority_id, created_at);

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS commitment_kind VARCHAR NOT NULL DEFAULT 'user_commitment';

ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS signal_level VARCHAR NOT NULL DEFAULT 'normal';

ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR;

ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS source_type VARCHAR NOT NULL DEFAULT 'legacy';

ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

UPDATE commitments
SET updated_at = COALESCE(extracted_at, NOW())
WHERE updated_at IS NULL;

ALTER TABLE commitments ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE commitments ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE commitments
SET
  history = CASE
    WHEN source_message ~* '^Added via (heartbeat|crew|monitoring)(/|$)'
      OR source_message ~* '^Added via .*(notification|inbox)'
      THEN COALESCE(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'content', content,
        'dueDate', due_date,
        'status', status,
        'commitmentKind', commitment_kind,
        'signalLevel', signal_level,
        'dedupeKey', dedupe_key,
        'sourceType', source_type,
        'sourceMessage', source_message,
        'recordedAt', COALESCE(updated_at, extracted_at, NOW()),
        'reason', 'legacy_source_inference'
      ))
    ELSE history
  END,
  commitment_kind = CASE
    WHEN source_message ~* '^Added via .*(notification|inbox)'
      OR (source_message ~* '^Added via (heartbeat|crew|monitoring)(/|$)' AND content ~* '^[[:space:]]*(acknowledge|dismiss|archive)')
      THEN 'notification'
    WHEN source_message ~* '^Added via (heartbeat|crew|monitoring)(/|$)'
      THEN 'operational_incident'
    ELSE commitment_kind
  END,
  signal_level = CASE
    WHEN source_message ~* '^Added via .*(notification|inbox)'
      OR (source_message ~* '^Added via (heartbeat|crew|monitoring)(/|$)' AND content ~* '^[[:space:]]*(acknowledge|dismiss|archive)')
      THEN 'low'
    ELSE signal_level
  END,
  source_type = CASE
    WHEN source_message ~* '^Added via '
      THEN trim(BOTH '_' FROM regexp_replace(lower(substring(source_message FROM 11)), '[^a-z0-9]+', '_', 'g'))
    ELSE 'legacy'
  END
WHERE source_type = 'legacy';

UPDATE commitments
SET
  history = jsonb_build_array(jsonb_build_object(
    'content', content,
    'dueDate', due_date,
    'status', status,
    'commitmentKind', 'user_commitment',
    'signalLevel', 'normal',
    'dedupeKey', dedupe_key,
    'sourceType', 'legacy',
    'sourceMessage', source_message,
    'recordedAt', COALESCE(updated_at, extracted_at, NOW()),
    'reason', 'legacy_source_inference_reconstructed'
  )),
  commitment_kind = CASE
    WHEN commitment_kind = 'notification' OR source_type ~* '(notification|inbox)' THEN 'notification'
    WHEN source_type ~* '^(heartbeat|crew|monitoring)(_|$)' THEN 'operational_incident'
    ELSE commitment_kind
  END,
  signal_level = CASE
    WHEN source_type ~* '(notification|inbox)' THEN 'low'
    ELSE signal_level
  END
WHERE history = '[]'::jsonb
  AND dedupe_key IS NOT NULL
  AND dedupe_key NOT LIKE 'kind:%'
  AND source_type ~* '(notification|inbox)|^(heartbeat|crew|monitoring)(_|$)';

UPDATE commitments AS commitment
SET history = (
  SELECT COALESCE(jsonb_agg(entry.value ORDER BY entry.ordinality), '[]'::jsonb)
  FROM jsonb_array_elements(commitment.history) WITH ORDINALITY AS entry(value, ordinality)
  WHERE entry.ordinality > jsonb_array_length(commitment.history) - 20
)
WHERE jsonb_array_length(commitment.history) > 20;

UPDATE commitments
SET dedupe_key = CASE
  WHEN dedupe_key ~ '^kind:[^:]+:topic:content_[0-9a-f]{64}$'
    THEN regexp_replace(dedupe_key, ':topic:content_', ':content:')
  WHEN dedupe_key ~ '^kind:[^:]+:topic:topic_.+'
    THEN regexp_replace(dedupe_key, ':topic:topic_', ':topic:')
  WHEN dedupe_key ~ '^topic:content_[0-9a-f]{64}$'
    THEN 'content:' || substring(dedupe_key FROM 15)
  WHEN dedupe_key ~ '^topic:topic_.+'
    THEN 'topic:' || substring(dedupe_key FROM 13)
  ELSE dedupe_key
END
WHERE dedupe_key ~ '^kind:[^:]+:topic:(content_[0-9a-f]{64}|topic_.+)$'
  OR dedupe_key ~ '^topic:(content_[0-9a-f]{64}|topic_.+)$';

UPDATE commitments
SET dedupe_key = 'kind:' || commitment_kind || ':' || COALESCE(
  dedupe_key,
  'content:' || encode(
    digest(lower(regexp_replace(trim(content), '[[:space:]]+', ' ', 'g')), 'sha256'),
    'hex'
  )
)
WHERE dedupe_key IS NULL OR dedupe_key NOT LIKE 'kind:%';

CREATE INDEX IF NOT EXISTS commitments_pending_personal_updated_idx
  ON commitments(user_id, status, commitment_kind, signal_level, updated_at DESC);

CREATE INDEX IF NOT EXISTS commitments_pending_dedupe_idx
  ON commitments(user_id, status, dedupe_key);

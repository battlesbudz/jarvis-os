CREATE TABLE IF NOT EXISTS composio_connected_accounts (
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  toolkit VARCHAR NOT NULL,
  auth_config_id VARCHAR NOT NULL,
  connected_account_id VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'ACTIVE',
  account_email TEXT,
  account_name TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, connected_account_id)
);

CREATE INDEX IF NOT EXISTS composio_connected_accounts_user_toolkit_idx
  ON composio_connected_accounts(user_id, toolkit);

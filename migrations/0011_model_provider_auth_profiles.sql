CREATE TABLE IF NOT EXISTS model_provider_auth_profiles (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR NOT NULL,
  auth_type VARCHAR NOT NULL,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  api_key_encrypted TEXT,
  expires_at TIMESTAMP,
  account_id TEXT,
  email TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS model_provider_auth_profiles_user_provider_auth_type_idx
  ON model_provider_auth_profiles(user_id, provider, auth_type);

CREATE INDEX IF NOT EXISTS model_provider_auth_profiles_user_provider_idx
  ON model_provider_auth_profiles(user_id, provider);

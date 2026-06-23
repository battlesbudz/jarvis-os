import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MODEL_PROVIDER_CATALOG, isSupportedModelProvider, type ModelProviderId } from "@shared/modelProviderCatalog";
import {
  DEFAULT_CHATGPT_CODEX_OAUTH_CLIENT_ID,
  DEFAULT_CHATGPT_CODEX_OAUTH_TOKEN_URL,
} from "./openaiOAuthDefaults";

export type ProviderAuthType = "api_key" | "oauth";
export type ModelProviderName = "openai" | string;

export interface ModelProviderAuthProfileRecord {
  id: string;
  userId: string;
  provider: string;
  authType: ProviderAuthType;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  apiKeyEncrypted: string | null;
  expiresAt: Date | null;
  accountId: string | null;
  email: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertModelProviderAuthProfileInput {
  userId: string;
  provider: string;
  authType: ProviderAuthType;
  accessTokenEncrypted?: string | null;
  refreshTokenEncrypted?: string | null;
  apiKeyEncrypted?: string | null;
  expiresAt?: Date | null;
  accountId?: string | null;
  email?: string | null;
  isDefault?: boolean;
}

export interface ModelProviderAuthProfileRepository {
  listProfiles(userId: string, provider?: string): Promise<ModelProviderAuthProfileRecord[]>;
  upsertProfile(input: UpsertModelProviderAuthProfileInput): Promise<ModelProviderAuthProfileRecord>;
  updateOAuthTokens(input: {
    id: string;
    accessTokenEncrypted: string;
    refreshTokenEncrypted?: string | null;
    expiresAt?: Date | null;
    accountId?: string | null;
    email?: string | null;
  }): Promise<ModelProviderAuthProfileRecord | null>;
  deleteProvider(userId: string, provider: string): Promise<number>;
}

export class InMemoryModelProviderAuthProfileRepository implements ModelProviderAuthProfileRepository {
  private profiles = new Map<string, ModelProviderAuthProfileRecord>();

  async listProfiles(userId: string, provider?: string): Promise<ModelProviderAuthProfileRecord[]> {
    return Array.from(this.profiles.values())
      .filter((profile) => profile.userId === userId && (!provider || profile.provider === provider))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((profile) => ({ ...profile }));
  }

  async upsertProfile(input: UpsertModelProviderAuthProfileInput): Promise<ModelProviderAuthProfileRecord> {
    const now = new Date();
    const existing = Array.from(this.profiles.values()).find((profile) =>
      profile.userId === input.userId &&
      profile.provider === input.provider &&
      profile.authType === input.authType
    );

    const isDefault = input.isDefault ?? true;
    if (isDefault) {
      for (const profile of this.profiles.values()) {
        if (profile.userId === input.userId && profile.provider === input.provider) {
          profile.isDefault = false;
          profile.updatedAt = now;
        }
      }
    }

    const next: ModelProviderAuthProfileRecord = {
      id: existing?.id ?? randomUUID(),
      userId: input.userId,
      provider: input.provider,
      authType: input.authType,
      accessTokenEncrypted: input.accessTokenEncrypted ?? null,
      refreshTokenEncrypted: input.refreshTokenEncrypted === undefined
        ? existing?.refreshTokenEncrypted ?? null
        : input.refreshTokenEncrypted,
      apiKeyEncrypted: input.apiKeyEncrypted ?? null,
      expiresAt: input.expiresAt ?? null,
      accountId: input.accountId ?? null,
      email: input.email ?? null,
      isDefault,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.profiles.set(next.id, next);
    return { ...next };
  }

  async updateOAuthTokens(input: {
    id: string;
    accessTokenEncrypted: string;
    refreshTokenEncrypted?: string | null;
    expiresAt?: Date | null;
    accountId?: string | null;
    email?: string | null;
  }): Promise<ModelProviderAuthProfileRecord | null> {
    const existing = this.profiles.get(input.id);
    if (!existing) return null;
    const next: ModelProviderAuthProfileRecord = {
      ...existing,
      accessTokenEncrypted: input.accessTokenEncrypted,
      refreshTokenEncrypted: input.refreshTokenEncrypted === undefined
        ? existing.refreshTokenEncrypted
        : input.refreshTokenEncrypted,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      accountId: input.accountId === undefined ? existing.accountId : input.accountId,
      email: input.email === undefined ? existing.email : input.email,
      updatedAt: new Date(),
    };
    this.profiles.set(next.id, next);
    return { ...next };
  }

  async deleteProvider(userId: string, provider: string): Promise<number> {
    let deleted = 0;
    for (const profile of Array.from(this.profiles.values())) {
      if (profile.userId === userId && profile.provider === provider) {
        this.profiles.delete(profile.id);
        deleted += 1;
      }
    }
    return deleted;
  }
}

function rowToProfile(row: any): ModelProviderAuthProfileRecord {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    authType: row.auth_type,
    accessTokenEncrypted: row.access_token_encrypted ?? null,
    refreshTokenEncrypted: row.refresh_token_encrypted ?? null,
    apiKeyEncrypted: row.api_key_encrypted ?? null,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    accountId: row.account_id ?? null,
    email: row.email ?? null,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
    updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
  };
}

function resultRows(result: unknown): any[] {
  return (result as any)?.rows ?? (Array.isArray(result) ? result : []);
}

export class DatabaseModelProviderAuthProfileRepository implements ModelProviderAuthProfileRepository {
  async listProfiles(userId: string, provider?: string): Promise<ModelProviderAuthProfileRecord[]> {
    const { db } = await import("../../db");
    const result = provider
      ? await db.execute(sql`
          SELECT * FROM model_provider_auth_profiles
          WHERE user_id = ${userId} AND provider = ${provider}
          ORDER BY is_default DESC, updated_at DESC
        `)
      : await db.execute(sql`
          SELECT * FROM model_provider_auth_profiles
          WHERE user_id = ${userId}
          ORDER BY provider ASC, is_default DESC, updated_at DESC
        `);
    return resultRows(result).map(rowToProfile);
  }

  async upsertProfile(input: UpsertModelProviderAuthProfileInput): Promise<ModelProviderAuthProfileRecord> {
    const { db } = await import("../../db");
    const isDefault = input.isDefault ?? true;
    if (isDefault) {
      await db.execute(sql`
        UPDATE model_provider_auth_profiles
        SET is_default = FALSE, updated_at = NOW()
        WHERE user_id = ${input.userId} AND provider = ${input.provider}
      `);
    }

    const result = await db.execute(sql`
      INSERT INTO model_provider_auth_profiles (
        user_id,
        provider,
        auth_type,
        access_token_encrypted,
        refresh_token_encrypted,
        api_key_encrypted,
        expires_at,
        account_id,
        email,
        is_default,
        created_at,
        updated_at
      )
      VALUES (
        ${input.userId},
        ${input.provider},
        ${input.authType},
        ${input.accessTokenEncrypted ?? null},
        ${input.refreshTokenEncrypted ?? null},
        ${input.apiKeyEncrypted ?? null},
        ${input.expiresAt ?? null},
        ${input.accountId ?? null},
        ${input.email ?? null},
        ${isDefault},
        NOW(),
        NOW()
      )
      ON CONFLICT (user_id, provider, auth_type) DO UPDATE SET
        access_token_encrypted = EXCLUDED.access_token_encrypted,
        refresh_token_encrypted = COALESCE(
          EXCLUDED.refresh_token_encrypted,
          model_provider_auth_profiles.refresh_token_encrypted
        ),
        api_key_encrypted = EXCLUDED.api_key_encrypted,
        expires_at = EXCLUDED.expires_at,
        account_id = EXCLUDED.account_id,
        email = EXCLUDED.email,
        is_default = EXCLUDED.is_default,
        updated_at = NOW()
      RETURNING *
    `);
    const row = resultRows(result)[0];
    if (!row) throw new Error("Failed to save model provider auth profile");
    return rowToProfile(row);
  }

  async updateOAuthTokens(input: {
    id: string;
    accessTokenEncrypted: string;
    refreshTokenEncrypted?: string | null;
    expiresAt?: Date | null;
    accountId?: string | null;
    email?: string | null;
  }): Promise<ModelProviderAuthProfileRecord | null> {
    const { db } = await import("../../db");
    const result = await db.execute(sql`
      UPDATE model_provider_auth_profiles
      SET
        access_token_encrypted = ${input.accessTokenEncrypted},
        refresh_token_encrypted = COALESCE(${input.refreshTokenEncrypted ?? null}, refresh_token_encrypted),
        expires_at = ${input.expiresAt ?? null},
        account_id = COALESCE(${input.accountId ?? null}, account_id),
        email = COALESCE(${input.email ?? null}, email),
        updated_at = NOW()
      WHERE id = ${input.id}
      RETURNING *
    `);
    const row = resultRows(result)[0];
    return row ? rowToProfile(row) : null;
  }

  async deleteProvider(userId: string, provider: string): Promise<number> {
    const { db } = await import("../../db");
    const result = await db.execute(sql`
      DELETE FROM model_provider_auth_profiles
      WHERE user_id = ${userId} AND provider = ${provider}
    `);
    return Number((result as any)?.rowCount ?? 0);
  }
}

const databaseRepo = new DatabaseModelProviderAuthProfileRepository();

function encryptionSecret(): string {
  const value =
    process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY ||
    process.env.MODEL_PROVIDER_AUTH_ENCRYPTION_KEY;
  if (!value || value.trim().length < 12) {
    throw new Error("JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY is required to store provider credentials");
  }
  return value;
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(encryptionSecret()).digest();
}

export function encryptProviderSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Cannot encrypt an empty provider credential");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptProviderSecret(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  const [version, ivRaw, tagRaw, payloadRaw] = encrypted.split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !payloadRaw) {
    throw new Error("Unsupported provider credential encryption format");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(payloadRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export interface SaveOpenAIApiKeyProfileInput {
  repo?: ModelProviderAuthProfileRepository;
  userId: string;
  apiKey: string;
  isDefault?: boolean;
}

export async function saveOpenAIApiKeyProfile(
  input: SaveOpenAIApiKeyProfileInput,
): Promise<ModelProviderAuthProfileRecord> {
  return saveProviderApiKeyProfile({ ...input, provider: "openai" });
}

export interface SaveProviderApiKeyProfileInput {
  repo?: ModelProviderAuthProfileRepository;
  userId: string;
  provider: ModelProviderId;
  apiKey: string;
  isDefault?: boolean;
}

export async function saveProviderApiKeyProfile(
  input: SaveProviderApiKeyProfileInput,
): Promise<ModelProviderAuthProfileRecord> {
  if (!isSupportedModelProvider(input.provider)) throw new Error("Unsupported model provider");
  const providerConfig = MODEL_PROVIDER_CATALOG.find((provider) => provider.id === input.provider);
  if (!providerConfig?.credentialKinds.includes("api_key")) {
    throw new Error(`${providerConfig?.label ?? input.provider} does not support API-key setup`);
  }
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error(`${providerConfig.label} API key is required`);
  return (input.repo ?? databaseRepo).upsertProfile({
    userId: input.userId,
    provider: input.provider,
    authType: "api_key",
    apiKeyEncrypted: encryptProviderSecret(apiKey),
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    expiresAt: null,
    accountId: null,
    email: null,
    isDefault: input.isDefault ?? true,
  });
}

export interface SaveOpenAIOAuthProfileInput {
  repo?: ModelProviderAuthProfileRepository;
  userId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  accountId?: string | null;
  email?: string | null;
  isDefault?: boolean;
}

export async function saveOpenAIOAuthProfile(
  input: SaveOpenAIOAuthProfileInput,
): Promise<ModelProviderAuthProfileRecord> {
  const accessToken = input.accessToken.trim();
  if (!accessToken) throw new Error("OpenAI OAuth access token is required");
  return (input.repo ?? databaseRepo).upsertProfile({
    userId: input.userId,
    provider: "openai",
    authType: "oauth",
    accessTokenEncrypted: encryptProviderSecret(accessToken),
    refreshTokenEncrypted: input.refreshToken?.trim() ? encryptProviderSecret(input.refreshToken) : undefined,
    apiKeyEncrypted: null,
    expiresAt: input.expiresAt ?? null,
    accountId: input.accountId ?? null,
    email: input.email ?? null,
    isDefault: input.isDefault ?? true,
  });
}

export interface ProviderCredential {
  provider: string;
  authType: ProviderAuthType;
  credential: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  accountId: string | null;
  email: string | null;
}

export interface RefreshOAuthTokenResult {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  accountId?: string | null;
  email?: string | null;
}

export type RefreshOAuthTokenFn = (
  profile: ProviderCredential,
) => Promise<RefreshOAuthTokenResult | null>;

function isExpired(expiresAt: Date | null, now: Date): boolean {
  return !!expiresAt && expiresAt.getTime() <= now.getTime() + 60_000;
}

export function isOpenAIAuthTypeFallbackEnabled(): boolean {
  const value = (process.env.JARVIS_OPENAI_AUTH_FALLBACK_ENABLED || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function selectProfile(
  profiles: ModelProviderAuthProfileRecord[],
  preferredAuthType?: ProviderAuthType,
  allowFallback = false,
): ModelProviderAuthProfileRecord | null {
  if (preferredAuthType) {
    const preferred = profiles.find((profile) => profile.authType === preferredAuthType && profile.isDefault) ??
      profiles.find((profile) => profile.authType === preferredAuthType);
    if (preferred) return preferred;
    if (!allowFallback) return null;
  }
  return profiles.find((profile) => profile.isDefault) ?? profiles[0] ?? null;
}

async function refreshOpenAIOAuthToken(profile: ProviderCredential): Promise<RefreshOAuthTokenResult | null> {
  const tokenUrl = process.env.JARVIS_OPENAI_OAUTH_TOKEN_URL || process.env.OPENAI_OAUTH_TOKEN_URL || DEFAULT_CHATGPT_CODEX_OAUTH_TOKEN_URL;
  const clientId = process.env.JARVIS_OPENAI_OAUTH_CLIENT_ID || process.env.OPENAI_OAUTH_CLIENT_ID || DEFAULT_CHATGPT_CODEX_OAUTH_CLIENT_ID;
  const clientSecret = process.env.JARVIS_OPENAI_OAUTH_CLIENT_SECRET || process.env.OPENAI_OAUTH_CLIENT_SECRET;
  if (!tokenUrl || !clientId || !profile.refreshToken) return null;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: profile.refreshToken,
    client_id: clientId,
  });
  if (clientSecret) body.set("client_secret", clientSecret);

  try {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await response.json() as any;
    if (!response.ok || !data.access_token) return null;
    return {
      accessToken: String(data.access_token),
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : profile.refreshToken,
      expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000) : null,
      accountId: typeof data.account_id === "string" ? data.account_id : profile.accountId,
      email: typeof data.email === "string" ? data.email : profile.email,
    };
  } catch {
    return null;
  }
}

export interface GetProviderCredentialInput {
  repo?: ModelProviderAuthProfileRepository;
  userId: string;
  provider: ModelProviderName;
  preferredAuthType?: ProviderAuthType;
  allowAuthTypeFallback?: boolean;
  now?: Date;
  refresh?: RefreshOAuthTokenFn;
}

export async function getProviderCredential(
  input: GetProviderCredentialInput,
): Promise<ProviderCredential | null> {
  const repo = input.repo ?? databaseRepo;
  const profiles = await repo.listProfiles(input.userId, input.provider);
  const selected = selectProfile(
    profiles,
    input.preferredAuthType,
    input.allowAuthTypeFallback ?? isOpenAIAuthTypeFallbackEnabled(),
  );
  if (!selected) return null;

  const credential = selected.authType === "oauth"
    ? decryptProviderSecret(selected.accessTokenEncrypted)
    : decryptProviderSecret(selected.apiKeyEncrypted);
  if (!credential) return null;

  const resolved: ProviderCredential = {
    provider: selected.provider,
    authType: selected.authType,
    credential,
    refreshToken: decryptProviderSecret(selected.refreshTokenEncrypted),
    expiresAt: selected.expiresAt,
    accountId: selected.accountId,
    email: selected.email,
  };

  if (resolved.authType !== "oauth" || !isExpired(resolved.expiresAt, input.now ?? new Date())) {
    return resolved;
  }

  const refreshed = await (input.refresh ?? refreshOpenAIOAuthToken)(resolved);
  if (!refreshed?.accessToken) {
    throw new Error("OpenAI OAuth token is expired and refresh failed");
  }

  const updated = await repo.updateOAuthTokens({
    id: selected.id,
    accessTokenEncrypted: encryptProviderSecret(refreshed.accessToken),
    refreshTokenEncrypted: refreshed.refreshToken?.trim()
      ? encryptProviderSecret(refreshed.refreshToken)
      : selected.refreshTokenEncrypted,
    expiresAt: refreshed.expiresAt ?? selected.expiresAt,
    accountId: refreshed.accountId ?? selected.accountId,
    email: refreshed.email ?? selected.email,
  });

  return {
    provider: selected.provider,
    authType: "oauth",
    credential: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? resolved.refreshToken,
    expiresAt: updated?.expiresAt ?? refreshed.expiresAt ?? selected.expiresAt,
    accountId: updated?.accountId ?? refreshed.accountId ?? selected.accountId,
    email: updated?.email ?? refreshed.email ?? selected.email,
  };
}

export interface ProviderAuthTypeStatus {
  connected: boolean;
  isDefault: boolean;
  email?: string;
  accountId?: string;
  expiresAt?: string;
}

export interface ProviderStatus {
  providers: Record<string, {
    connected: boolean;
    defaultAuthType: ProviderAuthType | null;
    authTypes: Record<ProviderAuthType, ProviderAuthTypeStatus>;
  }>;
  openai: {
    connected: boolean;
    defaultAuthType: ProviderAuthType | null;
    fallbackEnabled: boolean;
    authTypes: Record<ProviderAuthType, ProviderAuthTypeStatus>;
  };
}

export async function getProviderStatus(input: {
  repo?: ModelProviderAuthProfileRepository;
  userId: string;
}): Promise<ProviderStatus> {
  const repo = input.repo ?? databaseRepo;
  const toStatus = (profile: ModelProviderAuthProfileRecord | null): ProviderAuthTypeStatus => ({
    connected: !!profile,
    isDefault: Boolean(profile?.isDefault),
    ...(profile?.email ? { email: profile.email } : {}),
    ...(profile?.accountId ? { accountId: profile.accountId } : {}),
    ...(profile?.expiresAt ? { expiresAt: profile.expiresAt.toISOString() } : {}),
  });

  const profiles = await repo.listProfiles(input.userId);
  const providers: ProviderStatus["providers"] = {};
  for (const providerConfig of MODEL_PROVIDER_CATALOG) {
    const providerProfiles = profiles.filter((profile) => profile.provider === providerConfig.id);
    const apiProfile = providerProfiles.find((profile) => profile.authType === "api_key") ?? null;
    const oauthProfile = providerProfiles.find((profile) => profile.authType === "oauth") ?? null;
    const defaultProfile = providerProfiles.find((profile) => profile.isDefault) ?? null;
    providers[providerConfig.id] = {
      connected: providerProfiles.length > 0,
      defaultAuthType: defaultProfile?.authType ?? null,
      authTypes: {
        api_key: toStatus(apiProfile),
        oauth: toStatus(oauthProfile),
      },
    };
  }

  return {
    providers,
    openai: {
      connected: providers.openai.connected,
      defaultAuthType: providers.openai.defaultAuthType,
      fallbackEnabled: isOpenAIAuthTypeFallbackEnabled(),
      authTypes: providers.openai.authTypes,
    },
  };
}

export async function deleteProviderProfiles(input: {
  repo?: ModelProviderAuthProfileRepository;
  userId: string;
  provider: ModelProviderId;
}): Promise<number> {
  if (!isSupportedModelProvider(input.provider)) throw new Error("Unsupported model provider");
  return (input.repo ?? databaseRepo).deleteProvider(input.userId, input.provider);
}

export async function deleteOpenAIProviderProfiles(input: {
  repo?: ModelProviderAuthProfileRepository;
  userId: string;
}): Promise<number> {
  return deleteProviderProfiles({ ...input, provider: "openai" });
}

import { db } from './db';
import { sql } from 'drizzle-orm';

export interface UserToken {
  userId: string;
  provider: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes?: string | null;
  accountEmail?: string | null;
}

export async function saveUserToken(token: UserToken): Promise<void> {
  await db.execute(sql`
    INSERT INTO user_oauth_tokens
      (user_id, provider, access_token, refresh_token, expires_at, scopes, account_email, updated_at)
    VALUES
      (${token.userId}, ${token.provider}, ${token.accessToken},
       ${token.refreshToken ?? null}, ${token.expiresAt ?? null},
       ${token.scopes ?? null}, ${token.accountEmail ?? null}, NOW())
    ON CONFLICT (user_id, provider) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = COALESCE(EXCLUDED.refresh_token, user_oauth_tokens.refresh_token),
      expires_at = EXCLUDED.expires_at,
      scopes = EXCLUDED.scopes,
      account_email = EXCLUDED.account_email,
      updated_at = NOW()
  `);
}

export async function getUserToken(userId: string, provider: string): Promise<UserToken | null> {
  const rows = await db.execute(sql`
    SELECT user_id, provider, access_token, refresh_token, expires_at, scopes, account_email
    FROM user_oauth_tokens
    WHERE user_id = ${userId} AND provider = ${provider}
  `);
  const row = (rows as any).rows?.[0] ?? (Array.isArray(rows) ? rows[0] : null);
  if (!row) return null;
  return {
    userId: row.user_id,
    provider: row.provider,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    scopes: row.scopes,
    accountEmail: row.account_email,
  };
}

export async function deleteUserToken(userId: string, provider: string): Promise<void> {
  await db.execute(sql`
    DELETE FROM user_oauth_tokens WHERE user_id = ${userId} AND provider = ${provider}
  `);
}

export async function getUserOAuthStatus(userId: string): Promise<Record<string, { connected: boolean; email?: string }>> {
  const rows = await db.execute(sql`
    SELECT provider, account_email, expires_at FROM user_oauth_tokens WHERE user_id = ${userId}
  `);
  const result: Record<string, { connected: boolean; email?: string }> = {
    google: { connected: false },
    microsoft: { connected: false },
  };
  const items = (rows as any).rows ?? (Array.isArray(rows) ? rows : []);
  for (const row of items) {
    result[row.provider] = {
      connected: true,
      email: row.account_email ?? undefined,
    };
  }
  return result;
}

export async function refreshGoogleToken(token: UserToken): Promise<UserToken | null> {
  if (!token.refreshToken) return null;
  const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: token.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const data = await res.json() as any;
    if (!data.access_token) return null;

    const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null;
    const updated: UserToken = {
      ...token,
      accessToken: data.access_token,
      expiresAt,
    };
    await saveUserToken(updated);
    return updated;
  } catch {
    return null;
  }
}

export async function getValidGoogleToken(userId: string): Promise<string | null> {
  const token = await getUserToken(userId, 'google');
  if (!token) return null;

  if (token.expiresAt && token.expiresAt.getTime() < Date.now() + 60_000) {
    const refreshed = await refreshGoogleToken(token);
    return refreshed?.accessToken ?? null;
  }
  return token.accessToken;
}

export async function refreshMicrosoftToken(token: UserToken): Promise<UserToken | null> {
  if (!token.refreshToken) return null;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: token.refreshToken,
        grant_type: 'refresh_token',
        scope: 'offline_access Calendars.Read Mail.Read User.Read',
      }),
    });
    const data = await res.json() as any;
    if (!data.access_token) return null;

    const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null;
    const updated: UserToken = {
      ...token,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? token.refreshToken,
      expiresAt,
    };
    await saveUserToken(updated);
    return updated;
  } catch {
    return null;
  }
}

export async function getValidMicrosoftToken(userId: string): Promise<string | null> {
  const token = await getUserToken(userId, 'microsoft');
  if (!token) return null;

  if (token.expiresAt && token.expiresAt.getTime() < Date.now() + 60_000) {
    const refreshed = await refreshMicrosoftToken(token);
    return refreshed?.accessToken ?? null;
  }
  return token.accessToken;
}

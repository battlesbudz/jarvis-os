import { Router } from 'express';
import type { Request, Response } from 'express';
import { saveUserToken, deleteUserToken, getUserOAuthStatus } from './userTokenStore';

export const oauthRouter = Router();
export const oauthCallbackRouter = Router();

function getBaseUrl(req: Request): string {
  const domain = process.env.REPLIT_DOMAINS?.split(',')[0];
  if (domain) {
    const isDev = process.env.REPLIT_DEV_DOMAIN === domain;
    return isDev ? `https://${domain}:5000` : `https://${domain}`;
  }
  return `${req.protocol}://${req.get('host')}`;
}

function successHtml(provider: string, email?: string): string {
  const displayName = provider === 'google' ? 'Google (Calendar & Gmail)' : provider === 'slack' ? 'Slack' : 'Microsoft Outlook';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connected — GamePlan</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f; color: #fff;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 20px;
    }
    .card {
      text-align: center; max-width: 360px;
      background: #1a1a1a; border-radius: 20px; padding: 40px 32px;
    }
    .check { font-size: 52px; margin-bottom: 20px; }
    h2 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    p { color: #888; font-size: 15px; line-height: 1.5; margin-bottom: 6px; }
    .email { color: #6366f1; font-size: 14px; margin-top: 4px; }
    .close-note { color: #555; font-size: 13px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✅</div>
    <h2>${displayName} Connected</h2>
    ${email ? `<p class="email">${email}</p>` : ''}
    <p class="close-note">You can close this tab and return to GamePlan.</p>
  </div>
  <script>
    setTimeout(function() { window.close(); }, 2000);
  </script>
</body>
</html>`;
}

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Error — GamePlan</title>
  <style>
    body { font-family: sans-serif; background: #0f0f0f; color: #fff;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { text-align: center; padding: 40px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:48px;margin-bottom:16px">❌</div>
    <h2>Connection Failed</h2>
    <p style="color:#888;margin-top:8px">${message}</p>
    <p style="color:#555;margin-top:20px;font-size:13px">You can close this tab.</p>
  </div>
</body>
</html>`;
}

/* ─── Google OAuth ─────────────────────────────────────────────── */

oauthRouter.get('/google/authorize', (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'Google OAuth not configured' });

  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/oauth/google/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: [
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/drive.file',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: userId,
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({ url, redirectUri });
});

oauthCallbackRouter.get('/google/callback', async (req: Request, res: Response) => {
  const { code, state: userId, error } = req.query as Record<string, string>;

  if (error || !code || !userId) {
    return res.send(errorHtml(error || 'Authorization was cancelled.'));
  }

  const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.send(errorHtml('Google OAuth credentials not configured on the server.'));
  }

  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/oauth/google/callback`;

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) {
      console.error('Google token exchange failed:', tokenData);
      return res.send(errorHtml('Failed to exchange authorization code. Please try again.'));
    }

    let accountEmail: string | undefined;
    try {
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userInfo = await userInfoRes.json() as any;
      accountEmail = userInfo.email;
    } catch {}

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

    await saveUserToken({
      userId,
      provider: 'google',
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
      scopes: tokenData.scope,
      accountEmail: accountEmail || '',
    });

    return res.send(successHtml('google', accountEmail));
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return res.send(errorHtml('An unexpected error occurred. Please try again.'));
  }
});

/* ─── Microsoft OAuth ──────────────────────────────────────────── */

oauthRouter.get('/microsoft/authorize', (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    return res.json({ error: 'Microsoft OAuth not configured' });
  }

  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/oauth/microsoft/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'offline_access Calendars.Read Mail.Read User.Read',
    state: userId,
    response_mode: 'query',
  });

  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  res.json({ url, redirectUri });
});

oauthCallbackRouter.get('/microsoft/callback', async (req: Request, res: Response) => {
  const { code, state: userId, error, error_description } = req.query as Record<string, string>;

  if (error || !code || !userId) {
    return res.send(errorHtml(error_description || error || 'Authorization was cancelled.'));
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.send(errorHtml('Microsoft OAuth credentials not configured on the server.'));
  }

  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/oauth/microsoft/callback`;

  try {
    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: 'offline_access Calendars.Read Mail.Read User.Read',
      }),
    });

    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) {
      console.error('Microsoft token exchange failed:', tokenData);
      return res.send(errorHtml('Failed to exchange authorization code. Please try again.'));
    }

    let accountEmail: string | undefined;
    try {
      const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const me = await meRes.json() as any;
      accountEmail = me.userPrincipalName || me.mail;
    } catch {}

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

    await saveUserToken({
      userId,
      provider: 'microsoft',
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
      scopes: tokenData.scope,
      accountEmail: accountEmail || '',
    });

    return res.send(successHtml('microsoft', accountEmail));
  } catch (err) {
    console.error('Microsoft OAuth callback error:', err);
    return res.send(errorHtml('An unexpected error occurred. Please try again.'));
  }
});

/* ─── Slack OAuth ─────────────────────────────────────────────── */

oauthRouter.get('/slack/authorize', (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) return res.json({ error: 'Slack OAuth not configured' });

  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/oauth/slack/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    user_scope: 'channels:history,channels:read,im:history,im:read,groups:history,groups:read,users:read',
    redirect_uri: redirectUri,
    state: userId,
  });

  const url = `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  res.json({ url, redirectUri });
});

oauthCallbackRouter.get('/slack/callback', async (req: Request, res: Response) => {
  const { code, state: userId, error: oauthError } = req.query as Record<string, string>;

  if (oauthError || !code || !userId) {
    return res.send(errorHtml(oauthError || 'Authorization was cancelled.'));
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.send(errorHtml('Slack OAuth credentials not configured on the server.'));
  }

  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/oauth/slack/callback`;

  try {
    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenRes.json() as any;
    const userToken = tokenData.authed_user?.access_token;
    if (!userToken) {
      console.error('Slack token exchange failed:', tokenData);
      return res.send(errorHtml('Failed to exchange authorization code. Please try again.'));
    }

    const authedUserId = tokenData.authed_user?.id || '';
    let accountEmail = '';
    let teamName = tokenData.team?.name || '';

    try {
      const userInfoRes = await fetch('https://slack.com/api/users.info', {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      const userInfo = await userInfoRes.json() as any;
      if (userInfo.ok && userInfo.user) {
        accountEmail = userInfo.user.profile?.email || teamName || authedUserId;
      }
    } catch {}

    if (!accountEmail) accountEmail = teamName || authedUserId;

    await saveUserToken({
      userId,
      provider: 'slack',
      accessToken: userToken,
      refreshToken: null,
      expiresAt: null,
      scopes: 'channels:history,channels:read,im:history,im:read,groups:history,groups:read,users:read',
      accountEmail,
    });

    // Wire the Slack identity into channel_links so inbound DMs and /jarvis
    // slash commands can resolve the GamePlan user.
    try {
      const teamId = tokenData.team?.id || '';
      if (teamId && authedUserId) {
        const { registerSlackUserLink } = await import('./channels/slackWebhook');
        await registerSlackUserLink(userId, teamId, authedUserId);
      }
    } catch (linkErr) {
      console.error('[slack] registerSlackUserLink failed (non-fatal):', linkErr);
    }

    return res.send(successHtml('slack', accountEmail));
  } catch (err) {
    console.error('Slack OAuth callback error:', err);
    return res.send(errorHtml('An unexpected error occurred. Please try again.'));
  }
});

/* ─── Shared endpoints ─────────────────────────────────────────── */

oauthRouter.get('/status', async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const status = await getUserOAuthStatus(userId);
    if (!status.microsoft?.connected) {
      const { checkOutlookConnection } = await import('./integrations/outlook');
      const projConnected = await checkOutlookConnection().catch(() => false);
      if (projConnected) {
        status.microsoft = { connected: true, accounts: [] };
      }
    }
    res.json(status);
  } catch (err) {
    console.error('OAuth status error:', err);
    res.json({ google: { connected: false }, microsoft: { connected: false }, slack: { connected: false } });
  }
});

oauthRouter.delete('/:provider/disconnect', async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const { provider } = req.params;
  if (!['google', 'microsoft', 'slack'].includes(provider)) {
    return res.status(400).json({ error: 'Unknown provider' });
  }
  try {
    const email = req.query.email as string | undefined;
    await deleteUserToken(userId, provider, email);
    res.json({ success: true });
  } catch (err) {
    console.error('Disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

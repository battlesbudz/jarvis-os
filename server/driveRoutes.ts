import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from './db';
import { eq } from 'drizzle-orm';
import * as schema from '@shared/schema';
import { getValidGoogleToken } from './userTokenStore';
import { ensureJarvisFolder, checkDriveScope } from './integrations/googleDrive';

function getBaseUrl(req: Request): string {
  const domain = process.env.REPLIT_DOMAINS?.split(',')[0];
  if (domain) {
    const isDev = process.env.REPLIT_DEV_DOMAIN === domain;
    return isDev ? `https://${domain}:5000` : `https://${domain}`;
  }
  return `${req.protocol}://${req.get('host')}`;
}

export const driveRouter = Router();

interface DrivePrefs {
  driveEnabled?: boolean;
  driveAutoSavePlans?: boolean;
  driveAutoSaveWeekly?: boolean;
  driveFolderId?: string;
  driveFolderLink?: string;
}

async function getUserDrivePrefs(userId: string): Promise<DrivePrefs> {
  const rows = await db
    .select({ data: schema.userPreferences.data })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .limit(1);
  const data = (rows[0]?.data as Record<string, unknown>) || {};
  return {
    driveEnabled: !!data.driveEnabled,
    driveAutoSavePlans: data.driveAutoSavePlans !== false,
    driveAutoSaveWeekly: data.driveAutoSaveWeekly !== false,
    driveFolderId: typeof data.driveFolderId === 'string' ? data.driveFolderId : undefined,
    driveFolderLink: typeof data.driveFolderLink === 'string' ? data.driveFolderLink : undefined,
  };
}

async function patchUserPrefs(userId: string, patch: Record<string, unknown>): Promise<void> {
  const rows = await db
    .select({ data: schema.userPreferences.data })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .limit(1);
  const current = (rows[0]?.data as Record<string, unknown>) || {};
  const updated = { ...current, ...patch };
  await db
    .insert(schema.userPreferences)
    .values({ userId, data: updated })
    .onConflictDoUpdate({
      target: [schema.userPreferences.userId],
      set: { data: updated, updatedAt: new Date() },
    });
}

driveRouter.get('/status', async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const accessToken = await getValidGoogleToken(userId);
    if (!accessToken) {
      return res.json({
        googleConnected: false,
        hasDriveScope: false,
        enabled: false,
        autoSavePlans: true,
        autoSaveWeekly: true,
        folderLink: null,
      });
    }

    const hasDriveScope = await checkDriveScope(accessToken);
    const prefs = await getUserDrivePrefs(userId);

    res.json({
      googleConnected: true,
      hasDriveScope,
      enabled: prefs.driveEnabled && hasDriveScope,
      autoSavePlans: prefs.driveAutoSavePlans !== false,
      autoSaveWeekly: prefs.driveAutoSaveWeekly !== false,
      folderLink: prefs.driveFolderLink || null,
    });
  } catch (err) {
    console.error('[Drive] status error:', err);
    res.status(500).json({ error: 'Failed to fetch Drive status' });
  }
});

driveRouter.post('/enable', async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const accessToken = await getValidGoogleToken(userId);
    if (!accessToken) {
      return res.status(400).json({ error: 'Google account not connected. Connect Google first.' });
    }

    const hasDriveScope = await checkDriveScope(accessToken);
    if (!hasDriveScope) {
      const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
      if (!clientId) return res.status(500).json({ error: 'Google OAuth not configured' });
      const baseUrl = getBaseUrl(req);
      const redirectUri = `${baseUrl}/api/oauth/google/callback`;
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/drive.file',
        access_type: 'offline',
        include_granted_scopes: 'true',
        prompt: 'consent',
        state: userId,
      });
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      return res.json({ needsConsent: true, authUrl });
    }

    const folderId = await ensureJarvisFolder(accessToken);
    const folderLink = `https://drive.google.com/drive/folders/${folderId}`;

    await patchUserPrefs(userId, {
      driveEnabled: true,
      driveFolderId: folderId,
      driveFolderLink: folderLink,
    });

    console.log(`[Drive] Enabled for user ${userId}, folder ${folderId}`);
    res.json({ success: true, folderId, folderLink });
  } catch (err) {
    console.error('[Drive] enable error:', err);
    res.status(500).json({ error: 'Failed to enable Drive integration' });
  }
});

driveRouter.patch('/settings', async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const { autoSavePlans, autoSaveWeekly } = req.body as {
    autoSavePlans?: boolean;
    autoSaveWeekly?: boolean;
  };

  try {
    const patch: Record<string, unknown> = {};
    if (typeof autoSavePlans === 'boolean') patch.driveAutoSavePlans = autoSavePlans;
    if (typeof autoSaveWeekly === 'boolean') patch.driveAutoSaveWeekly = autoSaveWeekly;
    await patchUserPrefs(userId, patch);
    res.json({ success: true });
  } catch (err) {
    console.error('[Drive] settings error:', err);
    res.status(500).json({ error: 'Failed to update Drive settings' });
  }
});

driveRouter.delete('/disable', async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    await patchUserPrefs(userId, {
      driveEnabled: false,
      driveFolderId: undefined,
      driveFolderLink: undefined,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[Drive] disable error:', err);
    res.status(500).json({ error: 'Failed to disable Drive' });
  }
});

export async function getUserDriveSettings(userId: string): Promise<{
  enabled: boolean;
  autoSavePlans: boolean;
  autoSaveWeekly: boolean;
  accessToken: string | null;
  folderId: string | null;
  folderLink: string | null;
}> {
  const prefs = await getUserDrivePrefs(userId);
  if (!prefs.driveEnabled) {
    return { enabled: false, autoSavePlans: false, autoSaveWeekly: false, accessToken: null, folderId: null, folderLink: null };
  }
  const accessToken = await getValidGoogleToken(userId);
  if (!accessToken) {
    return { enabled: false, autoSavePlans: false, autoSaveWeekly: false, accessToken: null, folderId: null, folderLink: null };
  }
  // Validate that Drive scope is still active before handing back enabled=true.
  // This prevents silent write failures when a user revokes Drive access externally.
  let hasScope = false;
  try {
    hasScope = await checkDriveScope(accessToken);
  } catch {
    // Network error — fail open (allow writes to proceed; they will catch their own errors).
    hasScope = true;
  }
  if (!hasScope) {
    return { enabled: false, autoSavePlans: false, autoSaveWeekly: false, accessToken: null, folderId: null, folderLink: null };
  }
  return {
    enabled: true,
    autoSavePlans: prefs.driveAutoSavePlans !== false,
    autoSaveWeekly: prefs.driveAutoSaveWeekly !== false,
    accessToken,
    folderId: prefs.driveFolderId || null,
    folderLink: prefs.driveFolderLink || null,
  };
}

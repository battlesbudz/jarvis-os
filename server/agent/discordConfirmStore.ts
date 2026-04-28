/**
 * Server-side pending-confirmation token store for Discord actions.
 *
 * When the coach wants to ask the user whether to create a channel or post a
 * message, it calls `discord_request_confirm` which records a token here.
 * The actual `discord_create_channel` and `discord_post` tools then call
 * `consumeConfirmToken` — if no valid token is present the tool refuses and
 * instructs the coach to re-confirm.  This prevents a stale "yes" from an
 * earlier turn in a long conversation from being re-used.
 *
 * TTL: 5 minutes.  Only one pending confirmation per user at a time.
 */

export type DiscordConfirmAction = "create_channel" | "post";

interface PendingConfirmation {
  action: DiscordConfirmAction;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;

const _store = new Map<string, PendingConfirmation>();

/** Record a pending confirmation for a user.  Overwrites any existing token. */
export function setConfirmToken(userId: string, action: DiscordConfirmAction): void {
  _store.set(userId, { action, expiresAt: Date.now() + TTL_MS });
}

/**
 * Consume the pending confirmation token.
 * Returns true if a valid, unexpired token for `action` exists (and deletes it).
 * Returns false if no token, the token has expired, or the action doesn't match.
 */
export function consumeConfirmToken(userId: string, action: DiscordConfirmAction): boolean {
  const token = _store.get(userId);
  if (!token) return false;
  if (Date.now() > token.expiresAt) {
    _store.delete(userId);
    return false;
  }
  if (token.action !== action) return false;
  _store.delete(userId);
  return true;
}

/** Clear any pending confirmation token for a user (e.g. on session end). */
export function clearConfirmToken(userId: string): void {
  _store.delete(userId);
}

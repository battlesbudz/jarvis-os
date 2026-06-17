export function shouldRememberRouteForAuthRedirect({
  wasAuthenticated,
  sessionExpired,
}: {
  wasAuthenticated: boolean;
  sessionExpired: boolean;
}): boolean {
  return !wasAuthenticated || sessionExpired;
}

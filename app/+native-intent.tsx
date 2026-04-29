export function redirectSystemPath({
  path,
  initial,
}: { path: string; initial: boolean }) {
  const clean = path.replace(/^\/+/, '');
  if (clean === 'scheduled') return '/scheduled';
  if (clean === 'inbox') return '/inbox';
  if (clean === 'insights') return '/insights';
  if (clean === 'agents') return '/agents';
  if (clean === 'settings') return '/settings';
  return '/';
}

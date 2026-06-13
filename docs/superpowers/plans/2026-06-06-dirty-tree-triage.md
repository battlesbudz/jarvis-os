# Dirty Tree Triage - 2026-06-06

Purpose: keep the current working tree safe after the deployed Projects/job-runner fixes, without accidentally committing or reverting unrelated work.

## Current Verified Fix Bucket

These files are tied to the deployed fix that was verified against `https://gameplanjarvisai.up.railway.app` in the existing Chrome session:

- `app/(tabs)/index.tsx`
- `dashboard/components/Sidebar.tsx`
- `e2e/jarvis.spec.ts`
- `scripts/__tests__/dashboardProjectsNavigation.test.mjs`
- `scripts/run-agent-tests.mjs`
- `components/missionControl/TasksScreen.tsx`
- `server/agent/buildFeatureJobCore.ts`
- `server/agent/__tests__/buildFeatureJob.test.ts`
- `server/agent/jobQueue.ts`
- `server/agent/appProjectRunner.ts`
- `server/projectRoutes.ts`
- `server_dist/index.js`

Verification already completed:

- `node .\node_modules\tsx\dist\cli.mjs server\agent\__tests__\buildFeatureJob.test.ts`
- `npm.cmd test`
- `npm.cmd run server:build`
- Railway deployment `75821dd3-b348-4bba-9975-2960648a4320` reported online.
- Chrome deployed URL verification:
  - Dashboard Projects click navigated to `/projects`.
  - Projects page rendered real project content instead of the Task Panel.
  - A real queued project advanced from 1/5 to 5/5 and completed successfully.

Important: `server/projectRoutes.ts` is a mixed file. It includes the app-project resume change plus adjacent artifact/download handling changes, so inspect its diff before staging.

## Replit / OpenClaw Removal Bucket

These changes appear intentional and should stay grouped together rather than mixed with user-facing product fixes:

- `.replit`
- `replit.md`
- `replit.nix`
- `.replit_integration_files/**`
- `server/replit_integrations/**`
- `scripts/copy-replit-user-to-railway.mjs`
- `openclaw-copycat.md`
- `attached_assets/OpenClaw*`
- OpenClaw-to-agent migration renames
- `scripts/__tests__/noReplitRuntimeDeps.test.mjs`

Recommended verification before committing this bucket:

- `npm.cmd test`
- `node .\scripts\__tests__\noReplitRuntimeDeps.test.mjs`
- `npm.cmd run server:build`

## Generated / Build Output Bucket

- `server_dist/index.js`

Only commit this with the source changes that require it. Do not stage it by itself.

`e2e/results.json` was checked and does not currently exist.

## Operational Rollback Artifacts

Untracked rollback material exists under:

- `.ops/rollback/codex-oauth-gateway-20260601-221957/**`

These should not be bundled into the product or Replit cleanup commits unless the rollback record is intentionally being archived in git.

## Plan / Spec Documents

Untracked or modified planning files include:

- `docs/superpowers/plans/2026-06-02-gbrain-jarvis-derived-brain.md`
- `docs/superpowers/plans/2026-06-06-serial-agent-unfinished-feature-rollout.md`
- `docs/superpowers/plans/2026-06-06-dirty-tree-triage.md`

Commit these only when they match the implementation scope being published.

## Mixed Or Unrelated Dirty Areas To Audit Separately

Do not stage these by default. They need a separate read-through because they may be older user work, adjacent agent work, or broader feature work:

- `package.json`
- `package-lock.json`
- database/schema/migration files
- broad `server/routes.ts` changes
- server integration files
- `server/appDelivery/**`
- project artifact/public URL helpers
- `app/(tabs)/projects.tsx`
- auth/OAuth gateway related files
- transcript/cache/scheduler/intelligence files

## Known Diff Check Issues

`git diff --check` is not clean because of existing blank-line-at-EOF issues in:

- `scripts/build.js`
- `server/db.ts`
- `server/integrations/github.ts`
- `server/intelligence/integrationValidator.ts`
- `server/lib/transcriptCache.ts`
- `server/routes.ts`
- `server/scheduler.ts`
- `shared/schema.ts`

There are also many CRLF warnings. Treat whitespace cleanup as its own mechanical commit if it is needed.

## Recommended Safe Commit Order

1. Verified Projects navigation and project-runner completion/progress fix.
2. Replit/OpenClaw runtime dependency removal.
3. App delivery/project artifact fixes, if confirmed as part of the current release.
4. Planning/docs updates.
5. Mechanical whitespace normalization, if wanted.

## Safe Default Right Now

Do not delete or revert anything. Stage only a narrow file list after inspecting mixed diffs, then run the focused tests again before committing.

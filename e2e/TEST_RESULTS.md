# E2E Test Results — May 2026

## Infrastructure Status
Playwright browser (Chromium) could not be installed in this environment.
The Replit `runTest()` testing infrastructure has a project-level OAuth block
from a prior test run (before username/password was added to the login screen).

## Manual API Verification (real user account via /api/dev-token)
Run: `TOKEN=$(curl -s http://localhost:5000/api/dev-token | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")`

| Test | Status | Detail |
|------|--------|--------|
| GET /api/soul | ✓ PASS | 11,242 chars of soul content |
| GET /api/memories | ✓ PASS | 7 memories |
| GET /api/capability-gaps | ✓ PASS | returns {gaps:[]} |
| GET /api/projects | ✓ PASS | returns [] |
| POST /api/auth/login (bad creds) | ✓ PASS | returns 401 "Invalid username or password" |
| GET /api/dev-token | ✓ PASS | returns JWT for first user |

## Login UI elements verified (code review)
- `[data-testid="username-input"]` — present in app/login.tsx ✓
- `[data-testid="password-input"]` — present in app/login.tsx ✓
- `[data-testid="password-login-button"]` — present in app/login.tsx ✓
- `[data-testid="dev-login-button"]` — present in app/login.tsx ✓
- `[data-testid="google-sign-in-button"]` — present in app/login.tsx ✓

## Running tests locally
Once a Chromium browser is available, run:
```
npx playwright test
```
The tests in e2e/jarvis.spec.ts will:
1. Verify login form fields visible on screen
2. Verify invalid-credential error message
3. Dev login -> main app loads (no OAuth redirect)
4. Profile tab -> JARVIS Soul section visible
5. Capability Gaps screen loads cleanly
6. Projects screen loads cleanly

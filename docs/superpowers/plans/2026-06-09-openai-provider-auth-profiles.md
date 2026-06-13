# OpenAI Provider Auth Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Jarvis's reusable provider credential layer for OpenAI API-key profiles and configurable OpenAI OAuth profiles.

**Architecture:** Store user-scoped provider auth profiles in a dedicated table keyed by provider and auth type. Expose focused auth routes for API key save, OAuth start/callback handling, status, deletion, and runtime credential lookup. Keep existing ChatGPT/Codex gateway behavior separate from user OAuth profile storage, and require explicit fallback configuration before switching auth types.

**Tech Stack:** Express, Drizzle/Postgres, Node crypto/Web Crypto, Expo React Native settings UI, plain assertion tests run with `tsx`.

---

### Task 1: Persistence Contract

**Files:**
- Modify: `shared/schema.ts`
- Modify: `server/db.ts`
- Create: `migrations/0011_model_provider_auth_profiles.sql`
- Test: `server/agent/__tests__/modelProviderAuthProfiles.assert.ts`

- [ ] **Step 1: Write the failing schema/service test**

Create a pure service test that verifies API keys and OAuth tokens are stored as encrypted fields, OpenAI is always stored as provider `openai`, and default selection is auth-type scoped.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx tsx server/agent/__tests__/modelProviderAuthProfiles.assert.ts`
Expected: FAIL because the service file does not exist yet.

- [ ] **Step 3: Add table and migration**

Add `modelProviderAuthProfiles` to `shared/schema.ts`, create the matching SQL migration, and add `ensureTablesExist()` bootstrap SQL.

- [ ] **Step 4: Implement service helpers**

Create `server/agent/providers/modelProviderAuthProfiles.ts` with encryption, redaction, upsert, delete, status, OAuth state, refresh, and `getProviderCredential(userId, provider, preferredAuthType)` helpers.

- [ ] **Step 5: Run the schema/service test**

Run: `npx tsx server/agent/__tests__/modelProviderAuthProfiles.assert.ts`
Expected: PASS.

### Task 2: OpenAI Auth Routes

**Files:**
- Create: `server/routes/openaiProviderAuthRoutes.ts`
- Modify: `server/routes.ts`
- Test: `server/agent/__tests__/openaiProviderAuthRoutes.assert.ts`

- [ ] **Step 1: Write the failing route test**

Test that `POST /api/auth/openai-oauth/start` creates PKCE state, `POST /api/auth/openai-oauth/callback-url` validates pasted callback URLs, `GET /api/auth/openai-oauth/callback` completes the same flow, `POST /api/auth/openai-api-key` stores an API-key profile, `GET /api/auth/providers/status` redacts secrets, and `DELETE /api/auth/providers/openai` removes OpenAI profiles.

- [ ] **Step 2: Run the route test and verify it fails**

Run: `npx tsx server/agent/__tests__/openaiProviderAuthRoutes.assert.ts`
Expected: FAIL because the routes do not exist yet.

- [ ] **Step 3: Implement route handlers**

Implement the requested endpoints with authenticated user checks, clear errors for missing OAuth env config, state validation, manual callback URL parsing, token exchange through configurable env URLs, and safe status output.

- [ ] **Step 4: Register the route module**

Import and call `registerOpenAIProviderAuthRoutes(app)` from `server/routes.ts`.

- [ ] **Step 5: Run the route test**

Run: `npx tsx server/agent/__tests__/openaiProviderAuthRoutes.assert.ts`
Expected: PASS.

### Task 3: Runtime Credential Resolution

**Files:**
- Modify: `server/agent/providers/openai.ts`
- Modify: `server/agent/providers/env.ts`
- Modify: `server/agent/providers/index.ts`
- Test: `server/agent/__tests__/providerEnv.assert.ts`

- [ ] **Step 1: Add failing runtime test coverage**

Assert that user-selected OAuth credentials are used for OpenAI requests, expired OAuth profiles refresh, direct API-key credentials are used only when selected, and no OAuth/API-key fallback occurs unless a fallback flag is explicit.

- [ ] **Step 2: Run the runtime test and verify it fails**

Run: `npx tsx server/agent/__tests__/providerEnv.assert.ts`
Expected: FAIL on the new user-auth cases.

- [ ] **Step 3: Thread `userId` into OpenAI provider queries**

Resolve `getProviderCredential(userId, "openai", preferredAuthType)` inside the OpenAI provider when a user-scoped profile exists, otherwise preserve the current environment-configured behavior.

- [ ] **Step 4: Keep fallback explicit**

Add a single explicit fallback switch, defaulting off, so OAuth and API-key profiles do not silently replace one another.

- [ ] **Step 5: Run runtime tests**

Run: `npx tsx server/agent/__tests__/providerEnv.assert.ts`
Expected: PASS.

### Task 4: Settings UI

**Files:**
- Modify: `app/(tabs)/settings.tsx`

- [ ] **Step 1: Add UI state and API calls**

Load provider status, start OAuth, submit manual callback URLs, save API keys, delete OpenAI provider profiles, and choose Jarvis default model mode.

- [ ] **Step 2: Add controls**

Add the buttons `Connect ChatGPT Subscription`, `Use OpenAI API Key`, and `Use Jarvis Default Model`, plus the required OAuth description and manual callback paste field.

- [ ] **Step 3: Verify UI type/build health**

Run: `npm run server:build`
Expected: PASS without unrelated generated diff pollution.

### Task 5: Docs and Verification

**Files:**
- Modify: `docs/chatgpt-codex-oauth.md`
- Modify: `scripts/run-agent-tests.mjs`

- [ ] **Step 1: Document the distinction**

Clarify that the existing gateway route is a Codex CLI bridge, while `model_provider_auth_profiles` is the reusable user credential system.

- [ ] **Step 2: Add tests to runner**

Register the new assertion tests in `scripts/run-agent-tests.mjs`.

- [ ] **Step 3: Run targeted verification**

Run:

```powershell
npx tsx server/agent/__tests__/modelProviderAuthProfiles.assert.ts
npx tsx server/agent/__tests__/openaiProviderAuthRoutes.assert.ts
npx tsx server/agent/__tests__/providerEnv.assert.ts
npm run server:build
```

Expected: all targeted checks pass.

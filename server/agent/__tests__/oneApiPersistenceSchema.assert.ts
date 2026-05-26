import assert from "node:assert/strict";
import { getTableName } from "drizzle-orm";
import { userOAuthTokens } from "../../../shared/schema";

assert.equal(getTableName(userOAuthTokens), "user_oauth_tokens");
assert.ok(userOAuthTokens.userId, "user_oauth_tokens exposes user_id");
assert.ok(userOAuthTokens.provider, "user_oauth_tokens exposes provider");
assert.ok(userOAuthTokens.accessToken, "user_oauth_tokens exposes access_token");
assert.ok(userOAuthTokens.accountEmail, "user_oauth_tokens exposes account_email");

console.log("OK: One API keys persist in the canonical Drizzle schema.");

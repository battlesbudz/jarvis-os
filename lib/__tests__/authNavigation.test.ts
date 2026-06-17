import assert from "node:assert/strict";
import { shouldRememberRouteForAuthRedirect } from "../auth-navigation";

function run() {
  assert.equal(
    shouldRememberRouteForAuthRedirect({
      wasAuthenticated: true,
      sessionExpired: false,
    }),
    false,
    "manual logout should not preserve the current protected route",
  );

  assert.equal(
    shouldRememberRouteForAuthRedirect({
      wasAuthenticated: true,
      sessionExpired: true,
    }),
    true,
    "expired sessions should preserve the current protected route",
  );

  assert.equal(
    shouldRememberRouteForAuthRedirect({
      wasAuthenticated: false,
      sessionExpired: false,
    }),
    true,
    "direct unauthenticated visits should preserve the requested protected route",
  );

  console.log("authNavigation tests passed");
}

run();

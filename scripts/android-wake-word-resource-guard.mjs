import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sources = [
  path.join(root, "android/app/src/main/java/com/gameplan/daemon/WakeWordService.kt"),
  path.join(root, "plugins/android-daemon-native/src/main/java/com/gameplan/daemon/WakeWordService.kt"),
];

for (const sourcePath of sources) {
  const source = fs.readFileSync(sourcePath, "utf8");
  const label = path.relative(root, sourcePath);

  assert.match(source, /MIN_RECOGNIZER_RESTART_DELAY_MS\s*=\s*1000L/, `${label}: recognizer restarts need a one-second minimum delay`);
  assert.match(source, /private var restartRunnable: Runnable\? = null/, `${label}: recognizer restarts need a single pending callback`);
  assert.match(source, /if \(!active \|\| restartRunnable != null\) return/, `${label}: duplicate recognizer restarts must be coalesced`);
  assert.match(source, /mainHandler\.removeCallbacks\(it\)/, `${label}: pending recognizer restarts must be cancellable`);
  assert.doesNotMatch(source, /restartRecognizer\((?:100|300)\)(?!\d)/, `${label}: recognizer must not restart in a tight 100-300ms loop`);
  assert.match(source, /cancelPendingRestart\(\)/, `${label}: lifecycle transitions must cancel pending recognizer restarts`);
  assert.match(source, /private fun destroyRecognizer\(\)/, `${label}: lifecycle transitions must release the recognizer`);
}

console.log("Android wake-word resource guard passed");

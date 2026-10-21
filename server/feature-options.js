// SPDX-License-Identifier: AGPL-3.0-only

/**
 * LoRAs and Cloud Models used to be global switches in Settings › Models. They are now
 * access-profile features; only the deployment's own environment can still switch one off
 * for everyone (a lock). This carries a value saved from Settings into every access
 * profile once, then drops it from Studio's .env, so nobody gains or loses access.
 * A value the deployment sets stays where it is, as the lock.
 */
export const retiredFeatureSwitches = Object.freeze([
  ["loras", "STUDIO_ENABLE_LORAS"],
  ["cloudModels", "STUDIO_ENABLE_GROK"]
]);

/**
 * `source(key)` is deployment-settings.js `settingSource`; `migrate(globals)` writes the
 * profiles once and returns whether it did; `remove(key)` drops a Studio-saved value.
 * Returns the keys taken out of .env.
 */
export function retireFeatureSwitches({ multiUser, source, migrate, remove, env = process.env }) {
  if (!multiUser) return [];
  const globals = {};
  const saved = [];
  for (const [feature, key] of retiredFeatureSwitches) {
    const from = source(key).source;
    if (from === "deployment") continue;
    globals[feature] = env[key] !== "0";
    if (from === "studio") saved.push(key);
  }
  if (!migrate(globals)) return [];
  // The running process keeps what it read at start until the next restart, as these always applied.
  for (const key of saved) remove(key);
  return saved;
}

import crypto from "node:crypto";
import { accessFeatures, builtInAccessProfile, normaliseAccessProfile } from "./account-policy.js";
import { verifiedBackup } from "./persistence/migration.ts";
import { withOfflineDatabase, writeRuntimeDocument } from "./persistence/runtime.ts";
import { isObject } from "./values.js";

/**
 * The migrate-runtime step for the approval queue and the group features Studio retired. Each
 * ordinary account without a group (one that was waiting for approval) joins the default group,
 * the `pending` marks and the `requireApproval` switch go, a missing default becomes the built-in
 * User group (added when absent), and each group keeps only the features Studio still reads.
 * Plans by default, listing the accounts that join and, per group, the features `removed` and the
 * retired ones it had off, which its members now have (`granted`); `apply` copies the accounts
 * store to `.backups/account-access-*` with a `mapping.json` (restorable with `--restore`), then
 * writes it, with Studio stopped. A second run finds nothing.
 */
// The retired features that gated something; Presets gated nothing.
const retired = [
  "gallery",
  "imageGeneration",
  "imageReferences",
  "promptHistory",
  "upscale",
  "videoGeneration",
  "videoReferences",
];

export function accountAccess(dataDir, { apply = false } = {}) {
  const result = { applied: false, backup: "", defaultGroup: "", joined: [], groups: {} };
  const text = withOfflineDatabase(
    dataDir,
    (db) => db.prepare("SELECT value FROM studio_documents WHERE name = ?").get("accounts")?.value,
  );
  if (!text) return result;
  const store = JSON.parse(text);
  const profiles = isObject(store.profiles) ? { ...store.profiles } : {};
  const accounts = Array.isArray(store.accounts) ? store.accounts : [];

  let defaultGroup = store.defaultAccessProfileId;
  if (!profiles[defaultGroup]) {
    defaultGroup = builtInAccessProfile.id;
    result.defaultGroup = defaultGroup;
  }
  const joining = accounts.filter(
    (account) => account.role === "user" && (account.pending || !profiles[account.accessProfileId]),
  );
  result.joined = joining.map(({ id, username }) => ({ id, username }));
  for (const [id, profile] of Object.entries(profiles)) {
    const features = isObject(profile?.features) ? profile.features : {};
    const removed = Object.keys(features).filter((name) => !accessFeatures.includes(name));
    if (removed.length)
      result.groups[id] = {
        removed,
        granted: retired.filter((name) => features[name] !== true),
      };
  }
  const changed =
    result.joined.length ||
    Object.keys(result.groups).length ||
    Object.hasOwn(store, "requireApproval") ||
    accounts.some((account) => Object.hasOwn(account, "pending"));
  // Without anything else to change, a missing default is left for Studio to fill on start.
  if (!changed) return { ...result, defaultGroup: "" };
  if (!apply) return result;

  const bytes = Buffer.from(text);
  const mappings = [
    {
      source: "accounts.json",
      target: "studio_documents/accounts",
      hash: crypto.createHash("sha256").update(bytes).digest("hex"),
    },
  ];
  result.backup = verifiedBackup(
    dataDir,
    "account-access",
    [{ source: mappings[0].source, hash: mappings[0].hash, bytes }],
    { mappings, defaultGroup: result.defaultGroup, joined: result.joined, groups: result.groups },
  );
  if (!profiles[defaultGroup]) profiles[defaultGroup] = structuredClone(builtInAccessProfile);
  for (const id of Object.keys(result.groups))
    profiles[id] = {
      ...profiles[id],
      features: normaliseAccessProfile(profiles[id]).features,
    };
  const { requireApproval: _requireApproval, ...rest } = store;
  const next = {
    ...rest,
    defaultAccessProfileId: defaultGroup,
    profiles,
    accounts: accounts.map(({ pending: _pending, ...account }) =>
      joining.some((item) => item.id === account.id)
        ? { ...account, accessProfileId: defaultGroup }
        : account,
    ),
  };
  writeRuntimeDocument(dataDir, "accounts", next);
  result.applied = true;
  return result;
}

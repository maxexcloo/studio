import fs from "node:fs";
import {
  readRuntimeDocument,
  usesRuntimeDatabase,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";
import crypto from "node:crypto";
import path from "node:path";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { scryptAsync } from "./kdf.js";
import {
  accountRoles,
  builtInAccessProfiles,
  effectiveAccountAccess,
  migrateCloudModels,
  migrateFeatureOptions,
  normaliseAccessProfile,
  predatesCloudModels,
  validAccountKey,
} from "./account-policy.js";
import { currentDataDir } from "./data-dir.js";

const dataDir = currentDataDir();

const storePath = path.join(dataDir, "accounts.json");
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const maxSessions = 500;
const kdf = "scrypt-n32768-r8-p1";
let cache;

const emptyStore = () => ({
  version: 1,
  accounts: [],
  profiles: {},
  sessions: [],
  gatewayLinks: [],
  gatewayPending: [],
});
const maxPendingGatewayIdentities = 100;
const validGatewayIdentity = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 256 &&
  !/[\x00-\x1f\x7f]/.test(value);
const tokenHash = (token) => crypto.createHash("sha256").update(String(token)).digest("base64url");
// Email addresses are valid usernames, so a verified sign-in can match them.
const validUsername = (value) =>
  /^[\p{L}\p{N}][\p{L}\p{N}._@+-]{1,127}$/u.test(String(value || "").trim());
const usernameKey = (value) =>
  String(value || "")
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("en-AU");

function readStore() {
  if (cache) return cache;
  try {
    const saved = usesRuntimeDatabase(dataDir)
      ? readRuntimeDocument(dataDir, "accounts")
      : readJsonFile(storePath);
    cache = {
      ...emptyStore(),
      ...saved,
      // An account is named by its email; a display name older stores kept is dropped on the next save.
      accounts: Array.isArray(saved?.accounts)
        ? saved.accounts.map(({ displayName: _displayName, ...account }) => account)
        : [],
      profiles:
        saved?.profiles && typeof saved.profiles === "object" && !Array.isArray(saved.profiles)
          ? saved.profiles
          : {},
      sessions: Array.isArray(saved?.sessions) ? saved.sessions : [],
      gatewayLinks: Array.isArray(saved?.gatewayLinks) ? saved.gatewayLinks : [],
      gatewayPending: Array.isArray(saved?.gatewayPending) ? saved.gatewayPending : [],
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    cache = emptyStore();
  }
  return cache;
}

function saveStore({ scrubBackup = false } = {}) {
  const store = readStore();
  const now = Date.now();
  store.sessions = store.sessions
    .filter((session) => Number(session.expiresAt) > now)
    .slice(-maxSessions);
  if (usesRuntimeDatabase(dataDir)) {
    writeRuntimeDocument(dataDir, "accounts", store);
    return;
  }
  writeJsonFile(storePath, store, { mode: 0o600 });
  if (scrubBackup) writeJsonFile(storePath, store, { mode: 0o600 });
  try {
    fs.chmodSync(storePath, 0o600);
  } catch {
    /* Windows keeps its own ACLs. */
  }
}

export function resetAccountStoreForTests() {
  cache = null;
}

export function accountStoreSnapshot() {
  const store = readStore();
  return {
    version: store.version,
    accounts: store.accounts.map(
      ({ id, username, role, accessProfileId, disabled, createdAt, identity, pending, oidc }) => ({
        id,
        username,
        role,
        accessProfileId,
        disabled,
        createdAt,
        identity,
        ...(pending ? { pending: true } : {}),
        ...(oidc ? { signInLinked: true } : {}),
      }),
    ),
    profiles: structuredClone(store.profiles),
    sessions: store.sessions.length,
  };
}

export function listAccounts() {
  return accountStoreSnapshot().accounts;
}

export function accountAccessForId(accountId) {
  const store = readStore();
  const account = store.accounts.find((item) => item.id === accountId);
  return account ? effectiveAccountAccess(account, store.profiles) : null;
}

/** Stored grants stay listed while discovery is degraded; the UI marks them unavailable. */
export function listAccessProfiles() {
  return Object.values(readStore().profiles).map((profile) => normaliseAccessProfile(profile));
}

/**
 * Settles Cloud Models on every stored access profile that predates it, from the cloud
 * profiles discovery found (see account-policy.js). Does nothing until a cloud profile is known.
 */
export function migrateCloudModelAccess(cloudProfiles = []) {
  const store = readStore();
  let changed = false;
  for (const [id, profile] of Object.entries(store.profiles)) {
    const next = migrateCloudModels(profile, cloudProfiles);
    if (next !== profile) {
      store.profiles[id] = next;
      changed = true;
    }
  }
  if (changed) saveStore();
  return changed;
}

/**
 * Adds the built-in Administrator and User access profiles where no profile has their ID.
 * An existing profile with that ID is never changed.
 */
export function ensureBuiltInAccessProfiles() {
  const store = readStore();
  const missing = builtInAccessProfiles.filter((profile) => !store.profiles[profile.id]);
  for (const profile of missing) store.profiles[profile.id] = structuredClone(profile);
  if (missing.length) saveStore();
  return missing.map((profile) => profile.id);
}

/**
 * Carries the retired global LoRAs and Cloud Models switches into every stored access
 * profile, once (see account-policy.js). Returns whether this run did it.
 */
export function migrateFeatureOptionAccess(globals = {}) {
  const store = readStore();
  if (store.featureOptionsMigrated) return false;
  for (const [id, profile] of Object.entries(store.profiles))
    store.profiles[id] = migrateFeatureOptions(profile, globals);
  store.featureOptionsMigrated = true;
  saveStore();
  return true;
}

/** The access profile new ordinary accounts start with, or "" when each one waits for an administrator. */
export function defaultAccessProfileId() {
  const store = readStore();
  const id = store.defaultAccessProfileId;
  return validAccountKey(id) && store.profiles[id] ? id : "";
}

/**
 * Whether new single sign-on and chat gateway accounts wait for an administrator even with a
 * default access profile. On unless an administrator turned it off, so an upgrade widens nothing.
 */
export function requireApproval() {
  return readStore().requireApproval !== false;
}

export function setRequireApproval(on) {
  if (typeof on !== "boolean") throw new Error("Choose on or off.");
  readStore().requireApproval = on;
  saveStore();
  return requireApproval();
}

/**
 * Chat Gateway Admin Tools: whether chat users linked through the trusted gateway to an
 * administrator account get MCP's admin tools (Library, catalogue, profiles). Off unless an
 * administrator turned it on; direct administrator MCP tokens have them either way.
 */
export function gatewayAdminTools() {
  return readStore().gatewayAdminTools === true;
}

export function setGatewayAdminTools(on) {
  if (typeof on !== "boolean") throw new Error("Choose on or off.");
  readStore().gatewayAdminTools = on;
  saveStore();
  return gatewayAdminTools();
}

/** The default access profile a new self-arriving account starts on now, or "" when it waits. */
const startingProfileId = () => (requireApproval() ? "" : defaultAccessProfileId());

export function setDefaultAccessProfile(profileId) {
  const store = readStore();
  if (profileId !== "" && (!validAccountKey(profileId) || !store.profiles[profileId]))
    throw new Error("Choose an existing group");
  if (profileId) store.defaultAccessProfileId = profileId;
  else delete store.defaultAccessProfileId;
  saveStore();
  return defaultAccessProfileId();
}

export function saveAccessProfile(input, availableProfiles = [], cloudProfiles = []) {
  migrateCloudModelAccess(cloudProfiles);
  // New grants must be currently available; keep existing grants if discovery is degraded.
  const stored = validAccountKey(input?.id) ? readStore().profiles[input.id] : null;
  const existing = stored?.generationProfiles || [];
  const cloud = new Set(cloudProfiles);
  // Cloud profiles follow Cloud Models, never a grant of their own.
  const profile = normaliseAccessProfile(
    {
      ...input,
      generationProfiles: Array.isArray(input?.generationProfiles)
        ? input.generationProfiles.filter((id) => !cloud.has(id))
        : [],
      retiredCloudGrants: stored?.retiredCloudGrants,
    },
    [...availableProfiles, ...existing].filter((id) => !cloud.has(id)),
  );
  if (!profile.id) throw new Error("Choose a valid profile ID.");
  if (!profile.name) throw new Error("Enter a name for this group");
  // A profile that could not be settled yet keeps its old cloud grants unless this save turns Cloud Models on.
  if (stored && predatesCloudModels(stored) && !profile.features.cloudModels)
    delete profile.features.cloudModels;
  readStore().profiles[profile.id] = profile;
  saveStore();
  return structuredClone(profile);
}

export function assignAccessProfile(accountId, profileId) {
  const store = readStore();
  const account = store.accounts.find(
    (item) => item.id === accountId && item.role === accountRoles.user,
  );
  if (!account) throw new Error("That ordinary user account was not found.");
  if (!validAccountKey(profileId) || !store.profiles[profileId])
    throw new Error("Choose an existing group");
  account.accessProfileId = profileId;
  // Assigning a profile is how an administrator approves a pending sign-in.
  delete account.pending;
  saveStore();
  return { id: account.id, accessProfileId: account.accessProfileId };
}

export async function createLocalAccount({
  username,
  password,
  role = accountRoles.user,
  accessProfileId = "",
  identity = null,
  onlyIfEmpty = false,
} = {}) {
  const key = usernameKey(username);
  // Without a choice, an ordinary account starts on the default access profile.
  if (role === accountRoles.user && !accessProfileId) accessProfileId = defaultAccessProfileId();
  if (!validUsername(username)) throw new Error("Use an email address of up to 128 characters.");
  // An ordinary account may start without a password and sign in through single sign-on only.
  const withPassword = Boolean(String(password || ""));
  if (!withPassword && role !== accountRoles.user) throw new Error("Enter a password.");
  if (![accountRoles.administrator, accountRoles.user].includes(role))
    throw new Error("Choose administrator or user.");
  if (
    role === accountRoles.user &&
    (!validAccountKey(accessProfileId) || !readStore().profiles[accessProfileId])
  )
    throw new Error("Assign this user to an existing group");
  if (readStore().accounts.some((account) => usernameKey(account.username) === key))
    throw new Error("An account with that email already exists.");

  const salt = crypto.randomBytes(16);
  const hash = withPassword ? await scryptAsync(password, salt) : null;
  const account = {
    id: crypto.randomBytes(18).toString("base64url"),
    username: String(username).trim().normalize("NFKC"),
    role,
    ...(role === accountRoles.user ? { accessProfileId } : {}),
    ...(identity ? { identity } : {}),
    disabled: false,
    ...(hash
      ? { password: { kdf, salt: salt.toString("base64url"), hash: hash.toString("base64url") } }
      : {}),
    createdAt: new Date().toISOString(),
  };
  // Recheck after the asynchronous KDF before inserting.
  const store = readStore();
  if (onlyIfEmpty && store.accounts.length)
    throw new Error("Recovery administrator setup is already complete.");
  if (store.accounts.some((item) => usernameKey(item.username) === key))
    throw new Error("An account with that email already exists.");
  store.accounts.push(account);
  saveStore();
  const { password: _secret, ...publicAccount } = account;
  return publicAccount;
}

export async function verifyLocalAccount(username, password) {
  const key = usernameKey(username);
  const account = readStore().accounts.find((item) => usernameKey(item.username) === key);
  const saved = account?.password;
  const salt = saved?.salt ? Buffer.from(saved.salt, "base64url") : crypto.randomBytes(16);
  const hash = await scryptAsync(password, salt);
  if (!saved || account.disabled || account.identity?.provider === "pocket-id") return null;
  const expected = Buffer.from(saved.hash, "base64url");
  if (expected.length !== hash.length || !crypto.timingSafeEqual(expected, hash)) return null;
  const access = effectiveAccountAccess(account, readStore().profiles);
  return access.authenticated ? access : null;
}

export function createAccountSession(accountId) {
  const store = readStore();
  const account = store.accounts.find((item) => item.id === accountId && item.disabled !== true);
  if (!account) throw new Error("That account is unavailable.");
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  store.sessions.push({
    tokenHash: tokenHash(token),
    accountId,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + sessionLifetimeMs,
  });
  saveStore();
  return { token, maxAge: Math.floor(sessionLifetimeMs / 1000) };
}

export function accountSession(token) {
  if (!token) return null;
  const session = readStore().sessions.find(
    (item) => item.tokenHash === tokenHash(token) && Number(item.expiresAt) > Date.now(),
  );
  if (!session) return null;
  const account = readStore().accounts.find(
    (item) => item.id === session.accountId && item.disabled !== true,
  );
  if (!account) return null;
  const access = effectiveAccountAccess(account, readStore().profiles);
  return access.authenticated ? access : null;
}

export function verifyAccountMcpToken(token) {
  if (typeof token !== "string" || token.length < 32) return null;
  const hash = tokenHash(token);
  const account = readStore().accounts.find(
    (item) => item.mcpTokenHash === hash && item.disabled !== true,
  );
  const access = account ? effectiveAccountAccess(account, readStore().profiles) : null;
  return access?.authenticated ? { ...access, credential: "mcp-token" } : null;
}

export function rotateAccountMcpToken(accountId) {
  const account = readStore().accounts.find(
    (item) => item.id === accountId && item.disabled !== true,
  );
  if (!account) throw new Error("That account is unavailable.");
  const token = crypto.randomBytes(32).toString("base64url");
  account.mcpTokenHash = tokenHash(token);
  account.mcpTokenCreatedAt = new Date().toISOString();
  saveStore();
  return { token, createdAt: account.mcpTokenCreatedAt };
}

export function revokeAccountMcpToken(accountId) {
  const account = readStore().accounts.find((item) => item.id === accountId);
  if (!account) throw new Error("That account was not found.");
  delete account.mcpTokenHash;
  delete account.mcpTokenCreatedAt;
  saveStore({ scrubBackup: true });
}

export function accountMcpTokenStatus(accountId) {
  const account = readStore().accounts.find((item) => item.id === accountId);
  return { enabled: Boolean(account?.mcpTokenHash), createdAt: account?.mcpTokenCreatedAt || "" };
}

export function revokeAccountSession(token) {
  if (!token) return false;
  const store = readStore();
  const previous = store.sessions.length;
  store.sessions = store.sessions.filter((item) => item.tokenHash !== tokenHash(token));
  if (store.sessions.length !== previous) saveStore({ scrubBackup: true });
  return store.sessions.length !== previous;
}

/** What an account may see and change about itself. Provider accounts have no password here. */
export function ownAccount(accountId) {
  const account = readStore().accounts.find(
    (item) => item.id === accountId && item.disabled !== true,
  );
  if (!account) return null;
  const provider = account.identity?.provider === "pocket-id";
  return {
    id: account.id,
    username: account.username,
    role: account.role,
    signInLinked: Boolean(account.oidc),
    provider: provider ? "pocket-id" : "local",
    canChangePassword: !provider && Boolean(account.password),
    canChangeEmail: !provider,
    accessProfile:
      account.role === accountRoles.user && account.accessProfileId
        ? {
            id: account.accessProfileId,
            name: readStore().profiles[account.accessProfileId]?.name || account.accessProfileId,
          }
        : null,
    createdAt: account.createdAt || "",
  };
}

async function passwordMatches(account, password) {
  const saved = account?.password;
  const salt = saved?.salt ? Buffer.from(saved.salt, "base64url") : crypto.randomBytes(16);
  const hash = await scryptAsync(String(password || ""), salt);
  if (!saved) return false;
  const expected = Buffer.from(saved.hash, "base64url");
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

export const wrongCurrentPassword = "Your current password is incorrect.";

/** Everything about a change to one's own account that can be checked without the current password. */
export function validateOwnAccountChange(accountId, { username, newPassword } = {}) {
  const found = readStore().accounts.find(
    (item) => item.id === accountId && item.disabled !== true,
  );
  if (!found) throw new Error("That account was not found.");
  const provider = found.identity?.provider === "pocket-id";
  const nextUsername = typeof username === "string" ? username.trim().normalize("NFKC") : undefined;
  const nextPassword = typeof newPassword === "string" && newPassword ? newPassword : undefined;
  const emailChanges =
    nextUsername !== undefined && usernameKey(nextUsername) !== usernameKey(found.username);
  const needsPassword = emailChanges || nextPassword !== undefined;
  if (needsPassword && provider)
    throw new Error(
      "This account signs in through single sign-on, so its email and password are managed there.",
    );
  if (
    emailChanges &&
    (!validUsername(nextUsername) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextUsername))
  )
    throw new Error("Enter an email address of up to 128 characters.");
  if (
    emailChanges &&
    readStore().accounts.some(
      (item) => item.id !== accountId && usernameKey(item.username) === usernameKey(nextUsername),
    )
  )
    throw new Error("An account with that email already exists.");
  if (nextPassword !== undefined && nextPassword.length < 8)
    throw new Error("Use a new password of at least 8 characters.");
  return { found, nextUsername, nextPassword, emailChanges, needsPassword };
}

/**
 * Changes an account's own email (its name and sign-in) or password.
 * The email and password need the current password; a new password ends every
 * other browser session but keeps the one making the change.
 */
export async function updateOwnAccount(accountId, changes = {}, { keepSessionToken = "" } = {}) {
  const { found, nextUsername, nextPassword, emailChanges, needsPassword } =
    validateOwnAccountChange(accountId, changes);
  if (needsPassword && !(await passwordMatches(found, changes.currentPassword)))
    throw new Error(wrongCurrentPassword);
  let hashed = null;
  if (nextPassword !== undefined) {
    const salt = crypto.randomBytes(16);
    hashed = {
      kdf,
      salt: salt.toString("base64url"),
      hash: (await scryptAsync(nextPassword, salt)).toString("base64url"),
    };
  }
  // Recheck after the asynchronous KDF.
  const store = readStore();
  const account = store.accounts.find((item) => item.id === accountId && item.disabled !== true);
  if (!account) throw new Error("That account was not found.");
  if (
    emailChanges &&
    store.accounts.some(
      (item) => item.id !== accountId && usernameKey(item.username) === usernameKey(nextUsername),
    )
  )
    throw new Error("An account with that email already exists.");
  if (emailChanges) account.username = nextUsername;
  if (hashed) {
    account.password = hashed;
    const keep = keepSessionToken ? tokenHash(keepSessionToken) : "";
    store.sessions = store.sessions.filter(
      (item) => item.accountId !== accountId || (keep && item.tokenHash === keep),
    );
  }
  saveStore({ scrubBackup: Boolean(hashed) });
  return ownAccount(accountId);
}

export function setAccountDisabled(accountId, disabled) {
  const account = readStore().accounts.find((item) => item.id === accountId);
  if (!account) throw new Error("That account was not found.");
  if (
    account.role === accountRoles.administrator &&
    disabled &&
    readStore().accounts.filter(
      (item) => item.role === accountRoles.administrator && item.disabled !== true,
    ).length < 2
  ) {
    throw new Error("Keep at least one enabled administrator account.");
  }
  account.disabled = Boolean(disabled);
  if (account.disabled)
    readStore().sessions = readStore().sessions.filter((item) => item.accountId !== accountId);
  saveStore({ scrubBackup: account.disabled });
  return { id: account.id, disabled: account.disabled };
}

/* -------------------------------------------- Trusted chat gateway identities */

/**
 * A trusted gateway (LiteLLM for LibreChat) authenticates with its shared key and
 * forwards its own user ID, and optionally the user's email. A link maps that ID
 * to an account: an administrator's, or one made here when the forwarded email is
 * an enabled account's username. Unlinked IDs are remembered so they can be
 * linked, and get nothing. A forwarded email no account has becomes a new account only
 * while a default access profile is set.
 */
export function gatewayAccountAccess(identity, email = "") {
  if (!validGatewayIdentity(identity)) return null;
  const store = readStore();
  const link = store.gatewayLinks.find((item) => item.identity === identity);
  if (!link) return linkGatewayEmail(store, identity, email);
  const account = store.accounts.find(
    (item) => item.id === link.accountId && item.disabled !== true,
  );
  const access = account ? effectiveAccountAccess(account, store.profiles) : null;
  return access?.authenticated ? { ...access, credential: "mcp-token" } : null;
}

// The gateway is trusted and its emails come from the shared identity provider, so a matching username is the same person.
// While a default access profile is set, an email no account has becomes a new account: on the
// default at once, or waiting for approval (linked already, so approval is all it needs).
function linkGatewayEmail(store, identity, email) {
  if (!validGatewayIdentity(email) || !email.includes("@")) return null;
  const key = usernameKey(email);
  let account = store.accounts.find((item) => usernameKey(item.username) === key);
  let created = false;
  if (!account && defaultAccessProfileId() && validUsername(email)) {
    account = {
      id: crypto.randomBytes(18).toString("base64url"),
      username: String(email).trim().normalize("NFKC"),
      role: accountRoles.user,
      ...(startingProfileId() ? { accessProfileId: startingProfileId() } : { pending: true }),
      identity: { provider: "gateway" },
      disabled: false,
      createdAt: new Date().toISOString(),
    };
    store.accounts.push(account);
    created = true;
  }
  if (account?.disabled) return null;
  const access = account ? effectiveAccountAccess(account, store.profiles) : null;
  if (!access?.authenticated) {
    if (created) {
      store.gatewayLinks.push({
        identity,
        accountId: account.id,
        linkedAt: new Date().toISOString(),
      });
      store.gatewayPending = store.gatewayPending.filter((item) => item.identity !== identity);
      saveStore();
    }
    return null;
  }
  store.gatewayLinks.push({ identity, accountId: account.id, linkedAt: new Date().toISOString() });
  store.gatewayPending = store.gatewayPending.filter((item) => item.identity !== identity);
  saveStore();
  return { ...access, credential: "mcp-token" };
}

export function noteGatewayIdentity(identity) {
  if (!validGatewayIdentity(identity)) return;
  const store = readStore();
  if (store.gatewayLinks.some((item) => item.identity === identity)) return;
  const now = new Date().toISOString();
  const pending = store.gatewayPending.find((item) => item.identity === identity);
  if (pending) {
    // At most one write a minute per identity: a chat retries often.
    if (Date.now() - Date.parse(pending.lastSeenAt || 0) < 60_000) return;
    pending.lastSeenAt = now;
  } else {
    store.gatewayPending.push({ identity, firstSeenAt: now, lastSeenAt: now });
    store.gatewayPending = store.gatewayPending.slice(-maxPendingGatewayIdentities);
  }
  saveStore();
}

export function listGatewayIdentities() {
  const store = readStore();
  return {
    links: store.gatewayLinks.map(({ identity, accountId, linkedAt }) => ({
      identity,
      accountId,
      linkedAt,
    })),
    pending: store.gatewayPending.map(({ identity, firstSeenAt, lastSeenAt }) => ({
      identity,
      firstSeenAt,
      lastSeenAt,
    })),
  };
}

/** Link (or, with no account, unlink) one gateway identity. Each identity maps to one account. */
export function setGatewayLink(identity, accountId) {
  if (!validGatewayIdentity(identity)) throw new Error("Choose a valid gateway user ID.");
  const store = readStore();
  store.gatewayLinks = store.gatewayLinks.filter((item) => item.identity !== identity);
  if (accountId) {
    if (!store.accounts.some((item) => item.id === accountId))
      throw new Error("That account was not found.");
    store.gatewayLinks.push({ identity, accountId, linkedAt: new Date().toISOString() });
    store.gatewayPending = store.gatewayPending.filter((item) => item.identity !== identity);
  }
  saveStore({ scrubBackup: !accountId });
  return listGatewayIdentities();
}

/** Forget one pending gateway identity. It reappears if the gateway sends it again. */
export function dismissGatewayIdentity(identity) {
  if (!validGatewayIdentity(identity)) throw new Error("Choose a valid gateway user ID.");
  const store = readStore();
  const pending = store.gatewayPending.filter((item) => item.identity !== identity);
  if (pending.length === store.gatewayPending.length)
    throw new Error("That chat user is not waiting.");
  store.gatewayPending = pending;
  saveStore({ scrubBackup: true });
  return listGatewayIdentities();
}

/* ------------------------------------------------------- OpenID Connect sign-in */

/**
 * A verified provider identity: its linked account, else the account whose
 * username is the identity's verified email, else a new pending account an
 * administrator approves by assigning an access profile. The provider never
 * decides roles or access.
 */
export function signInWithOidcIdentity({
  issuer,
  subject,
  email = "",
  emailVerified = false,
} = {}) {
  if (!issuer || !subject) throw new Error("The sign-in identity is incomplete.");
  const store = readStore();
  let account = store.accounts.find(
    (item) => item.oidc?.issuer === issuer && item.oidc?.subject === subject,
  );
  if (!account && emailVerified && email) {
    const key = usernameKey(email);
    const match = store.accounts.find((item) => usernameKey(item.username) === key);
    // Never an administrator: whoever controls a matching email at the provider would become one.
    if (match && !match.oidc && match.role !== accountRoles.administrator) {
      match.oidc = { issuer, subject, linkedAt: new Date().toISOString() };
      account = match;
      saveStore();
    }
  }
  if (!account) {
    const base =
      validUsername(email) && emailVerified
        ? email
        : `oidc-${crypto.createHash("sha256").update(`${issuer}|${subject}`).digest("hex").slice(0, 12)}`;
    let username = base;
    for (
      let suffix = 2;
      store.accounts.some((item) => usernameKey(item.username) === usernameKey(username));
      suffix += 1
    )
      username = `${base}-${suffix}`;
    account = {
      id: crypto.randomBytes(18).toString("base64url"),
      username,
      role: accountRoles.user,
      identity: { provider: "pocket-id" },
      oidc: { issuer, subject, linkedAt: new Date().toISOString() },
      // With a default access profile and approval off it starts on that; otherwise an administrator approves it.
      ...(startingProfileId() ? { accessProfileId: startingProfileId() } : { pending: true }),
      disabled: false,
      createdAt: new Date().toISOString(),
    };
    store.accounts.push(account);
    saveStore();
  }
  if (account.disabled) return { refused: true };
  const access = effectiveAccountAccess(account, store.profiles);
  return access.authenticated ? { access } : { pending: true };
}

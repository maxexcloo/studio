import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { root } from "./comfy.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { scryptAsync } from "./kdf.js";
import { accountRoles, effectiveAccountAccess, normaliseAccessProfile, validAccountKey } from "./account-policy.js";

const dataDir = path.resolve(process.env.HEISS_DATA_DIR || process.env.JAI_DATA_DIR || path.join(root, "data"));
const storePath = path.join(dataDir, "accounts.json");
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const maxSessions = 500;
const kdf = "scrypt-n32768-r8-p1";
let cache;

const emptyStore = () => ({ version: 1, accounts: [], profiles: {}, sessions: [] });
const tokenHash = (token) => crypto.createHash("sha256").update(String(token)).digest("base64url");
const usernameKey = (value) => String(value || "").trim().normalize("NFKC").toLocaleLowerCase("en-AU");

function readStore() {
  if (cache) return cache;
  try {
    const saved = readJsonFile(storePath);
    cache = {
      ...emptyStore(),
      ...saved,
      accounts: Array.isArray(saved?.accounts) ? saved.accounts : [],
      profiles: saved?.profiles && typeof saved.profiles === "object" && !Array.isArray(saved.profiles) ? saved.profiles : {},
      sessions: Array.isArray(saved?.sessions) ? saved.sessions : []
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
  store.sessions = store.sessions.filter((session) => Number(session.expiresAt) > now).slice(-maxSessions);
  writeJsonFile(storePath, store, { mode: 0o600 });
  if (scrubBackup) writeJsonFile(storePath, store, { mode: 0o600 });
  try { fs.chmodSync(storePath, 0o600); } catch { /* Windows keeps its own ACLs. */ }
}

export function resetAccountStoreForTests() {
  cache = null;
}

export function accountStoreSnapshot() {
  const store = readStore();
  return {
    version: store.version,
    accounts: store.accounts.map(({ id, username, displayName, role, accessProfileId, disabled, createdAt, identity }) => ({ id, username, displayName, role, accessProfileId, disabled, createdAt, identity })),
    profiles: structuredClone(store.profiles),
    sessions: store.sessions.length
  };
}

export function listAccounts() {
  return accountStoreSnapshot().accounts;
}

export function listAccessProfiles(availableProfiles = []) {
  return Object.values(readStore().profiles).map((profile) => normaliseAccessProfile(profile, availableProfiles));
}

export function saveAccessProfile(input, availableProfiles = []) {
  const profile = normaliseAccessProfile(input, availableProfiles);
  if (!profile.id) throw new Error("Choose a valid profile ID.");
  if (!profile.name) throw new Error("Enter a name for this access profile.");
  readStore().profiles[profile.id] = profile;
  saveStore();
  return structuredClone(profile);
}

export function assignAccessProfile(accountId, profileId) {
  const store = readStore();
  const account = store.accounts.find((item) => item.id === accountId && item.role === accountRoles.user);
  if (!account) throw new Error("That ordinary user account was not found.");
  if (!validAccountKey(profileId) || !store.profiles[profileId]) throw new Error("Choose an existing access profile.");
  account.accessProfileId = profileId;
  saveStore();
  return { id: account.id, accessProfileId: account.accessProfileId };
}

export async function createLocalAccount({ username, displayName = "", password, role = accountRoles.user, accessProfileId = "", identity = null } = {}) {
  const key = usernameKey(username);
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{1,63}$/u.test(String(username || "").trim())) throw new Error("Use a 2–64 character username containing letters, numbers, dots, underscores or hyphens.");
  if (String(password || "").length < 12) throw new Error("Use a password with at least 12 characters.");
  if (![accountRoles.administrator, accountRoles.user].includes(role)) throw new Error("Choose administrator or user.");
  if (role === accountRoles.user && (!validAccountKey(accessProfileId) || !readStore().profiles[accessProfileId])) throw new Error("Assign an existing access profile to this user.");
  if (readStore().accounts.some((account) => usernameKey(account.username) === key)) throw new Error("That username is already in use.");

  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(password, salt);
  const account = {
    id: crypto.randomBytes(18).toString("base64url"),
    username: String(username).trim().normalize("NFKC"),
    displayName: String(displayName || username).trim().slice(0, 80),
    role,
    ...(role === accountRoles.user ? { accessProfileId } : {}),
    ...(identity ? { identity } : {}),
    disabled: false,
    password: { kdf, salt: salt.toString("base64url"), hash: hash.toString("base64url") },
    createdAt: new Date().toISOString()
  };
  // Recheck after the asynchronous KDF before inserting.
  const store = readStore();
  if (store.accounts.some((item) => usernameKey(item.username) === key)) throw new Error("That username is already in use.");
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
  return effectiveAccountAccess(account, readStore().profiles);
}

export function createAccountSession(accountId) {
  const store = readStore();
  const account = store.accounts.find((item) => item.id === accountId && item.disabled !== true);
  if (!account) throw new Error("That account is unavailable.");
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  store.sessions.push({ tokenHash: tokenHash(token), accountId, createdAt: new Date(now).toISOString(), expiresAt: now + sessionLifetimeMs });
  saveStore();
  return { token, maxAge: Math.floor(sessionLifetimeMs / 1000) };
}

export function accountSession(token) {
  if (!token) return null;
  const session = readStore().sessions.find((item) => item.tokenHash === tokenHash(token) && Number(item.expiresAt) > Date.now());
  if (!session) return null;
  const account = readStore().accounts.find((item) => item.id === session.accountId && item.disabled !== true);
  if (!account) return null;
  const access = effectiveAccountAccess(account, readStore().profiles);
  return access.authenticated ? access : null;
}

export function verifyAccountMcpToken(token) {
  if (typeof token !== "string" || token.length < 32) return null;
  const hash = tokenHash(token);
  const account = readStore().accounts.find((item) => item.mcpTokenHash === hash && item.disabled !== true);
  return account ? effectiveAccountAccess(account, readStore().profiles) : null;
}

export function rotateAccountMcpToken(accountId) {
  const account = readStore().accounts.find((item) => item.id === accountId && item.disabled !== true);
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

export function setAccountDisabled(accountId, disabled) {
  const account = readStore().accounts.find((item) => item.id === accountId);
  if (!account) throw new Error("That account was not found.");
  if (account.role === accountRoles.administrator && disabled && readStore().accounts.filter((item) => item.role === accountRoles.administrator && item.disabled !== true).length < 2) {
    throw new Error("Keep at least one enabled administrator account.");
  }
  account.disabled = Boolean(disabled);
  if (account.disabled) readStore().sessions = readStore().sessions.filter((item) => item.accountId !== accountId);
  saveStore({ scrubBackup: account.disabled });
  return { id: account.id, disabled: account.disabled };
}

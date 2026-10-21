import { apiJson } from './api';

/** Account usernames are email addresses; older non-email usernames still sign in. */
export const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/** Email fields: no capitals, corrections or spelling marks from phone keyboards. */
export const emailFieldProps = { type: 'email', inputMode: 'email', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;

/** Ends this browser's account session and returns to the sign-in screen. */
export async function signOutAccount() {
  await apiJson('/api/accounts/sign-out', { method: 'POST' });
  window.location.reload();
}

/** /api/accounts/status, as the sign-in gate last saw it: Settings reads it at once instead of asking again. */
export type AccountStatus = { mode: 'single-user' | 'multi-user'; signedIn?: boolean; account?: { id: string; role: string } | null };
let knownStatus: AccountStatus | null = null;
export const rememberAccountStatus = (status: AccountStatus | null) => { knownStatus = status; };
export const knownAccountStatus = () => knownStatus;

/** The signed-in account (server/account-store.js `ownAccount`) and its MCP token, from /api/accounts/me. */
export type OwnAccount = {
  id: string; username: string; displayName: string; role: 'administrator' | 'user';
  signInLinked: boolean; provider: 'local' | 'pocket-id'; canChangePassword: boolean; canChangeEmail: boolean; createdAt: string;
  accessProfile?: { id: string; name: string } | null;
};
export type McpTokenStatus = { enabled: boolean; createdAt: string; endpoint: string };
export type Me = { account: OwnAccount; mcp: McpTokenStatus };
let meCache: Me | null = null;
let meLoading: Promise<Me> | null = null;
/** Settings › Account draws from this at once; a fresh copy follows each time it opens. */
export const cachedMe = () => meCache;
export function loadMe(fresh = false): Promise<Me> {
  if (meLoading && !fresh) return meLoading;
  const loading = apiJson<Me & { ok: boolean }>('/api/accounts/me', { cache: 'no-store' }).then((data) => {
    meCache = { account: data.account, mcp: data.mcp };
    return meCache;
  }).finally(() => { if (meLoading === loading) meLoading = null; });
  meLoading = loading;
  return loading;
}
export const updateCachedMe = (next: Partial<Me>) => { if (meCache) meCache = { ...meCache, ...next }; };

type Confirm =(options: { title: string; description: string; action: string; destructive?: boolean }) => Promise<boolean>;

/** Sign Out from a menu: asks first only while something is generating, which keeps running on the server. */
/**
 * Signs out at once (UI-PATTERNS › Messages: almost nothing asks first). Running
 * generations finish on the server and appear in the gallery on the next sign-in.
 * Callers still pass what's running and their confirmation; neither is needed now.
 */
export async function signOutChecked(_running: number, _confirm: Confirm) {
  await signOutAccount();
  return true;
}

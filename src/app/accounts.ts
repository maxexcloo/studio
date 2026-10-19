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

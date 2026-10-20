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

type Confirm = (options: { title: string; description: string; action: string; destructive?: boolean }) => Promise<boolean>;

/** Sign Out from a menu: asks first only while something is generating, which keeps running on the server. */
export async function signOutChecked(running: number, confirm: Confirm) {
  if (running > 0 && !await confirm({ title: 'Sign Out?', description: `${running === 1 ? 'A generation is' : `${running} generations are`} still running. ${running === 1 ? 'It finishes' : 'They finish'} on the server and ${running === 1 ? 'appears' : 'appear'} in your gallery when you sign back in.`, action: 'Sign Out' })) return false;
  await signOutAccount();
  return true;
}

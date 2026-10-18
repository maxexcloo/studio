import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { ApiError, apiJson, setAccountStorageScope, signedOutEvent } from './api';
import { setAtComputer, setThisComputer } from './device';
import { LockMark, type LockMarkStage } from './LockMark';
import { cn } from './format';

/** What /api/access/status says about this browser (server/access-routes.js). */
export type AccessStatus = {
  thisComputer: boolean;
  signedIn: boolean;
  canAdmin: boolean;
  studioPassword: { set: boolean; hidden: boolean };
};

type GateState =
  | { kind: 'checking' }
  | { kind: 'in' }
  | { kind: 'sign-in'; status: AccessStatus }
  | { kind: 'account-sign-in'; recovery: boolean }
  | { kind: 'account-pending' }
  | { kind: 'refused'; title: string; text: string };

/**
 * Other devices sign in before the studio loads: phones and other computers
 * see this screen until the studio password opens it. On the computer HEISS
 * UI runs on the studio starts at once and nothing here shows. When a
 * session ends (a week passed, or "Sign out all devices"), the next request
 * says so and this screen comes back.
 */
export function DeviceGate({ children }: React.PropsWithChildren) {
  const [state, setState] = useState<GateState>({ kind: 'checking' });

  const check = useCallback(async () => {
    try {
      const accountMode = await apiJson<{ ok: boolean; mode: 'single-user' | 'multi-user'; signedIn?: boolean; needsRecoveryAdmin?: boolean; account?: { id: string; role: string } | null }>('/api/accounts/status', { cache: 'no-store' });
      if (accountMode.mode === 'multi-user') {
        const signedIn = accountMode.signedIn === true;
        setAccountStorageScope(signedIn ? accountMode.account?.id : undefined);
        setThisComputer(signedIn && accountMode.account?.role === 'administrator');
        setAtComputer(false);
        setState(signedIn ? (accountMode.account?.role === 'administrator' ? { kind: 'in' } : { kind: 'account-pending' }) : { kind: 'account-sign-in', recovery: accountMode.needsRecoveryAdmin === true });
        return;
      }
      setAccountStorageScope();
      const status = await apiJson<AccessStatus & { ok: boolean }>('/api/access/status', { cache: 'no-store' });
      setThisComputer(status.canAdmin);
      setAtComputer(status.thisComputer);
      setState(status.signedIn ? { kind: 'in' } : { kind: 'sign-in', status });
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setState(error.reason === 'host'
          ? { kind: 'refused', title: 'Open HEISS UI by its address', text: error.message }
          : { kind: 'refused', title: 'Not open to other devices', text: 'On the computer running HEISS UI, turn on “Open on other devices” in Settings › Connection, then reload this page.' });
        return;
      }
      // Not reachable at all: the studio has its own offline screens.
      setState({ kind: 'in' });
    }
  }, []);

  useEffect(() => { check(); }, [check]);
  useEffect(() => {
    const again = () => { check(); };
    window.addEventListener(signedOutEvent, again);
    return () => window.removeEventListener(signedOutEvent, again);
  }, [check]);

  if (state.kind === 'in') return <>{children}</>;
  if (state.kind === 'checking') return <div className="device-gate" aria-busy="true" />;
  if (state.kind === 'refused') return <GateMessage title={state.title} text={state.text} />;
  if (state.kind === 'account-sign-in') return <AccountSignIn recovery={state.recovery} onSignedIn={() => { window.location.reload(); }} />;
  if (state.kind === 'account-pending') return <GateMessage title="Your private studio is being prepared" text="Your account is approved. HEISS UI will open your studio when private storage and ownership checks are ready." />;
  const { studioPassword } = state.status;
  if (!studioPassword.set && !studioPassword.hidden) {
    return <GateMessage title="Set a studio password" text="Other devices sign in with a studio password. Set one on the computer running HEISS UI in Settings › Connection, then reload this page." />;
  }
  return <SignIn legacy={studioPassword.hidden} onSignedIn={() => { window.location.reload(); }} />;
}

function AccountSignIn({ recovery, onSignedIn }: { recovery: boolean; onSignedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [stage, setStage] = useState<LockMarkStage>('locked');
  const [error, setError] = useState('');
  const working = stage === 'asking' || stage === 'opening';

  const submit = async () => {
    if (!username || !password || working) return;
    setStage('asking');
    setError('');
    try {
      await apiJson(recovery ? '/api/accounts/bootstrap' : '/api/accounts/sign-in', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, displayName, password })
      });
      setStage('opening');
      window.setTimeout(onSignedIn, 400);
    } catch (reason) {
      setStage('failed');
      setError(reason instanceof Error ? reason.message : 'Sign-in failed.');
    }
  };

  return (
    <section className={cn('device-gate hidden-lockscreen', `is-${stage}`)}>
      <div className="empty stage-empty hidden-lock-stage">
        <div className="stage-mark"><LockMark className="stage-layer" stage={stage} /></div>
        <div className="stage-copy">
          <h2>{recovery ? 'Create the recovery administrator' : 'Sign in to HEISS UI'}</h2>
          <p>{recovery ? 'Set up the first administrator on this computer.' : 'Use your approved HEISS account.'}</p>
          <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <label>Username<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} disabled={working} /></label>
            {recovery && <label>Display name<input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={working} /></label>}
            <label>Password<input type="password" autoComplete={recovery ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} disabled={working} /></label>
            {error && <p role="alert">{error}</p>}
            <button className="reconnect-btn primary" type="submit" disabled={!username || !password || working}>{working ? 'Please wait…' : recovery ? 'Create administrator' : 'Sign in'}</button>
          </form>
        </div>
      </div>
    </section>
  );
}

function GateMessage({ title, text }: { title: string; text: string }) {
  return (
    <section className="device-gate hidden-lockscreen">
      <div className="empty stage-empty hidden-lock-stage">
        <div className="stage-mark"><LockMark className="stage-layer" stage="locked" /></div>
        <div className="stage-copy">
          <h2>{title}</h2>
          <p>{text}</p>
          <div className="empty-actions">
            <button className="reconnect-btn primary" onClick={() => window.location.reload()}><RefreshCw size={13} /> Reload</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SignIn({ legacy, onSignedIn }: { legacy: boolean; onSignedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [stage, setStage] = useState<LockMarkStage>('locked');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const working = stage === 'asking' || stage === 'opening';

  useEffect(() => { window.setTimeout(() => inputRef.current?.focus(), 80); }, []);

  const submit = async () => {
    if (!password || working) return;
    setStage('asking');
    setError('');
    try {
      await apiJson('/api/access/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
      setStage('opening');
      // The lock gets its moment before the studio comes in.
      window.setTimeout(onSignedIn, 600);
    } catch (reason) {
      setStage('failed');
      setError(reason instanceof Error ? reason.message : 'That password is incorrect.');
      setPassword('');
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  return (
    <section className={cn('device-gate hidden-lockscreen', `is-${stage}`)}>
      <div className="empty stage-empty hidden-lock-stage">
        <div className="stage-mark"><LockMark className="stage-layer" stage={stage} /></div>
        <div className="stage-copy">
          <h2>{stage === 'opening' ? 'Signed in' : 'Sign in to HEISS UI'}</h2>
          <p>{legacy
            ? 'Enter the studio password. Until one is set, it’s the Hidden password.'
            : 'Enter the studio password set on the computer running HEISS UI.'}</p>
          <div className="empty-actions">
            {stage !== 'opening' ? (
              <div className="hidden-unlock">
                <form className={cn('hidden-unlock-field', stage === 'failed' && 'is-wrong')} onSubmit={(event) => { event.preventDefault(); submit(); }}>
                  <KeyRound size={14} aria-hidden="true" />
                  {/* A name for password managers, so they file the password under this studio. */}
                  <input type="text" name="username" autoComplete="username" value="HEISS UI" readOnly hidden />
                  <input
                    ref={inputRef}
                    className="is-framed"
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    aria-label="Studio password"
                    placeholder="Studio password"
                    value={password}
                    disabled={working}
                    onChange={(event) => { setPassword(event.target.value); if (stage === 'failed') setStage('locked'); }}
                  />
                  <button type="submit" disabled={!password || working}>{working ? '…' : 'Sign in'}</button>
                </form>
                <div className="hidden-unlock-meta" aria-live="polite">
                  {error ? <span className="is-error">{error}</span> : null}
                </div>
              </div>
            ) : <div className="hidden-unlock-spacer" />}
          </div>
        </div>
      </div>
    </section>
  );
}

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { emailFieldProps, looksLikeEmail } from './accounts';
import { ApiError, apiJson, setAccountStorageScope, signedOutEvent } from './api';
import { setAtComputer, setThisComputer } from './device';
import { LockMark, type LockMarkStage } from './LockMark';
import { cn } from './format';

/** What /api/access/status says about this browser (server/access-routes.js). */
export type AccessStatus = {
  thisComputer: boolean;
  signedIn: boolean;
  canAdmin: boolean;
  studioPassword: { set: boolean };
};

type GateState =
  | { kind: 'checking' }
  | { kind: 'in' }
  | { kind: 'sign-in'; status: AccessStatus }
  | { kind: 'account-sign-in'; recovery: boolean; setupToken: boolean; oidcLabel: string }
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
      const accountMode = await apiJson<{ ok: boolean; mode: 'single-user' | 'multi-user'; signedIn?: boolean; needsRecoveryAdmin?: boolean; setupTokenAccepted?: boolean; oidc?: { label: string }; account?: { id: string; role: string } | null }>('/api/accounts/status', { cache: 'no-store' });
      if (accountMode.mode === 'multi-user') {
        const signedIn = accountMode.signedIn === true;
        setAccountStorageScope(signedIn ? accountMode.account?.id : undefined);
        setThisComputer(signedIn && accountMode.account?.role === 'administrator');
        setAtComputer(false);
        setState(signedIn ? { kind: 'in' } : { kind: 'account-sign-in', recovery: accountMode.needsRecoveryAdmin === true, setupToken: accountMode.setupTokenAccepted === true, oidcLabel: accountMode.oidc?.label || '' });
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
          ? { kind: 'refused', title: 'Open Studio by its address', text: error.message }
          : { kind: 'refused', title: 'Not open to other devices', text: 'On the computer running Studio, turn on “Open on other devices” in Settings › Connection, then reload this page.' });
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
  if (state.kind === 'account-sign-in') return <AccountSignIn recovery={state.recovery} setupToken={state.setupToken} oidcLabel={state.oidcLabel} onSignedIn={() => { window.location.reload(); }} />;
  const { studioPassword } = state.status;
  if (!studioPassword.set) {
    return <GateMessage title="Set a studio password" text="Other devices sign in with a studio password. Set one on the computer running Studio in Settings › Connection, then reload this page." />;
  }
  return <SignIn onSignedIn={() => { window.location.reload(); }} />;
}

/** What a single sign-on redirect came back with (server/multi-user-auth.js). */
const signInOutcomes: Record<string, string> = {
  pending: 'Your sign-in worked. An administrator needs to approve this account before it can open the studio.',
  refused: 'This account is disabled. Ask an administrator.',
  failed: 'Single sign-on did not complete. Try again.',
  unavailable: 'Single sign-on is unavailable right now. Try again shortly.'
};

function AccountSignIn({ recovery, setupToken, oidcLabel, onSignedIn }: { recovery: boolean; setupToken: boolean; oidcLabel: string; onSignedIn: () => void }) {
  const [outcome] = useState(() => {
    const value = new URLSearchParams(window.location.search).get('sign-in') || '';
    if (value) window.history.replaceState(null, '', window.location.pathname);
    return signInOutcomes[value] || '';
  });
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [stage, setStage] = useState<LockMarkStage>('locked');
  const [error, setError] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);
  const working = stage === 'asking' || stage === 'opening';
  // Existing accounts may predate email usernames; only new ones must be emails.
  const ready = Boolean(email.trim() && password) && (!recovery || looksLikeEmail(email));
  const notice = error || outcome;

  useEffect(() => { window.setTimeout(() => emailRef.current?.focus(), 80); }, []);

  const submit = async () => {
    if (!ready || working) return;
    setStage('asking');
    setError('');
    try {
      await apiJson(recovery ? '/api/accounts/bootstrap' : '/api/accounts/sign-in', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: email.trim(), displayName, password, ...(recovery && token ? { setupToken: token } : {}) })
      });
      setStage('opening');
      window.setTimeout(onSignedIn, 400);
    } catch (reason) {
      setStage('failed');
      setError(reason instanceof Error ? reason.message : 'Sign-in failed.');
    }
  };
  const edit = (set: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    set(event.target.value);
    if (stage === 'failed') setStage('locked');
  };

  return (
    <section className={cn('device-gate account-gate', `is-${stage}`)}>
      <div className="account-gate-column">
        <div className="account-gate-mark" aria-hidden="true"><LockMark className="stage-layer" stage={stage} /></div>
        <div className="modal modal-alert account-gate-card" role="region" aria-labelledby="account-gate-title">
          <div className="modal-head">
            <div className="modal-titles">
              <h2 id="account-gate-title">{recovery ? 'Create the First Administrator' : 'Sign In to Studio'}</h2>
              <p>{recovery
                ? (setupToken ? 'Use the setup token from the deployment, or set this up on the computer running Studio.' : 'Set up the first administrator on this computer.')
                : 'Use the email and password for your approved account.'}</p>
            </div>
          </div>
          <form className="modal-body account-gate-form" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <label className="account-gate-field">
              <span>Email</span>
              <input ref={emailRef} className="modal-input" name="email" autoComplete="username" placeholder="you@example.com" {...emailFieldProps} value={email} onChange={edit(setEmail)} disabled={working} />
            </label>
            {recovery && setupToken ? <label className="account-gate-field"><span>Setup Token</span><input className="modal-input" type="password" autoComplete="off" value={token} onChange={edit(setToken)} disabled={working} /></label> : null}
            {recovery ? <label className="account-gate-field"><span>Display Name</span><input className="modal-input" autoComplete="name" value={displayName} onChange={edit(setDisplayName)} disabled={working} /></label> : null}
            <label className="account-gate-field">
              <span>Password</span>
              <input className="modal-input" type="password" name="password" autoComplete={recovery ? 'new-password' : 'current-password'} value={password} onChange={edit(setPassword)} disabled={working} />
            </label>
            {recovery && email.trim() && !looksLikeEmail(email) ? <p className="account-gate-hint">Enter an email address, such as you@example.com.</p> : null}
            {notice ? <p className="account-gate-error" role="alert">{notice}</p> : null}
            <button className="btn is-primary account-gate-submit" type="submit" disabled={!ready || working}>{working ? 'Please Wait…' : recovery ? 'Create Administrator' : 'Sign In'}</button>
          </form>
          {!recovery && oidcLabel ? <div className="modal-foot account-gate-alt">
            <span className="account-gate-or">or</span>
            <a className="btn" href="/api/accounts/oidc/start"><KeyRound size={14} aria-hidden="true" /> Sign In with {oidcLabel}</a>
          </div> : <div className="account-gate-end" />}
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

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
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
          <h2>{stage === 'opening' ? 'Signed in' : 'Sign in to Studio'}</h2>
          <p>Enter the studio password set on the computer running Studio.</p>
          <div className="empty-actions">
            {stage !== 'opening' ? (
              <div className="hidden-unlock">
                <form className={cn('hidden-unlock-field', stage === 'failed' && 'is-wrong')} onSubmit={(event) => { event.preventDefault(); submit(); }}>
                  <KeyRound size={14} aria-hidden="true" />
                  {/* A name for password managers, so they file the password under this studio. */}
                  <input type="text" name="username" autoComplete="username" value="Studio" readOnly hidden />
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

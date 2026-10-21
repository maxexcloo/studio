import { useSyncExternalStore } from 'react';
import { apiJson } from './api';

/**
 * Who may do what in this browser: one model for the whole app, matching the
 * server's `canAdmin` (server/access.js) and account policy
 * (server/account-policy.js).
 *
 *   Account mode   the signed-in account's role and its group's features, from
 *                  /api/accounts/status. Administrators administer Studio and
 *                  have every feature; users never administer, wherever they
 *                  open Studio. The device plays no part.
 *   Single-user    no accounts: administration follows the device. The
 *                  computer Studio runs on, or a signed-in device its owner
 *                  trusts with it (/api/access/status `canAdmin`, then
 *                  /api/health `thisComputer`). Every feature is on.
 *
 * Until the first answer the device's address stands in: loopback may
 * administer. The server refuses whatever this gets wrong; the app only hides.
 */

/** A group's features (server/account-policy.js `accessFeatures`). */
export type AccessFeature = 'loras' | 'imageGeneration' | 'videoGeneration' | 'imageReferences' | 'videoReferences' | 'gallery' | 'promptHistory' | 'cloudModels' | 'nsfwModels' | 'presets' | 'promptAssistant';

/** /api/accounts/status (server/multi-user-auth.js `publicStatus`). */
export type AccountStatus = {
  mode: 'single-user' | 'multi-user';
  signedIn?: boolean;
  needsRecoveryAdmin?: boolean;
  setupTokenAccepted?: boolean;
  oidc?: { label: string };
  account?: { id: string; role: string; features?: Partial<Record<AccessFeature, boolean>> } | null;
};

export type Access = {
  /** Account mode: the deployment has accounts (STUDIO_MULTI_USER=1). */
  accounts: boolean;
  /** Account mode and signed in. */
  signedIn: boolean;
  role: 'administrator' | 'user' | null;
  /** May look after Studio: Settings' administration sections, the Library, model folders and downloads, installs, restarts, workflow files. */
  administrator: boolean;
  /** Whether a group feature is on: always in single-user mode and for administrators. */
  may: (feature: AccessFeature) => boolean;
};

const onLoopback = typeof window === 'undefined' ? true : new Set(['localhost', '127.0.0.1', '::1', '[::1]']).has(window.location.hostname);

let status: AccountStatus | null = null;
let statusAt = 0;
let loading: Promise<AccountStatus> | null = null;
let deviceAdmin = onLoopback;
let snapshot: Access = derive();
const listeners = new Set<() => void>();

function derive(): Access {
  const accounts = status?.mode === 'multi-user';
  const signedIn = accounts && status?.signedIn === true;
  const role = signedIn ? (status?.account?.role === 'administrator' ? 'administrator' : 'user') : null;
  const administrator = accounts ? role === 'administrator' : deviceAdmin;
  const features = status?.account?.features || {};
  return { accounts, signedIn, role, administrator, may: (feature) => !accounts || role === 'administrator' || (signedIn && features[feature] === true) };
}

const keyOf = () => JSON.stringify([status?.mode, status?.signedIn, status?.account?.role, status?.account?.features, deviceAdmin]);
let snapshotKey = keyOf();

/** A new snapshot only when something it reads changed, so a repeat answer re-renders nothing. */
function publish() {
  const key = keyOf();
  if (key === snapshotKey) return;
  snapshotKey = key;
  snapshot = derive();
  listeners.forEach((listener) => listener());
}

/** The account status as last answered, for the sign-in gate and Settings. */
export const knownAccountStatus = () => status;

export function setAccountStatus(next: AccountStatus | null) {
  status = next;
  statusAt = next ? Date.now() : 0;
  publish();
}

/**
 * /api/accounts/status, shared: a request in flight is joined, and an answer
 * younger than `maxAge` is reused. The sign-in gate asks fresh; Settings asks
 * with a minute's grace each time it opens, so a role changed elsewhere still
 * shows without a fetch per open.
 */
export function loadAccountStatus({ maxAge = 0 }: { maxAge?: number } = {}): Promise<AccountStatus> {
  if (status && maxAge && Date.now() - statusAt < maxAge) return Promise.resolve(status);
  if (loading) return loading;
  const request = apiJson<AccountStatus & { ok: boolean }>('/api/accounts/status', { cache: 'no-store' })
    .then((answer) => { setAccountStatus(answer); return answer; })
    .finally(() => { if (loading === request) loading = null; });
  loading = request;
  return request;
}

/** Single-user mode's answer from the server (/api/access/status `canAdmin`, /api/health `thisComputer`); account mode ignores it. */
export function setDeviceAdmin(value: boolean) {
  if (value === deviceAdmin) return;
  deviceAdmin = value;
  publish();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const read = () => snapshot;

export function useAccess() {
  return useSyncExternalStore(subscribe, read, read);
}

/** May look after Studio (see `Access.administrator`). */
export function useAdministrator() {
  return useAccess().administrator;
}

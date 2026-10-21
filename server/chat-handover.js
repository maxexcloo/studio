// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Chat handover (design §6, How chat informs Studio): a result handed to LibreChat, the
 * deployment's chat (STUDIO_CHAT_URL), by its stable job ID, the Handover summary's way of naming
 * results. Details' Refine in Chat, its only caller, is gone; the routes stay for the MCP side.
 *
 * Studio's own jobs aren't MCP's, so the handover is recorded here, on disk: when that account's
 * chat names the job, MCP takes it into the account's chat jobs (mcp.js claimHandover) and Review,
 * Reuse and Result work on it. Only the account that owns the result can hand it over.
 *
 *   GET  /api/chat              {url}: the chat's address, or '' when none is set
 *   POST /api/chat/handover     {jobId}: records the handover for the signed-in account
 */
import path from 'node:path';
import { readJsonFile, writeJsonFile } from './json-store.js';

const handoverLimit = 2000;
const handoverMs = 30 * 24 * 60 * 60 * 1000;
const jobPattern = /^[\w-]{1,200}$/;

/** The chat's base address from STUDIO_CHAT_URL, or '' (unset or not a plain HTTP(S) address). */
export function chatUrl(environment = process.env) {
  const value = String(environment.STUDIO_CHAT_URL || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
    return url.href.replace(/\/+$/, '');
  } catch { return ''; }
}

/** Handovers by job id, kept 30 days (the newest 2000), in `<data>/chat-handovers.json`. */
export function createHandoverStore({ dataDir, now = Date.now } = {}) {
  const file = path.join(dataDir, 'chat-handovers.json');
  let state = null;
  const load = () => {
    if (state) return state;
    try { state = readJsonFile(file); } catch { state = null; }
    if (!state || state.version !== 1 || !state.jobs || typeof state.jobs !== 'object' || Array.isArray(state.jobs)) state = { version: 1, jobs: {} };
    return state;
  };
  const fresh = (entry) => entry && now() - Date.parse(entry.at) < handoverMs;
  return {
    record(jobId, ownerId = '') {
      if (!jobPattern.test(String(jobId || ''))) throw new Error('Choose a result.');
      const current = load();
      delete current.jobs[jobId];
      current.jobs[jobId] = { ownerId: String(ownerId || ''), at: new Date(now()).toISOString() };
      const ids = Object.keys(current.jobs).filter((id) => fresh(current.jobs[id]));
      current.jobs = Object.fromEntries(ids.slice(-handoverLimit).map((id) => [id, current.jobs[id]]));
      writeJsonFile(file, current, { mode: 0o600 });
      return current.jobs[jobId];
    },
    /**
     * Whether MCP's `owner` may take the job: in account mode the account that handed it over (MCP's
     * owner is the account id); in single-user mode any chat of this studio.
     */
    claim(owner, jobId, { accountMode = false } = {}) {
      const entry = load().jobs[String(jobId || '')];
      if (!fresh(entry)) return false;
      return accountMode ? Boolean(owner) && entry.ownerId === owner : !entry.ownerId;
    }
  };
}

/**
 * `store` is createHandoverStore's; `owned(req, jobId)` whether the request's account owns that
 * result; `ownerId(req)` its account id ('' in single-user mode).
 */
export function registerChatRoutes(app, { store, owned, ownerId, environment = process.env }) {
  app.get('/api/chat', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, url: chatUrl(environment) });
  });
  app.post('/api/chat/handover', (req, res) => {
    const jobId = String(req.body?.jobId || '');
    if (!jobPattern.test(jobId) || !owned(req, jobId)) { res.status(404).json({ ok: false, error: 'That result is unavailable.' }); return; }
    try {
      store.record(jobId, ownerId(req));
      res.json({ ok: true, jobId });
    } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  });
}

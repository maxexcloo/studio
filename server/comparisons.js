import crypto from 'node:crypto';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from './json-store.js';
import { ownerIdForRequest, recordsForRequest } from './account-ownership.js';
import { mayUseFeature } from './account-policy.js';

/** Store references only; every read resolves them against the caller's current gallery. */
export function registerComparisonRoutes(app, { dataDir, gallery }) {
  const file = path.join(dataDir, 'comparisons.json');
  const read = () => { try { return readJsonFile(file); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
  const allowed = (req, res) => {
    if (!req.heissAccount || mayUseFeature(req.heissAccount, 'gallery')) return true;
    res.status(403).json({ error: 'Gallery access is disabled for this account.' }); return false;
  };
  const visible = req => recordsForRequest(gallery(), req).filter(item => item.type === 'image' && item.status !== 'canceled');
  const show = (record, req) => {
    const items = visible(req);
    return { id: record.id, createdAt: record.createdAt, seed: record.seed, vote: items.some(item => item.jobId === record.vote && item.status === 'done') ? record.vote : null, variants: record.jobIds.map(jobId => ({ jobId, item: items.find(item => item.jobId === jobId) || null })) };
  };
  app.get('/api/comparisons', (req, res) => {
    if (!allowed(req, res)) return;
    res.json({ comparisons: read().filter(record => record.ownerId === ownerIdForRequest(req)).map(record => show(record, req)) });
  });
  app.post('/api/comparisons', (req, res) => {
    if (!allowed(req, res)) return;
    const jobIds = req.body?.jobIds;
    if (!Array.isArray(jobIds) || jobIds.length < 2 || jobIds.length > 4 || new Set(jobIds).size !== jobIds.length || jobIds.some(id => typeof id !== 'string')) return res.status(400).json({ error: 'Choose 2–4 different image jobs.' });
    const items = visible(req);
    const variants = jobIds.map(jobId => items.find(item => item.jobId === jobId));
    if (variants.some(item => !item)) return res.status(404).json({ error: 'A comparison image is unavailable.' });
    const seeds = variants.map(item => String(item.settings?.seed ?? ''));
    if (!seeds.every(seed => /^\d+$/.test(seed) && seed === seeds[0])) return res.status(400).json({ error: 'Comparison variants must use the same recorded seed.' });
    const ownerId = ownerIdForRequest(req);
    const record = { id: crypto.randomUUID(), ownerId, createdAt: new Date().toISOString(), seed: seeds[0], jobIds, vote: null };
    const records = read();
    writeJsonFile(file, [record, ...records.filter(item => item.ownerId === ownerId).slice(0, 99), ...records.filter(item => item.ownerId !== ownerId)]);
    res.status(201).json(show(record, req));
  });
  app.put('/api/comparisons/:id/vote', (req, res) => {
    if (!allowed(req, res)) return;
    const records = read();
    const record = records.find(item => item.id === req.params.id && item.ownerId === ownerIdForRequest(req));
    if (!record) return res.status(404).json({ error: 'That comparison is unavailable.' });
    const vote = req.body?.jobId;
    if (vote !== null && (!record.jobIds.includes(vote) || !visible(req).some(item => item.jobId === vote && item.status === 'done'))) return res.status(400).json({ error: 'Choose a finished, available variant.' });
    record.vote = vote; writeJsonFile(file, records); res.json(show(record, req));
  });
}

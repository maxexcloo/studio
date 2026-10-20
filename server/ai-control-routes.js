import { ControlError, controlConfigured, createControlClient } from './ai-control.js';

/*
 * Settings › Workers › AI Control: what each GPU runs, and, for
 * administrators, a manual change of it. Studio proxies a few AI Control
 * routes with its own key (ai-control.js) and passes on only the fields the
 * page needs; it never forwards a browser's body, cookies or headers as they
 * came. Nothing here switches a GPU on its own: every change is a preview an
 * administrator reviewed and applied.
 */

const devicePattern = /^\d{1,2}$/;
const namePattern = /^[\w.:-]{1,80}$/;
const jobPattern = /^[a-zA-Z0-9]{1,64}$/;
const numberOrNull = (value) => (Number.isFinite(value) ? value : null);
const text = (value, limit = 160) => (typeof value === 'string' ? value.slice(0, limit) : '');

/** The workloads and where each may run, labelled as AI Control's own page labels them. */
export function catalogueView(catalogue) {
  const workloads = catalogue?.rules?.workloads || {};
  const models = Object.fromEntries((catalogue?.models || []).map((model) => [model.id, model.label]));
  return {
    workloads: Object.entries(workloads).map(([profile, item]) => ({
      profile,
      label: text(item.runtime === 'text' ? String(models[profile] || item.model_label || profile).replace(' · 2 GPUs', '') : item.label || profile),
      runtime: text(item.runtime, 40),
      kind: text(item.kind, 20),
      placements: (catalogue.rules.profiles?.[profile] || item.placements || []).filter((value) => typeof value === 'string')
    })).sort((a, b) => a.label.localeCompare(b.label)),
    runtimeNames: Object.fromEntries(Object.entries(catalogue?.rules?.runtime_names || {}).map(([name, label]) => [name, text(label)]))
  };
}

/** A job's progress, without its command output. */
export function jobView(job) {
  if (!job || typeof job !== 'object') return null;
  const allocation = Array.isArray(job.allocation) ? job.allocation.map((item) => ({ profile: text(item?.profile, 80), devices: (item?.devices || []).map(String) })) : undefined;
  const restart = job.restart ? { runtime: text(job.restart.runtime, 40), profile: text(job.restart.profile, 80), devices: (job.restart.devices || []).map(String) } : undefined;
  return {
    id: text(job.id, 64), state: text(job.state, 20), stage: text(job.stage, 120),
    startedAt: numberOrNull(job.started_at), finishedAt: numberOrNull(job.finished_at),
    ...(allocation ? { allocation } : {}), ...(restart ? { restart } : {})
  };
}

/** Each GPU and runtime as AI Control reports it; host metrics and logs stay behind. */
export function statusView(status) {
  const metrics = status?.gpu_metrics && typeof status.gpu_metrics === 'object' ? status.gpu_metrics : {};
  const runtimes = Object.fromEntries(Object.entries(status?.runtimes || {}).map(([name, item]) => [name, {
    running: item?.running === true, profile: text(item?.profile, 80), devices: Array.isArray(item?.devices) ? item.devices.map(String) : [], health: text(item?.health, 40)
  }]));
  const devices = [...new Set([...Object.keys(metrics), '0', '1'].filter((device) => devicePattern.test(device)))].sort();
  return {
    updated: text(status?.updated, 40),
    gpus: devices.map((device) => {
      const item = metrics[device] || {};
      return { device, name: text(item.name, 80), availability: text(status?.[`gpu${device}`], 120), busyPercent: numberOrNull(item.busy_percent), vramUsedBytes: numberOrNull(item.vram_used_bytes), vramTotalBytes: numberOrNull(item.vram_total_bytes), temperature: numberOrNull(item.temperature_celsius) };
    }),
    runtimes,
    job: jobView(status?.job)
  };
}

/** A board of at most two workloads, each a known-looking profile on named GPUs; AI Control checks the rest. */
function allocationFrom(value) {
  if (!Array.isArray(value) || value.length > 2) throw new ControlError('Choose up to two workloads.', 400);
  return value.map((item) => {
    if (!item || typeof item.profile !== 'string' || !namePattern.test(item.profile) || !Array.isArray(item.devices) || !item.devices.length || item.devices.length > 2 || !item.devices.every((device) => typeof device === 'string' && devicePattern.test(device))) throw new ControlError('Choose a workload and its GPUs.', 400);
    return { profile: item.profile, devices: [...item.devices] };
  });
}

export function registerAiControlRoutes(app, { environment = process.env, fetchImpl = fetch, isAdmin = () => false, catalogueMs = 60_000 } = {}) {
  const control = createControlClient(environment, fetchImpl);
  let catalogue = null;
  let catalogueAt = 0;
  const loadCatalogue = async () => {
    if (!catalogue || Date.now() - catalogueAt > catalogueMs) {
      catalogue = catalogueView(await control('GET', 'catalogue'));
      catalogueAt = Date.now();
    }
    return catalogue;
  };
  const route = (handler, { admin = false } = {}) => async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (admin && !isAdmin(req)) { res.status(403).json({ ok: false, error: 'Only administrators can change what the GPUs run.' }); return; }
    if (!controlConfigured(environment)) { res.status(admin ? 503 : 200).json({ ok: !admin, configured: false, ...(admin ? { error: 'AI Control isn’t connected.' } : {}) }); return; }
    try { await handler(req, res); }
    catch (error) {
      const status = error instanceof ControlError ? error.status : 500;
      res.status(status).json({ ok: false, configured: true, error: error instanceof ControlError ? error.message : 'AI Control couldn’t do that right now.' });
    }
  };

  // Whether Studio knows AI Control at all; asks nothing of it, so Settings can decide what to show at once.
  app.get('/api/ai-control', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, configured: controlConfigured(environment), admin: Boolean(isAdmin(req)) });
  });
  app.get('/api/ai-control/status', route(async (req, res) => {
    const [status, workloads] = await Promise.all([control('GET', 'status'), loadCatalogue()]);
    res.json({ ok: true, configured: true, admin: Boolean(isAdmin(req)), status: statusView(status), catalogue: workloads });
  }));
  app.post('/api/ai-control/plan', route(async (req, res) => {
    const plan = await control('POST', 'board/plan', { allocation: allocationFrom(req.body?.allocation) });
    res.json({ ok: true, plan: {
      keep: (plan.keep || []).map(String), stop: (plan.stop || []).map(String),
      start: (plan.start || []).map((item) => ({ profile: text(item?.profile, 80), runtime: text(item?.runtime, 40), devices: (item?.devices || []).map(String) })),
      signature: text(plan.signature, 128)
    } });
  }, { admin: true }));
  app.post('/api/ai-control/apply', route(async (req, res) => {
    const signature = req.body?.signature;
    if (typeof signature !== 'string' || !/^[a-f0-9]{16,128}$/.test(signature)) throw new ControlError('Preview the change before applying it.', 400);
    const job = await control('POST', 'board', { allocation: allocationFrom(req.body?.allocation), signature, replace: true });
    res.status(202).json({ ok: true, job: jobView(job) });
  }, { admin: true }));
  app.post('/api/ai-control/restart', route(async (req, res) => {
    const { runtime, profile, devices } = req.body || {};
    if (typeof runtime !== 'string' || !namePattern.test(runtime) || typeof profile !== 'string' || !namePattern.test(profile) || !Array.isArray(devices) || !devices.every((device) => typeof device === 'string' && devicePattern.test(device))) throw new ControlError('Choose a running workload to restart.', 400);
    const job = await control('POST', 'restart', { runtime, profile, devices: [...devices] });
    res.status(202).json({ ok: true, job: jobView(job) });
  }, { admin: true }));
  app.get('/api/ai-control/jobs/:id', route(async (req, res) => {
    if (!jobPattern.test(req.params.id)) throw new ControlError('That change isn’t known.', 404);
    res.json({ ok: true, job: jobView(await control('GET', `jobs/${req.params.id}`)) });
  }, { admin: true }));
}

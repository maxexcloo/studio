// Reattach persisted tiles to their existing prompts; never submit replacement work.
export function createJobRecovery({ backends, filterHistory, finishJob, getGallery, jobs, recordsFromHistory, request, setGallery, visible, withBackend }) {
  let active;
  const missing = new Map();
  function replace(items) {
    if (JSON.stringify(items) !== JSON.stringify(getGallery())) setGallery(items);
  }
  async function recover() {
    if (!getGallery().some((item) => !item.privateVault && !item.url && ['pending', 'error', 'canceled'].includes(item.status))) return;
    const untracked = new Set(visible(getGallery().filter((item) =>
      !item.privateVault && !item.url && item.status === 'pending' && !jobs.has(item.jobId)
    )).map((item) => item.jobId).filter(Boolean));
    const configured = backends();
    let scanned = 0;
    for (const backend of configured) {
      await withBackend(backend, async () => {
        // Both must answer before a missing prompt can count as lost.
        const [queue, rawHistory] = await Promise.all([
          request('/queue', { timeout: 10000 }),
          request('/history?max_items=500', { timeout: 15000 }),
        ]);
        const history = filterHistory(rawHistory);
        const places = new Map();
        for (const [key, status] of [['queue_running', 'running'], ['queue_pending', 'queued']]) {
          for (const entry of queue[key] || []) {
            if (entry[3]?.heiss_hidden) continue;
            const id = entry[3]?.heiss_generation?.jobId;
            if (id) places.set(id, { promptId: entry[1], status });
          }
        }
        const completed = new Map();
        for (const [promptId, entry] of Object.entries(history)) {
          const id = entry.prompt?.[3]?.heiss_generation?.jobId;
          if (id) completed.set(id, { entry, promptId });
        }
        const candidates = new Set(visible(getGallery().filter((item) =>
          !item.privateVault && !item.url && (['pending', 'error'].includes(item.status)
            || item.status === 'canceled' && jobs.get(item.jobId)?.recovered)
        )).map((item) => item.jobId).filter(Boolean));
        for (const id of candidates) {
          const current = jobs.get(id);
          if (current?.comfyBackend && current.comfyBackend !== backend) continue;
          const place = places.get(id);
          if (current?.recovered && ['canceling', 'canceled'].includes(current.status)) {
            if (!place) finishJob(id, { status: 'canceled' });
            continue;
          }
          if (place && !['canceling', 'canceled'].includes(current?.status)) {
            untracked.delete(id);
            missing.delete(id);
            const progress = place.status === 'queued'
              ? { value: 0, max: 0, phase: 'Queued', steps: false }
              : (current?.progress?.phase && current.progress.phase !== 'Queued') || current?.progress?.max > 0
                ? current.progress : { value: 0, max: 0, phase: 'Generating', steps: false };
            const ownerId = current?.ownerId || getGallery().find((item) => item.jobId === id)?.ownerId;
            jobs.set(id, { ...current, ...place, ...(ownerId ? { ownerId } : {}), comfyBackend: backend, progress, ...(!current ? { recovered: true } : {}) });
            replace(getGallery().map((item) => item.jobId === id && !item.url
              ? { ...item, status: 'pending', failure: undefined, error: undefined, progress } : item));
            continue;
          }
          // The normal runner owns delivery, partial outputs and upscales for live jobs.
          if (current && !current.recovered) continue;
          const done = completed.get(id);
          if (done) {
            untracked.delete(id);
            missing.delete(id);
            const outputs = visible(recordsFromHistory({ [done.promptId]: done.entry }));
            if (outputs.length) {
              const urls = new Set(getGallery().filter((item) => item.status === 'done').map((item) => item.url));
              setGallery([...outputs.filter((item) => !urls.has(item.url)), ...getGallery().filter((item) => item.jobId !== id || item.url)]);
              finishJob(id, { status: 'done', outputs, comfyBackend: backend, promptId: done.promptId });
            } else {
              const failed = done.entry.status?.status_str === 'error';
              const error = failed ? 'ComfyUI could not finish this generation.' : 'ComfyUI finished without an available output file.';
              setGallery(getGallery().map((item) => item.jobId === id && !item.url ? { ...item, status: 'error', error, progress: null } : item));
              finishJob(id, { status: 'error', error, comfyBackend: backend, promptId: done.promptId });
            }
          } else if (current?.recovered && current.comfyBackend) {
            const misses = (missing.get(id) || 0) + 1;
            missing.set(id, misses);
            if (misses < 2) continue;
            const status = ['canceling', 'canceled'].includes(current.status) ? 'canceled' : 'error';
            const error = status === 'error' ? 'ComfyUI no longer has this generation.' : undefined;
            setGallery(getGallery().map((item) => item.jobId === id ? { ...item, status, error, progress: null } : item));
            finishJob(id, { status, error });
            missing.delete(id);
          }
        }
        scanned++;
      }).catch(() => {
        // An unavailable backend must not invalidate its persisted jobs or block the other backend.
      });
    }
    // An untracked tile has no backend identity; every backend must confirm absence.
    for (const id of untracked) {
      if (jobs.has(id) || !visible(getGallery()).some((item) => item.jobId === id && !item.privateVault && !item.url && item.status === 'pending')) {
        missing.delete(id);
        continue;
      }
      if (!configured.length || scanned !== configured.length) {
        missing.delete(id);
        continue;
      }
      const misses = (missing.get(id) || 0) + 1;
      missing.set(id, misses);
      if (misses < 2) continue;
      const error = 'ComfyUI no longer has this generation.';
      setGallery(getGallery().map((item) => item.jobId === id && !item.url && item.status === 'pending'
        ? { ...item, status: 'error', error, progress: null } : item));
      finishJob(id, { status: 'error', error, recovered: true });
      missing.delete(id);
    }
  }
  return () => active || (active = recover().finally(() => { active = null; }));
}

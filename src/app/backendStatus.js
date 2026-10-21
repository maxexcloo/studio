/**
 * Follow the worker the selected profile's jobs go to, the way the server
 * routes them (server/workers.js pickWorker): a worker with the capability,
 * the first that answers, else the first. With one worker the status is
 * upstream's, named ComfyUI; with none that can, it says so.
 */
export function statusForProfile(status, profile) {
  const capability = profile?.kind === 'video' && profile.family !== 'grok' ? 'video' : 'image';
  if (status.noWorkers) return { ...status, connected: false, label: 'Workers', error: 'No workers set up' };
  const workers = status.workers;
  if (!Array.isArray(workers) || !workers.length) return status;
  const capable = workers.filter((worker) => worker.capabilities?.includes(capability));
  if (!capable.length) return { ...status, connected: false, busy: false, restarting: false, device: '', url: '', noWorkers: true, label: capability === 'video' ? 'Video Worker' : 'Image Worker', error: capability === 'video' ? 'No worker runs videos' : 'No worker runs images' };
  if (workers.length === 1) return status;
  const { id: _id, name, capabilities: _capabilities, default: isDefault, ...worker } = capable.find((item) => item.connected) || capable[0];
  return { ...status, ...worker, label: name, restarting: Boolean(worker.restarting || (isDefault && status.restarting)) };
}

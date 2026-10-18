const activeStatuses = new Set(["queued", "running", "canceling"]);

export function accountOutstandingJobs(ownerId, jobs) {
  if (!ownerId || !jobs || typeof jobs[Symbol.iterator] !== "function") return 0;
  let count = 0;
  for (const [, job] of jobs) {
    if (job?.ownerId === ownerId && activeStatuses.has(job.status)) count += 1;
  }
  return count;
}

export function reserveAccountJob(ownerId, jobs, reservations, limit) {
  if (!ownerId || !(reservations instanceof Map) || !Number.isInteger(limit) || limit < 1) {
    return { accepted: false, release() {} };
  }
  const pending = reservations.get(ownerId) || 0;
  if (accountOutstandingJobs(ownerId, jobs) + pending >= limit) return { accepted: false, release() {} };

  reservations.set(ownerId, pending + 1);
  let released = false;
  return {
    accepted: true,
    release() {
      if (released) return;
      released = true;
      const remaining = (reservations.get(ownerId) || 1) - 1;
      if (remaining > 0) reservations.set(ownerId, remaining);
      else reservations.delete(ownerId);
    }
  };
}

export function configuredAccountJobLimit(value = process.env.HEISS_ACCOUNT_MAX_OUTSTANDING_JOBS) {
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit > 0 ? limit : 2;
}

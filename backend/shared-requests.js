/**
 * One request per key at a time: callers that arrive while it is on its way
 * share it. `fresh` starts another (something changed after the one already
 * sent), which later callers then share instead.
 */
export function sharedRequests() {
  const pending = new Map();
  return function share(key, start, { fresh = false } = {}) {
    const current = pending.get(key);
    if (current && !fresh) return current;
    const request = Promise.resolve()
      .then(start)
      .finally(() => {
        if (pending.get(key) === request) pending.delete(key);
      });
    pending.set(key, request);
    return request;
  };
}

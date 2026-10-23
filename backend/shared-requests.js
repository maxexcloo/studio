/** One request per key at a time: callers that arrive while it is on its way share it. */
export function sharedRequests() {
  const pending = new Map();
  return function share(key, start) {
    const current = pending.get(key);
    if (current) return current;
    const request = Promise.resolve()
      .then(start)
      .finally(() => {
        if (pending.get(key) === request) pending.delete(key);
      });
    pending.set(key, request);
    return request;
  };
}

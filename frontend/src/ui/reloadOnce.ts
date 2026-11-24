const key = "studio-chunk-reload";

/** Reloads for a deploy's new chunks, at most once in 30 seconds so a real outage cannot loop. */
export function reloadOnce() {
  const last = Number(sessionStorage.getItem(key));
  if (last && Date.now() - last < 30_000) return;
  sessionStorage.setItem(key, String(Date.now()));
  location.reload();
}

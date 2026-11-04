/**
 * A catch for background work: says why it failed, once until the reason changes, so a loop that
 * keeps failing neither floods the log nor hides a bug.
 */
export function logFailure(label: string) {
  let last = "";
  return (error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    if (reason !== last) console.warn(`[Studio] ${label} failed: ${reason}`);
    last = reason;
  };
}

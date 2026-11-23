import type { HistoryRouterProps, Location } from "react-router";

const key = "studio-history";

/**
 * Keeps the app in one browser history entry: pushes replace it and remember the location they
 * left, and going back replaces it with a remembered one, so Studio's own Back still works but
 * the platform's has nothing to go back to.
 */
export function singleEntry(
  history: HistoryRouterProps["history"],
  storage: Pick<Storage, "getItem" | "setItem">,
) {
  const behind: Location[] = JSON.parse(storage.getItem(key) ?? "[]");
  const save = () => storage.setItem(key, JSON.stringify(behind));
  const { replace } = history;
  history.push = (to, state) => {
    behind.push(history.location);
    save();
    replace(to, state);
  };
  history.go = (delta) => {
    if (delta >= 0 || behind.length < -delta) return;
    const [target] = behind.splice(behind.length + delta);
    save();
    replace(target);
  };
}

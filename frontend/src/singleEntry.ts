import type { HistoryRouterProps, Location } from "react-router";

const key = "studio-history";
/** How many left locations Back can return to. */
const kept = 50;

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
  const save = () => {
    try {
      storage.setItem(key, JSON.stringify(behind));
    } catch {
      /* A full storage only shortens Back after a reload. */
    }
  };
  const { replace } = history;
  history.push = (to, state) => {
    behind.push(history.location);
    behind.splice(0, behind.length - kept);
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

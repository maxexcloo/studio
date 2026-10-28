import { useLocalStorage } from "@mantine/hooks";
import { useAccount } from "./AccountGate";

/**
 * UI state remembered across reloads has one store: browser storage under
 * `studio-<name>:<account>`, so each account on a browser keeps its own. Remember settled choices
 * (modes, filters, tabs, drafts), never transient ones such as open popups or selections.
 */
export function useRememberedKey(name: string) {
  return `studio-${name}:${useAccount().data?.account?.id ?? "local"}`;
}

/** `useState` for remembered UI state; pass a stable default. */
export function useRemembered<T>(name: string, defaultValue: T) {
  return useLocalStorage<T>({
    key: useRememberedKey(name),
    defaultValue,
    getInitialValueInEffect: false,
    // Objects saved by an earlier version take on fields added to the default since.
    deserialize: (saved) => {
      const value = saved && JSON.parse(saved);
      return value && isRecord(defaultValue) ? { ...defaultValue, ...value } : value;
    },
  });
}
const isRecord = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

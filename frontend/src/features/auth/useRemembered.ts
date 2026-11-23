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
    // Objects saved by an earlier version take on the default's current fields; an empty default
    // is an open map and keeps every saved key.
    deserialize: (saved) => {
      const value = saved && JSON.parse(saved);
      if (!value || !isRecord(defaultValue)) return value;
      const fields = Object.entries(defaultValue as Record<string, unknown>);
      return fields.length
        ? Object.fromEntries(
            fields.map(([field, fallback]) => [field, field in value ? value[field] : fallback]),
          )
        : value;
    },
  });
}
const isRecord = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

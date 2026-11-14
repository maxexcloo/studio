import { useGroupFeature } from "../auth/AccountGate";

/** Each account's own Characters in the Library, known from the account status AccountGate has already loaded. */
export function useLibraryAccess() {
  return { characters: useGroupFeature("characters") };
}

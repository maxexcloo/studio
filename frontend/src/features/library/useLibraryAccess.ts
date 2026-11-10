import { useGroupFeature, useIsAdmin } from "../auth/AccountGate";

/**
 * The Library is administration, plus each account's own Characters, known from the account status
 * AccountGate has already loaded.
 */
export function useLibraryAccess() {
  const admin = useIsAdmin();
  const characters = useGroupFeature("characters");
  return {
    allowed: admin || characters,
    characters,
  };
}

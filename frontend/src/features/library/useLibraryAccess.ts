import { useQuery } from "@tanstack/react-query";
import { useGroupFeature, useIsAdmin } from "../auth/AccountGate";
import { modelsQuery } from "../generation/GenerationProvider";

/**
 * The Library is administration, plus each account's own Characters, known from the account status
 * AccountGate has already loaded.
 */
export function useLibraryAccess() {
  const models = useQuery(modelsQuery);
  const admin = useIsAdmin();
  const characters = useGroupFeature("characters");
  return {
    allowed: admin || characters,
    characters,
    presets: models.data?.features?.presets === true,
  };
}

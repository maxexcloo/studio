import { useQuery } from "@tanstack/react-query";
import { useIsAdmin } from "../auth/AccountGate";
import { modelsQuery } from "../generation/GenerationProvider";

/** The Library is administration, known from the account status AccountGate has already loaded. */
export function useLibraryAccess() {
  const models = useQuery(modelsQuery);
  return {
    allowed: useIsAdmin(),
    presets: models.data?.features?.presets === true,
  };
}

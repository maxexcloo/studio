import { useQuery } from "@tanstack/react-query";
import { modelsQuery } from "../generation/GenerationProvider";

export function useLibraryAccess() {
  const models = useQuery(modelsQuery);
  return {
    allowed: models.data?.features?.library === true,
    presets: models.data?.features?.presets === true,
    pending: models.isPending,
  };
}

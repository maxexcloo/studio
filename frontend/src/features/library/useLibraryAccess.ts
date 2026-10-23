import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import type { Models } from "../../types";

export function useLibraryAccess() {
  const models = useQuery({
    queryKey: ["models"],
    queryFn: () => api<Models>("/api/models?cached=1"),
  });
  return {
    allowed: models.data?.features?.library === true,
    presets: models.data?.features?.presets === true,
    pending: models.isPending,
  };
}

import { useEffect } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { modelsQuery } from "../generation/GenerationProvider";

/** The account's own preferences (backend/account-preferences.js). */
export interface Preferences {
  cloudModels: boolean;
  tileCaptions: boolean;
  uncensoredModels: boolean;
}
interface PreferencesStatus {
  preferences: Preferences;
  /** The preferences the account has saved itself. */
  saved: (keyof Preferences)[];
  /** What the account's group grants, which only an ordinary account may turn off. */
  grants: Pick<Preferences, "cloudModels" | "uncensoredModels">;
}
export const preferencesQuery = queryOptions({
  queryKey: ["preferences"],
  queryFn: () => api<PreferencesStatus>("/api/preferences"),
});

/** Saves preferences at once; a failure refetches the saved ones and reports through the default notification. */
export function useSavePreferences() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Preferences>) =>
      api<PreferencesStatus>("/api/preferences", { method: "PATCH", body: JSON.stringify(patch) }),
    onMutate: (patch) =>
      client.setQueryData(
        preferencesQuery.queryKey,
        (status) => status && { ...status, preferences: { ...status.preferences, ...patch } },
      ),
    onSuccess: (status, patch) => {
      client.setQueryData(preferencesQuery.queryKey, status);
      // Model choices change what the account may use everywhere.
      if ("cloudModels" in patch || "uncensoredModels" in patch)
        for (const queryKey of [["account"], modelsQuery.queryKey])
          void client.invalidateQueries({ queryKey });
    },
    onError: () => client.invalidateQueries({ queryKey: preferencesQuery.queryKey }),
  });
}

// Tile Captions used to be saved per device; the first account to load here keeps that value.
const deviceTileCaptions = "studio-tile-captions";

/** Phone captions stay hidden unless the account's Tile Captions preference is on. */
export function useTileCaptions() {
  const preferences = useQuery(preferencesQuery);
  const save = useSavePreferences();
  const status = preferences.data;
  useEffect(() => {
    const device = status && localStorage.getItem(deviceTileCaptions);
    if (!status || device === null) return;
    localStorage.removeItem(deviceTileCaptions);
    if (!status.saved.includes("tileCaptions")) save.mutate({ tileCaptions: device === "true" });
  }, [status, save]);
  return [
    status?.preferences.tileCaptions ?? false,
    (tileCaptions: boolean) => save.mutate({ tileCaptions }),
  ] as const;
}

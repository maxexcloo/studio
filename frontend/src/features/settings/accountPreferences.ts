import { useEffect } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { modelsQuery } from "../generation/GenerationProvider";

/** Where the account prefers videos to run: Cloud, or the local Fast or Quality tier. */
export type VideosPreference = "cloud" | "fast" | "quality";
/** Where the account prefers an area's work to run; the other side takes over, saying so, when it can't. */
export type SidePreference = "cloud" | "local";
/** The account's own preferences (backend/account-preferences.js). */
export interface Preferences {
  cloudModels: boolean;
  loras: boolean;
  spicyPrompts: boolean;
  tileCaptions: boolean;
  uncensoredModels: boolean;
  /** Where Chat, prompt writing and images run by default; unsaved, Local. */
  chat?: SidePreference;
  images?: SidePreference;
  writing?: SidePreference;
  /** Unsaved, Fast where the account has local video, otherwise Cloud. */
  videos?: VideosPreference;
}
interface PreferencesStatus {
  preferences: Preferences;
  /** The preferences the account has saved itself. */
  saved: (keyof Preferences)[];
  /**
   * What the account's role or group grants, which it may turn off for itself, and whether it may
   * turn Spicy Prompts on (Uncensored Models in its effective access).
   */
  grants: Pick<Preferences, "cloudModels" | "loras" | "spicyPrompts" | "uncensoredModels">;
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
      if ("cloudModels" in patch || "loras" in patch || "uncensoredModels" in patch)
        for (const queryKey of [["account"], modelsQuery.queryKey])
          void client.invalidateQueries({ queryKey });
      // Explicit wording (Spicy Prompts with Uncensored Models) changes what suggestions say.
      if ("spicyPrompts" in patch || "uncensoredModels" in patch)
        void client.invalidateQueries({ queryKey: ["suggestions"] });
      // Default models follow where the account prefers each area to run.
      if ("images" in patch || "videos" in patch)
        void client.invalidateQueries({ queryKey: modelsQuery.queryKey });
      if ("videos" in patch) void client.invalidateQueries({ queryKey: ["animate-profile"] });
      if ("chat" in patch) void client.invalidateQueries({ queryKey: ["chat-status"] });
      if ("writing" in patch) void client.invalidateQueries({ queryKey: ["assistant"] });
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

/** Where the account prefers videos to run, as Animate's menus and Settings show it. */
export function useVideosPreference() {
  const save = useSavePreferences();
  return [
    useQuery(preferencesQuery).data?.preferences.videos,
    (videos: VideosPreference) => save.mutate({ videos }),
  ] as const;
}

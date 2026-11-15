import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Appearance } from "../../../../shared/appearance";
import { api } from "../../api";
import { accountQuery, useAccount } from "../auth/AccountGate";
import { galleryKey } from "../gallery/queries";
import { modelsQuery } from "../generation/GenerationProvider";

/** Where the account prefers videos to run: Cloud, or the local Fast or Quality tier. */
export type VideosPreference = "cloud" | "fast" | "quality";
/** Where the account prefers images to run; the other side takes over, saying so, when it can't. */
export type SidePreference = "cloud" | "local";
/** Which unfinished work the gallery shows: none, work in progress, or queued work too. */
export type GalleryWorkPreference = "none" | "running" | "queued";
/** The account's own preferences (backend/account-preferences.js). */
export interface Preferences {
  cloudModels: boolean;
  loras: boolean;
  spicyPrompts: boolean;
  tileCaptions: boolean;
  uncensoredModels: boolean;
  /** Which unfinished work the gallery shows; unsaved, none. */
  galleryWork?: GalleryWorkPreference;
  /** Where images run by default; unsaved, Local. */
  images?: SidePreference;
  /** The text model prompt writing asks for; unsaved, the assistant's default (`/api/assistant`). */
  writingModel?: string;
  /** Unsaved, Fast where the account has local video, otherwise Cloud. */
  videos?: VideosPreference;
  /** The header's Appearance settings; unsaved, the browser's. */
  appearance?: Partial<Appearance>;
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
        for (const queryKey of [accountQuery.queryKey, modelsQuery.queryKey])
          void client.invalidateQueries({ queryKey });
      // Explicit wording (Spicy Prompts with Uncensored Models) changes what suggestions say.
      if ("spicyPrompts" in patch || "uncensoredModels" in patch)
        void client.invalidateQueries({ queryKey: ["suggestions"] });
      // The gallery shows the unfinished work the account chose.
      if ("galleryWork" in patch) void client.invalidateQueries({ queryKey: galleryKey });
      // Default models follow where the account prefers each area to run.
      if ("images" in patch || "videos" in patch)
        void client.invalidateQueries({ queryKey: modelsQuery.queryKey });
      if ("videos" in patch) void client.invalidateQueries({ queryKey: ["animate-profile"] });
      if ("writingModel" in patch) void client.invalidateQueries({ queryKey: ["assistant"] });
    },
    onError: () => client.invalidateQueries({ queryKey: preferencesQuery.queryKey }),
  });
}

/** Phone captions stay hidden unless the account's Tile Captions preference is on. */
export function useTileCaptions() {
  const preferences = useQuery(preferencesQuery);
  const save = useSavePreferences();
  return [
    preferences.data?.preferences.tileCaptions ?? false,
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

/** The account's Appearance and its saver, once someone is signed in (single-user mode always is). */
export function useAppearancePreference() {
  const account = useAccount().data;
  const signedIn = !!account && (account.mode !== "multi-user" || !!account.signedIn);
  const preferences = useQuery({ ...preferencesQuery, enabled: signedIn });
  const save = useSavePreferences();
  return {
    saved: preferences.data?.preferences.appearance,
    save: preferences.data ? (appearance: Appearance) => save.mutate({ appearance }) : undefined,
  };
}

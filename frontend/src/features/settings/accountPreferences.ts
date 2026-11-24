import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Appearance } from "../../../../shared/appearance";
import type { TasteArea, TasteAreaSetting } from "../../../../shared/taste";
import { api } from "../../api";
import { accountQuery, useAccount } from "../auth/AccountGate";
import { galleryKey } from "../gallery/queries";
import type { SavedGalleryView } from "../gallery/SavedViews";
import { modelsQuery } from "../generation/GenerationProvider";

/** Which unfinished work the gallery shows: none, work in progress, or queued work too. */
export type GalleryWorkPreference = "none" | "running" | "queued";
/**
 * The account's own preferences (backend/account-preferences.js); where work runs and how it
 * starts are Studio's (Settings › Where Work Runs).
 */
export interface Preferences {
  loras: boolean;
  tileCaptions: boolean;
  uncensoredModels: boolean;
  /** Which unfinished work the gallery shows; unsaved, none. */
  galleryWork?: GalleryWorkPreference;
  /** The header's Appearance settings; unsaved, the browser's. */
  appearance?: Partial<Appearance>;
  /** The gallery's saved views, in the order saved. */
  galleryViews?: SavedGalleryView[];
  /** Where Taste Applies (Settings › Taste); unsaved areas take `tasteAreasOf`'s defaults. */
  tasteAreas?: Partial<Record<TasteArea, Partial<TasteAreaSetting>>>;
}
interface PreferencesStatus {
  preferences: Preferences;
  /** The preferences the account has saved itself. */
  saved: (keyof Preferences)[];
  /** What the account's role or group grants, which it may turn off for itself. */
  grants: Pick<Preferences, "loras" | "uncensoredModels">;
}
export const preferencesQuery = queryOptions({
  queryKey: ["preferences"],
  queryFn: () => api<PreferencesStatus>("/api/preferences"),
});

/**
 * Saves preferences at once; a failure refetches the saved ones and reports through the default
 * notification, or `inlineError` where a dialog shows it.
 */
export function useSavePreferences(previousGalleryViews?: SavedGalleryView[], inlineError = false) {
  const client = useQueryClient();
  return useMutation({
    meta: { inlineError },
    mutationFn: (patch: Partial<Preferences>) =>
      api<PreferencesStatus>("/api/preferences", {
        method: "PATCH",
        body: JSON.stringify(previousGalleryViews ? { ...patch, previousGalleryViews } : patch),
      }),
    onMutate: (patch) =>
      client.setQueryData(
        preferencesQuery.queryKey,
        (status) => status && { ...status, preferences: { ...status.preferences, ...patch } },
      ),
    onSuccess: (status, patch) => {
      client.setQueryData(preferencesQuery.queryKey, status);
      // Model choices change what the account may use everywhere.
      if ("loras" in patch || "uncensoredModels" in patch)
        for (const queryKey of [accountQuery.queryKey, modelsQuery.queryKey])
          void client.invalidateQueries({ queryKey });
      // Uncensored Models decides whether suggestions may be worded explicitly.
      if ("uncensoredModels" in patch || "tasteAreas" in patch)
        void client.invalidateQueries({ queryKey: ["suggestions"] });
      // The gallery shows the unfinished work the account chose.
      if ("galleryWork" in patch) void client.invalidateQueries({ queryKey: galleryKey });
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

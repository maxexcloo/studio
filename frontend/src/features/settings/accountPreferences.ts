import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Appearance } from "../../../../shared/appearance";
import type { ChatBrief } from "../../../../shared/chat-brief";
import { api } from "../../api";
import { accountQuery, useAccount } from "../auth/AccountGate";
import { galleryKey } from "../gallery/queries";
import { modelsQuery } from "../generation/GenerationProvider";

/** Where the account prefers a kind to run; the other side takes over, saying so, when it can't. */
export type SidePreference = "cloud" | "local";
/** The kinds of work whose side and default models the account chooses. */
export type WorkKind = "images" | "text" | "videos";
/** Each kind's default model per side, by its preference key (backend/account-preferences.js). */
export const defaultModelKeys = {
  images: { cloud: "imageCloud", local: "imageLocal" },
  text: { cloud: "textCloud", local: "textLocal" },
  videos: { cloud: "videoCloud", local: "videoLocal" },
} as const;
type DefaultModelKey = (typeof defaultModelKeys)[WorkKind][SidePreference];
/** Which unfinished work the gallery shows: none, work in progress, or queued work too. */
export type GalleryWorkPreference = "none" | "running" | "queued";
/** The account's own preferences (backend/account-preferences.js). */
interface PreferenceValues {
  cloudModels: boolean;
  loras: boolean;
  tileCaptions: boolean;
  uncensoredModels: boolean;
  /** The standing brief every chat writes its prompts to; unsaved, none. */
  chatBrief?: ChatBrief;
  /** Which unfinished work the gallery shows; unsaved, none. */
  galleryWork?: GalleryWorkPreference;
  /** Where images run by default; unsaved (and Cloud while Cloud Models is off), Local. */
  images?: SidePreference;
  /** Where text runs; unsaved, Cloud (Local while Cloud Models is off). */
  text?: SidePreference;
  /** Where videos and Animate run by default; unsaved (and Cloud while Cloud Models is off), Local. */
  videos?: SidePreference;
  /** The header's Appearance settings; unsaved, the browser's. */
  appearance?: Partial<Appearance>;
}
/** Each kind's default model per side (a profile ID or gateway text model); null clears one. */
export type Preferences = PreferenceValues & Partial<Record<DefaultModelKey, string | null>>;
export interface PreferencesStatus {
  preferences: Preferences;
  /** The preferences the account has saved itself. */
  saved: (keyof Preferences)[];
  /** What the account's role or group grants, which it may turn off for itself. */
  grants: Pick<Preferences, "cloudModels" | "loras" | "uncensoredModels">;
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
      // Cloud Models decides whether a saved Cloud counts.
      if ("cloudModels" in patch) void client.invalidateQueries({ queryKey: ["animate-profile"] });
      // Uncensored Models decides whether suggestions may be worded explicitly.
      if ("uncensoredModels" in patch) void client.invalidateQueries({ queryKey: ["suggestions"] });
      // The gallery shows the unfinished work the account chose.
      if ("galleryWork" in patch) void client.invalidateQueries({ queryKey: galleryKey });
      // Default models follow where the account prefers each kind to run and its chosen defaults.
      const changed = (kind: WorkKind) =>
        kind in patch || Object.values(defaultModelKeys[kind]).some((key) => key in patch);
      if (changed("images") || changed("videos"))
        void client.invalidateQueries({ queryKey: modelsQuery.queryKey });
      if (changed("videos")) void client.invalidateQueries({ queryKey: ["animate-profile"] });
      if (changed("text")) void client.invalidateQueries({ queryKey: ["assistant"] });
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
    (videos: SidePreference) => save.mutate({ videos }),
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

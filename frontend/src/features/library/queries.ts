import { queryOptions } from "@tanstack/react-query";

import type { ImageChangeAction } from "../../../../shared/suggestions";
import { api } from "../../api";
import type { LibraryItem } from "./LibraryCatalogueTable";
import type { ImportRecord, ImportVision } from "./LibraryImportReview";

/** The Library's model and LoRA catalogue, with the update check. */
export const catalogueQuery = queryOptions({
  queryKey: ["library"],
  queryFn: () =>
    api<{
      items: LibraryItem[];
      updates?: { checkedAt?: string; available: number };
      inventoryError?: string;
    }>("/api/library/items"),
});

/** The profiles, guides and guide bindings lists all sit under this key. */
export const definitionsKey = ["definition-list"];

export interface ProfileRow {
  id: string;
  name?: string;
  family?: string;
  kind: "image" | "video";
  version: number;
  editedAt?: string;
  aiDrafted?: boolean;
  /** A combined profile's current backend. */
  backend?: string;
}
export const editableProfilesQuery = queryOptions({
  queryKey: [...definitionsKey, "profile"],
  queryFn: () => api<{ profiles: ProfileRow[] }>("/api/profiles/editable"),
});

export interface ModelDownload {
  id: string;
  file: string;
  folder: string;
  label?: string;
  status: string;
  error?: string;
  retryable?: boolean;
  receivedBytes?: number;
  totalBytes?: number;
  finishedAt?: string;
}
export interface DownloadState {
  active?: ModelDownload | null;
  queued?: ModelDownload[];
  paused?: ModelDownload[];
  recent?: ModelDownload[];
}
export const downloadsQuery = queryOptions({
  queryKey: ["library-downloads"],
  queryFn: () => api<DownloadState>("/api/models/downloads"),
});

/** Library › Imports' records, newest first. */
export const importsQuery = queryOptions({
  queryKey: ["imports"],
  queryFn: () => api<{ imports: ImportRecord[]; vision?: ImportVision }>("/api/library/imports"),
});

export interface ProfileStats {
  runs: number;
  failed: number;
  liked: number;
  medianQueueMs?: number;
  medianRunMs?: number;
  failing: boolean;
}
export const profileStatsQuery = queryOptions({
  queryKey: ["profile-stats"],
  queryFn: () => api<{ profiles: Record<string, ProfileStats> }>("/api/stats/profiles"),
});

/** One of the assistant's fixed options, as Library › Templates edits it. */
export interface PromptStyle {
  id: string;
  /** The menu it belongs to: Improve Prompt, Animate or fixed AI edits. */
  kind: "improve" | "animate" | "change";
  actions?: ImageChangeAction[];
  label: string;
  description: string;
  instruction: string;
  enabled: boolean;
  uncensored?: boolean;
  /** Animate only: applied on top of a chosen theme, never offered as one. */
  modifier?: boolean;
}
interface PromptStyleVersion {
  version: number;
  by?: string;
  origin?: string;
  aiDrafted?: boolean;
}
/** The assistant's fixed options in menu order, with their hash (an edit's base) and meta. */
export interface PromptStyleList {
  styles: PromptStyle[];
  hash: string;
  meta: PromptStyleVersion | null;
}
export const promptStylesQuery = queryOptions({
  queryKey: [...definitionsKey, "prompt-styles"],
  queryFn: () => api<PromptStyleList>("/api/profiles/prompt-styles"),
});

export interface PromptInstruction {
  id: string;
  label: string;
  area: string;
  suggestions?: true;
  /** Where Studio uses it, as people know it (backend/prompt-instruction-used-by.js). */
  usedBy: string;
  text: string;
  initial: string;
  hash: string;
  version: number | null;
  isDefault: boolean;
  editedAt?: string;
}
export const promptInstructionsPath = "/api/profiles/prompt-instructions";
export const promptInstructionsQuery = queryOptions({
  queryKey: [...definitionsKey, "prompt-instructions"],
  queryFn: () =>
    api<{
      instructions: PromptInstruction[];
      /** What each variable reads like when Studio runs an instruction, for its preview. */
      examples: Record<string, string>;
    }>(promptInstructionsPath),
});

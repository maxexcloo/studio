import { queryOptions } from "@tanstack/react-query";
import { api } from "../../api";
import type { LibraryItem } from "./LibraryCatalogueTable";
import type { ImportRecord, ImportVision } from "./LibraryImportReview";

/** The Library's model and LoRA catalogue, with the update check. */
export const catalogueQuery = queryOptions({
  queryKey: ["library"],
  queryFn: () =>
    api<{ items: LibraryItem[]; updates?: { checkedAt?: string; available: number } }>(
      "/api/library/items",
    ),
});

/** The profiles, guides and guide bindings lists all sit under this key. */
export const definitionsKey = ["definition-list"];

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

export interface Merge {
  from: string;
  to: string;
  name: string;
}
export interface DuplicatePreview {
  hash: string;
  merges: Merge[];
  differing: { name: string; ids: string[]; differences: string[] }[];
  unresolved: { name: string; ids: string[]; reason: string }[];
}
export const duplicateProfilesQuery = queryOptions({
  queryKey: ["profile-duplicates"],
  queryFn: () => api<DuplicatePreview>("/api/profiles/duplicates"),
});

/** Library › Imports' records, newest first. */
export const importsQuery = queryOptions({
  queryKey: ["imports"],
  queryFn: () => api<{ imports: ImportRecord[]; vision?: ImportVision }>("/api/library/imports"),
});

export interface ProfileStats {
  runs: number;
  failed: number;
  starred: number;
  medianRunMs?: number;
  failing: boolean;
}
export const profileStatsQuery = queryOptions({
  queryKey: ["profile-stats"],
  queryFn: () => api<{ profiles: Record<string, ProfileStats> }>("/api/stats/profiles"),
});

/** One of the assistant's fixed options, as Library › Prompt Styles edits it. */
export interface PromptStyle {
  id: string;
  /** The menu it belongs to: Improve Prompt, Animate or fixed AI edits. */
  kind: "improve" | "animate" | "change";
  label: string;
  description: string;
  instruction: string;
  enabled: boolean;
  uncensored?: boolean;
}
export interface PromptStyleVersion {
  version: number;
  by?: string;
  origin?: string;
  aiDrafted?: boolean;
}
/** The assistant's fixed options in menu order, with their hash (an edit's base) and meta. */
export const promptStylesQuery = queryOptions({
  queryKey: [...definitionsKey, "prompt-styles"],
  queryFn: () =>
    api<{ styles: PromptStyle[]; hash: string; meta: PromptStyleVersion | null }>(
      "/api/profiles/prompt-styles",
    ),
});

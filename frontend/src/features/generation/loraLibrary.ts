import { queryOptions } from "@tanstack/react-query";

import { api } from "../../api";

export interface LoraLibrary {
  ratings?: Record<string, LoraRating>;
}
export type LoraRating = "up" | "down";
/** The account's LoRA ratings. */
export const loraLibraryQuery = queryOptions({
  queryKey: ["lora-library"],
  queryFn: () => api<{ found: boolean; library: LoraLibrary }>("/api/loras/library"),
});

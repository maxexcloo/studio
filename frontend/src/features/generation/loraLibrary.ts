import { queryOptions } from "@tanstack/react-query";

import { api } from "../../api";
import type { Rating } from "../../types";

export interface LoraLibrary {
  ratings?: Record<string, Rating>;
}
/** The account's LoRA ratings. */
export const loraLibraryQuery = queryOptions({
  queryKey: ["lora-library"],
  queryFn: () => api<{ found: boolean; library: LoraLibrary }>("/api/loras/library"),
});

import { useRemembered } from "../auth/useRemembered";

export type SimilarStrictness = "close" | "similar" | "loose";

/** How alike Similar's results must be, shared by Similar ▾ and the gallery's Similar chip. */
export const similarStrictnessOptions: { value: SimilarStrictness; label: string }[] = [
  { value: "close", label: "Close" },
  { value: "similar", label: "Similar" },
  { value: "loose", label: "Loose" },
];

/** How the gallery's Similar chip begins at each strictness. */
export const similarChipLabels: Record<SimilarStrictness, string> = {
  close: "Close to",
  similar: "Similar to",
  loose: "Loosely Like",
};

export const useSimilarStrictness = () =>
  useRemembered<SimilarStrictness>("similar-strictness", "similar");

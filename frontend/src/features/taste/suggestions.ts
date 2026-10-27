import { queryOptions } from "@tanstack/react-query";
import type { NextStep, Suggestions } from "../../../../shared/suggestions";
import { post } from "../../api";
import type { MediaKind } from "../../types";

// Studio caches each answer for ten minutes too; a failed ask stays quiet and isn't retried.
const cached = { staleTime: 10 * 60_000, retry: false } as const;

/** Prompt ideas for an empty composer, from the account's taste profile. */
export const promptIdeasQuery = (kind: MediaKind) =>
  queryOptions({
    queryKey: ["suggestions", "composer", kind],
    queryFn: () => post<Suggestions<string>>("/api/suggestions", { surface: "composer", kind }),
    ...cached,
  });

/** A finished image's next steps; `fresh` asks for different ones than those saved with it. */
export const askNextSteps = (jobId: string, fresh = false) =>
  post<Suggestions<NextStep>>("/api/suggestions", { surface: "viewer", jobId, fresh });

/** Next-step chips for a finished image in the viewer. */
export const nextStepsQuery = (jobId: string) =>
  queryOptions({
    queryKey: ["suggestions", "viewer", jobId],
    queryFn: () => askNextSteps(jobId),
    ...cached,
  });

import { queryOptions } from "@tanstack/react-query";

import type {
  Change,
  ChangeAction,
  NextStep,
  PromptIdea,
  Suggestions,
} from "../../../../shared/suggestions";
import { post } from "../../api";
import type { MediaKind } from "../../types";

// Studio caches each answer for ten minutes too; a failed ask isn't retried, but a reply with
// none (its reason) is asked again when next wanted.
const cached = {
  staleTime: (query: { state: { data?: { reason?: string } } }) =>
    query.state.data?.reason ? 0 : 10 * 60_000,
  retry: false,
} as const;

/** The composer's AI menu offers ideas for an empty prompt or a draft with applied cards. */
export const promptIdeasQuery = (
  kind: MediaKind,
  cards?: { cardIds: string[]; prompt: string },
  fresh = false,
) =>
  queryOptions({
    queryKey: ["suggestions", "composer", kind, cards],
    queryFn: () =>
      post<Suggestions<PromptIdea>>("/api/suggestions", {
        surface: "composer",
        kind,
        ...cards,
        fresh,
      }),
    ...cached,
  });

/** A finished image's next steps; `fresh` asks for different ones than those saved with it. */
export const askNextSteps = (jobId: string, fresh = false, prompt?: string, itemId?: string) =>
  post<Suggestions<NextStep>>("/api/suggestions", {
    surface: "viewer",
    jobId,
    fresh,
    prompt,
    itemId,
  });

/** A finished image's next steps, which the viewer's Suggestions offers. */
export const nextStepsQuery = (jobId: string, prompt?: string, itemId?: string) =>
  queryOptions({
    queryKey: ["suggestions", "viewer", jobId, prompt, itemId],
    queryFn: () => askNextSteps(jobId, false, prompt, itemId),
    ...cached,
  });

/** What could happen when a finished image is animated; `fresh` asks for different ideas. */
export const askMotionIdeas = (jobId: string, fresh = false, itemId?: string) =>
  post<Suggestions<NextStep>>("/api/suggestions", { surface: "animate", jobId, fresh, itemId });

/** A finished image's motion ideas, which Animate's Custom Animation offers. */
export const motionIdeasQuery = (jobId: string, itemId?: string) =>
  queryOptions({
    queryKey: ["suggestions", "animate", jobId, itemId],
    queryFn: () => askMotionIdeas(jobId, false, itemId),
    ...cached,
  });

/** Short changes for the composer's draft prompt; `fresh` asks for different ones. */
export const askDraftSteps = (kind: MediaKind, prompt: string, fresh = false) =>
  post<Suggestions<NextStep>>("/api/suggestions", { surface: "draft", kind, prompt, fresh });

/** The composer's draft changes, offered as an image's next steps are. */
export const draftStepsQuery = (kind: MediaKind, prompt: string) =>
  queryOptions({
    queryKey: ["suggestions", "draft", kind, prompt],
    queryFn: () => askDraftSteps(kind, prompt),
    ...cached,
  });

/** The action and prompt for a change to a result asked for in plain words, chosen from `actions`. */
export const askChange = (
  jobId: string,
  request: string,
  actions: ChangeAction[],
  prompt?: string,
  itemId?: string,
) =>
  post<Suggestions<Change>>("/api/suggestions", {
    surface: "change",
    jobId,
    request,
    actions,
    prompt,
    itemId,
  });

/** The same for the composer's draft prompt, which has no result yet. */
export const askDraftChange = (
  kind: MediaKind,
  prompt: string,
  request: string,
  actions: ChangeAction[],
) =>
  post<Suggestions<Change>>("/api/suggestions", {
    surface: "draft",
    kind,
    prompt,
    request,
    actions,
  });

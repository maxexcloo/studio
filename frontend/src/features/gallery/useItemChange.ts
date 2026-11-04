import type { Change, ChangeAction } from "../../../../shared/suggestions";
import type { MediaItem } from "../../types";
import { useAskChange } from "../generation/AskChange";
import { askChange } from "../taste/suggestions";
import { findAction, type ActionGroups } from "./ActionBar";
import type { Iteration } from "./useMediaAction";

/** What carries out an item's change: its current actions, whose Upscale it may run, and runs. */
export interface ChangeContext {
  groups: () => ActionGroups;
  iterate: (iteration: Iteration) => void;
}

/**
 * Ask for a Change on a finished item, as the viewer's field and Details offer it: an image edits,
 * recreates or animates, a video animates again, and either upscales where its actions can.
 * `run` carries out the proposal with its (perhaps edited) prompt.
 */
export function useItemChange<T>(
  item: MediaItem,
  {
    groups,
    iterate,
    show,
    restore,
  }: ChangeContext & {
    show?: (proposal: Change) => void;
    restore?: (typed: T) => void;
  },
) {
  const video = item.type === "video";
  const upscale = () =>
    findAction(groups(), "upscale-run") ?? findAction(groups(), "upscale-again");
  const ask = useAskChange<T>({
    ask: (request) => {
      const actions: ChangeAction[] = [
        ...(video ? [] : (["edit", "recreate"] as const)),
        "animate",
        ...(upscale() ? (["upscale"] as const) : []),
      ];
      return askChange(item.jobId!, request, actions);
    },
    show,
    restore,
  });
  function run(prompt: string) {
    const action = ask.proposal?.action;
    if (action === "upscale") upscale()?.onClick?.();
    else if (action)
      iterate({
        kind: "prompt",
        prompt: prompt.trim(),
        operation:
          action === "edit" ? "refine" : action === "animate" && !video ? "animate" : "image",
      });
    ask.done();
  }
  return {
    ...ask,
    available: ask.available && item.status === "done" && Boolean(item.url && item.jobId),
    run,
  };
}

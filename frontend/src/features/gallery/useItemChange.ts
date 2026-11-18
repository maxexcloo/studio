import { notifications } from "@mantine/notifications";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { Change, ChangeAction } from "../../../../shared/suggestions";
import type { MediaItem } from "../../types";
import { type ActionGroups, findAction } from "../../ui/ActionBar";
import { assistantQuery } from "../generation/PromptAssistant";
import { askChange } from "../taste/suggestions";
import { useItemMutation } from "./useItemMutation";
import type { Iteration } from "./useMediaAction";

/** What carries out an item's change: its current actions, whose Upscale it may run, and runs. */
interface ChangeContext {
  groups: () => ActionGroups;
  iterate: (iteration: Iteration) => void;
}

/**
 * Ask for a Change on a finished item, as the viewer's field offers it: an image edits,
 * recreates with its seed, so only the change differs, or animates, a video animates again, and
 * either upscales where its actions can. `run` carries out the proposal with its (perhaps edited)
 * prompt.
 */
export function useItemChange<T extends string>(
  item: MediaItem,
  {
    groups,
    iterate,
    review,
    show,
    restore,
  }: ChangeContext & {
    review: boolean;
    show: (proposal: Change | null) => void;
    restore: (typed: T) => void;
  },
) {
  const video = item.type === "video";
  const assistant = useQuery(assistantQuery);
  const [change, setChange] = useState<{ proposal: Change; typed: T } | null>(null);
  const upscale = () =>
    findAction(groups(), "upscale-run") ?? findAction(groups(), "upscale-again");
  const ask = useItemMutation(item.id, "ask-change", {
    mutationFn: async ({ request, typed }: { request: string; typed: T }) => {
      const upscaling = upscale()?.onClick;
      const actions: ChangeAction[] = [
        ...(video ? [] : (["edit", "recreate"] as const)),
        "animate",
        ...(upscaling ? (["upscale"] as const) : []),
      ];
      return { answer: await askChange(item.jobId!, request, actions, typed, item.id), upscaling };
    },
    onSuccess: ({ answer, upscaling }) => {
      if (answer.reason) notifications.show({ message: answer.reason });
      else if (!review) {
        const proposal = answer.suggestions[0];
        run(proposal.prompt, proposal, upscaling);
      }
    },
  });
  function run(prompt: string, proposal: Change, upscaling: (() => void) | undefined) {
    const action = proposal.action;
    if (action === "upscale") upscaling?.();
    // An image's animation, as proposed, has Animate's writer word the request for the video
    // model; a prompt the person edited runs as they wrote it.
    else if (action === "animate" && !video && prompt.trim() === proposal.prompt.trim())
      iterate({ kind: "animate", theme: "custom", instruction: proposal.request });
    else
      iterate({
        kind: "prompt",
        prompt: prompt.trim(),
        operation:
          action === "edit" ? "refine" : action === "animate" && !video ? "animate" : "image",
        sameSeed: action === "recreate",
      });
    setChange(null);
  }
  return {
    available:
      Boolean(assistant.data?.available) &&
      item.status === "done" &&
      Boolean(item.url && item.jobId),
    pending: ask.isPending,
    proposal: change?.proposal,
    typed: change?.typed,
    send(request: string, text: T) {
      const typed = change?.typed ?? text;
      ask.mutate(
        { request: request.trim(), typed },
        {
          onSuccess: ({ answer }) => {
            if (answer.reason) return;
            const proposal = review ? answer.suggestions[0] : null;
            if (proposal) setChange({ proposal, typed });
            show(proposal);
          },
        },
      );
    },
    undo() {
      if (change) restore(change.typed);
      setChange(null);
    },
    run(prompt: string) {
      if (change) run(prompt, change.proposal, upscale()?.onClick);
    },
  };
}

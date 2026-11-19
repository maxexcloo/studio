import { notifications } from "@mantine/notifications";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { Change, ChangeAction } from "../../../../shared/suggestions";
import type { MediaItem } from "../../types";
import { assistantQuery } from "../generation/PromptAssistant";
import { askChange } from "../taste/suggestions";
import { useItemMutation } from "./useItemMutation";
import type { Iteration } from "./useMediaAction";

/** Writes a change to a finished result and queues the instructed action now or after review. */
export function useItemChange<T extends string>(
  item: MediaItem,
  {
    iterate,
    review,
    show,
    restore,
  }: {
    iterate: (iteration: Iteration) => void;
    review: boolean;
    show: (proposal: Change) => void;
    restore: (typed: T) => void;
  },
) {
  const video = item.type === "video";
  const assistant = useQuery(assistantQuery);
  const [change, setChange] = useState<{ proposal: Change; typed: T } | null>(null);
  const ask = useItemMutation(item.id, "ask-change", {
    mutationFn: async ({
      request,
      typed,
      action,
    }: {
      request: string;
      typed: T;
      action?: ChangeAction;
    }) => {
      const actions: ChangeAction[] = action
        ? [action]
        : video
          ? ["animate"]
          : ["edit", "recreate", "animate"];
      return askChange(item.jobId!, request, actions, typed, item.id);
    },
    onSuccess: (answer) => {
      if (answer.reason) notifications.show({ message: answer.reason });
      else if (!review) {
        const proposal = answer.suggestions[0];
        run(proposal.prompt, proposal);
      }
    },
  });
  function run(prompt: string, proposal: Change) {
    const action = proposal.action;
    // An image's animation, as proposed, has Animate's writer word the request for the video
    // model; a prompt the person edited runs as they wrote it.
    if (action === "animate" && !video && prompt.trim() === proposal.prompt.trim())
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
    send(request: string, text: T, action?: ChangeAction) {
      const typed = change?.typed ?? text;
      ask.mutate(
        { request: request.trim(), typed, action },
        {
          onSuccess: (answer) => {
            if (!review || answer.reason) return;
            const [proposal] = answer.suggestions;
            setChange({ proposal, typed });
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
      if (change) run(prompt, change.proposal);
    },
  };
}

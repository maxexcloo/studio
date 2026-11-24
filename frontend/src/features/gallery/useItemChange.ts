import { notifications } from "@mantine/notifications";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { Change, ChangeAction } from "../../../../shared/suggestions";
import type { MediaItem } from "../../types";
import { modelsQuery } from "../generation/GenerationProvider";
import { assistantQuery } from "../generation/PromptAssistant";
import { askChange } from "../taste/suggestions";
import { automaticEditProfile } from "./editProfile";
import { useItemMutation } from "./useItemMutation";
import type { Iteration } from "./useMediaAction";

/** Resolve the editor before writing, so the eventual edit runs with the same profile. */
export async function askItemChange(
  client: QueryClient,
  item: MediaItem,
  request: string,
  actions: ChangeAction[],
  prompt?: string,
  selectedEdit?: string,
) {
  const profileId = actions.includes("edit")
    ? selectedEdit ||
      automaticEditProfile((await client.ensureQueryData(modelsQuery)).profiles, item)?.id
    : undefined;
  const availableActions = profileId ? actions : actions.filter((action) => action !== "edit");
  if (!availableActions.length) throw new Error("No image model is ready for edits.");
  const answer = await askChange(
    item.jobId!,
    request,
    availableActions,
    prompt,
    item.id,
    profileId,
  );
  return { answer, profileId };
}

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
  const client = useQueryClient();
  const assistant = useQuery(assistantQuery);
  const [change, setChange] = useState<{
    proposal: Change;
    typed: T;
    profileId?: string;
    preview: boolean;
  } | null>(null);
  const ask = useItemMutation(item.id, "ask-change", {
    mutationFn: async ({
      request,
      typed,
      action,
      profileId,
    }: {
      request: string;
      typed: T;
      action?: ChangeAction;
      profileId?: string;
      preview: boolean;
    }) => {
      const actions: ChangeAction[] = action
        ? [action]
        : video
          ? ["animate"]
          : ["edit", "recreate", "animate"];
      return askItemChange(client, item, request, actions, typed, profileId);
    },
    onSuccess: ({ answer, profileId }, { preview }) => {
      if (answer.reason) notifications.show({ message: answer.reason });
      else if (!preview) {
        const proposal = answer.suggestions[0];
        run(proposal.prompt, proposal, profileId);
      }
    },
  });
  function run(prompt: string, proposal: Change, profileId?: string, preview = false) {
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
        sameSeed: action === "recreate" && !preview,
        ...(action === "edit" && { profileId, profileBackend: proposal.profileBackend }),
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
    previewing: change?.preview,
    send(request: string, text: T, action?: ChangeAction, editProfileId?: string, preview = false) {
      const typed = change?.typed ?? text;
      const profileId = action === "edit" ? editProfileId : undefined;
      ask.mutate(
        { request: request.trim(), typed, action, profileId, preview: review || preview },
        {
          onSuccess: ({ answer, profileId }) => {
            if ((!review && !preview) || answer.reason) return;
            const [proposal] = answer.suggestions;
            setChange({ proposal, typed, profileId, preview });
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
      if (change) run(prompt, change.proposal, change.profileId, change.preview);
    },
  };
}

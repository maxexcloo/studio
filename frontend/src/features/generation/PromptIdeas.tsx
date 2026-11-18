import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { maxSuggestions } from "../../../../shared/suggestions";
import type { MediaKind } from "../../types";
import type { Action } from "../../ui/ActionBar";
import { compareNames } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { useGroupFeature } from "../auth/AccountGate";
import { askPromptIdeas, promptIdeasQuery } from "../taste/suggestions";
import { UndoButton, suggested } from "./AskChange";

/**
 * Taste-led prompt ideas for an empty prompt: a Suggested tool, first in the prompt's AI menu, asked
 * for as that menu opens, with Refresh… for others. Picking one fills the prompt, with Undo beside
 * it until the prompt next changes.
 */
export function usePromptIdeas({
  kind,
  value,
  onChange,
}: {
  kind: MediaKind;
  value: string;
  onChange: (value: string) => void;
}) {
  const client = useQueryClient();
  const [asked, setAsked] = useState(false);
  const [picked, setPicked] = useState<{ before: string; after: string } | null>(null);
  // A group without Prompt Assistant gets no ideas, so they are never asked for.
  const offered = useGroupFeature("promptAssistant");
  const query = promptIdeasQuery(kind);
  const ideas = useQuery({ ...query, enabled: asked && offered });
  const refresh = useMutation({
    mutationFn: () => askPromptIdeas(kind, true),
    onSuccess: (answer) => client.setQueryData(query.queryKey, answer),
  });
  const list = [...(ideas.data?.suggestions ?? [])].slice(0, maxSuggestions).sort(compareNames);
  const loading = refresh.isPending || ((ideas.isPending || ideas.isFetching) && !list.length);
  const { options, again } = suggested(
    loading,
    list.map((idea) => ({
      id: `idea:${idea}`,
      label: idea,
      icon: icons.assistant,
      onClick: () => {
        setPicked({ before: value, after: idea });
        onChange(idea);
      },
    })),
    { onClick: () => refresh.mutate() },
  );
  return {
    // An account Studio has no ideas for yet (no taste to draw on) is offered none.
    tool:
      offered && !value.trim() && (loading || list.length > 0)
        ? ({
            id: "ideas",
            label: "Suggested",
            icon: icons.assistant,
            menu: [[...options, again]],
            onOpen: () => setAsked(true),
          } satisfies Action)
        : undefined,
    undo: picked && value === picked.after && (
      <UndoButton
        onClick={() => {
          onChange(picked.before);
          setPicked(null);
        }}
      />
    ),
  };
}

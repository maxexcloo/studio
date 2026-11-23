import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { maxSuggestions } from "../../../../shared/suggestions";
import type { GenerationInput, ReferenceAsset } from "../../types";
import type { Action } from "../../ui/ActionBar";
import { compareNames } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { useGroupFeature } from "../auth/AccountGate";
import { appliedCardIds } from "../characters/cardParts";
import { promptIdeasQuery } from "../taste/suggestions";
import { UndoButton, suggested } from "./AskChange";
import { assistantQuery } from "./PromptAssistant";

/** Taste-led ideas for an empty prompt or a draft with cards, applied only on selection. */
export function usePromptIdeas({
  input: { kind, prompt, cardParts },
  references,
  onChange,
  enabled,
}: {
  input: GenerationInput;
  references: ReferenceAsset[];
  onChange: (value: string) => void;
  enabled: boolean;
}) {
  const client = useQueryClient();
  const [picked, setPicked] = useState<{ before: string; after: string; label: string } | null>(
    null,
  );
  if (picked && prompt !== picked.after) setPicked(null);
  const current = picked?.after === prompt ? picked : null;
  const base = current?.before ?? prompt;

  const assistant = useQuery(assistantQuery);
  const mayUseAssistant = useGroupFeature("promptAssistant");
  const mayUseCards = useGroupFeature("characters");
  const cardIds = mayUseCards ? appliedCardIds(cardParts, base, references) : [];
  const cards = cardIds.length ? { cardIds, prompt: base } : undefined;
  const query = promptIdeasQuery(kind, cards);
  const ideas = useQuery({ ...query, enabled: false });
  function load(fresh = false) {
    const options = promptIdeasQuery(kind, cards, fresh);
    void client.fetchQuery({ ...options, ...(fresh && { staleTime: 0 }) }).catch(() => {});
  }
  const list = [...(ideas.data?.suggestions ?? [])]
    .slice(0, maxSuggestions)
    .sort((a, b) => compareNames(a.label, b.label));
  const { options, again } = suggested(
    ideas.isFetching,
    list.map((idea) => ({
      id: `idea:${idea.label}`,
      label: idea.label,
      onClick: () => {
        setPicked({ before: base, after: idea.prompt, label: idea.label });
        onChange(idea.prompt);
      },
    })),
    { onClick: () => load(true) },
    ideas.error?.message || ideas.data?.reason,
  );
  const offered =
    enabled && mayUseAssistant && assistant.data?.available && (cards || !prompt.trim());
  return {
    suggestions: offered
      ? {
          action: {
            id: "suggestions",
            label: "Suggestions",
            icon: icons.assistant,
            disabled: ideas.isFetching,
            loading: ideas.isFetching,
            menu: [
              ideas.isPending && !ideas.isFetching
                ? [{ id: "loading-suggestions", label: "Loading…", disabled: true }]
                : options,
            ],
          } satisfies Action,
          refresh: again,
        }
      : undefined,
    load,
    label: current?.label,
    undo: current && (
      <UndoButton
        onClick={() => {
          onChange(current.before);
          setPicked(null);
        }}
      />
    ),
  };
}

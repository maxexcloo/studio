import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { maxSuggestions } from "../../../../shared/suggestions";
import type { GenerationInput, ReferenceAsset } from "../../types";
import type { Action } from "../../ui/ActionBar";
import { compareNames } from "../../ui/DataTable";
import { useGroupFeature } from "../auth/AccountGate";
import { appliedCardIds } from "../characters/cardParts";
import { draftSuggestionContext, promptIdeasQuery } from "../taste/suggestions";
import { UndoButton, suggested } from "./AskChange";
import { assistantQuery } from "./PromptAssistant";

/** Taste-led ideas for an empty prompt or a draft with cards, applied only on selection. */
export function usePromptIdeas({
  input,
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
  const { prompt, cardParts } = input;
  const context = draftSuggestionContext(input, references);
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
  const query = promptIdeasQuery(context, cards);
  const ideas = useQuery({ ...query, enabled: false });
  function load(fresh = false) {
    const next = promptIdeasQuery(context, cards, fresh);
    void client.fetchQuery({ ...next, ...(fresh && { staleTime: 0 }) }).catch(() => {});
  }
  const options = [...(ideas.data?.suggestions ?? [])]
    .slice(0, maxSuggestions)
    .sort((a, b) => compareNames(a.label, b.label))
    .map((idea): Action => ({
      id: `idea:${idea.label}`,
      label: idea.label,
      onClick: () => {
        setPicked({ before: base, after: idea.prompt, label: idea.label });
        onChange(idea.prompt);
      },
    }));
  const offered =
    enabled && mayUseAssistant && assistant.data?.available && (cards || !prompt.trim());
  return {
    suggestions: offered
      ? {
          ...suggested(options, {
            loading: ideas.isFetching,
            answered: Boolean(ideas.data || ideas.error),
            failure: ideas.error?.message || ideas.data?.reason,
            onRefresh: () => load(true),
          }),
          load: () => load(),
        }
      : undefined,
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

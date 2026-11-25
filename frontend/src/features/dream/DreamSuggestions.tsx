import { ActionIcon, Menu } from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { VariationDirection } from "../../../../shared/suggestions";
import { menuWidth } from "../../theme";
import type { MediaItem } from "../../types";
import { type Action, ActionMenuItems, useActionMenuBounds } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { useStageComparison } from "../compare/variants";
import { useItemChange } from "../gallery/useItemChange";
import { typedPrompt, useMediaAction, useMediaIteration } from "../gallery/useMediaAction";
import { VariationDialog, keepAndVaryAction } from "../gallery/VariationDialog";
import {
  instructionTemplates,
  requestTool,
  suggestionItems,
  useChangeSuggestions,
} from "../generation/AskChange";
import { CustomDialog } from "../generation/CustomDialog";
import { assistantQuery } from "../generation/PromptAssistant";
import { askNextSteps, nextStepsQuery } from "../taste/suggestions";
import type { DeckCard } from "./deck";
import { sideControl, sideIconSize } from "./DeckButtons";
import { sideLabel } from "./PairCard";

interface DreamSuggestionsProps {
  card: DeckCard;
  side: number;
  onMore: () => void;
  /** Accepts the card, as Keep & Vary does once its variations are staged. */
  onKeep: () => void;
  onApplied?: () => void;
}

export function DreamSuggestions(props: DreamSuggestionsProps) {
  const { card, side } = props;
  const item = card.kind === "pair" || card.kind === "set" ? card.items[side] : card.item;
  return <ItemSuggestions key={item.id} item={item} {...props} />;
}

function ItemSuggestions({
  card,
  item,
  side,
  onMore,
  onKeep,
  onApplied,
}: DreamSuggestionsProps & { item: MediaItem }) {
  const stage = useStageComparison();
  const pair = card.kind === "pair" ? card.items : undefined;
  const canEditPair = pair?.every(
    (entry) => entry.type === "image" && entry.jobId && entry.settings?.profileId,
  );
  const compare = useMutation({ mutationFn: () => stage.again(pair!), onSuccess: onApplied });
  const [opened, setOpened] = useState(false);
  const [custom, setCustom] = useState(false);
  const [request, setRequest] = useState("");
  const assistant = useQuery(assistantQuery).data;
  const [varying, setVarying] = useState<VariationDirection | "explore">();
  const iteration = useMediaIteration(item);
  const prepare = useMediaAction(item, onApplied);
  const canExtend = item.type === "video" && item.status === "done" && Boolean(item.url);
  const change = useItemChange(item, {
    iterate: (next) => iteration.mutate(next),
    review: false,
    show: () => {},
    restore: () => {},
  });
  const prompt = typedPrompt(item);
  const canAskForMore = card.kind === "dream" && item.type === "image";
  const menuBounds = useActionMenuBounds(opened);
  const send = (request: string) => change.send(request, prompt);
  const suggestions = useChangeSuggestions({
    query: nextStepsQuery(item),
    fresh: () => askNextSteps(item, true),
    enabled: (opened || custom) && change.available,
    disabled: change.pending || iteration.isPending,
    onPick: custom ? setRequest : send,
  });
  const canVary =
    change.available &&
    Boolean(prompt.trim()) &&
    item.type === "image" &&
    (card.kind === "dream" || card.kind === "library");
  const more: Action[] = [
    ...(canVary ? [keepAndVaryAction(setVarying)] : []),
    ...(canAskForMore
      ? [
          {
            id: "more-like-this",
            label: "More Like This",
            icon: icons.moreLikeThis,
            onClick: onMore,
          },
        ]
      : []),
    ...(canEditPair
      ? [
          {
            id: "edit-comparison",
            label: "Edit Comparison",
            icon: icons.compare,
            onClick: () => compare.mutate(),
          },
        ]
      : []),
    ...(canExtend
      ? [
          {
            id: "extend",
            label: "Extend in Composer",
            icon: icons.extend,
            onClick: () => prepare.mutate({ operation: "extend" }),
          },
        ]
      : []),
  ];
  const loading = change.pending || iteration.isPending || compare.isPending || prepare.isPending;
  // Nothing to suggest for this result: the control greys out.
  const unavailable = !change.available && !more.length;
  const trigger = (
    <ActionIcon
      {...sideControl}
      data-touch-target
      aria-label="Suggestions"
      disabled={unavailable}
      loading={loading}
    >
      <icons.assistant size={sideIconSize} />
    </ActionIcon>
  );
  if (unavailable) return trigger;
  return (
    <>
      <Menu {...menuBounds} position="top-end" width={menuWidth} onChange={setOpened}>
        <PopupTooltip label="Suggestions">
          <Menu.Target>{trigger}</Menu.Target>
        </PopupTooltip>
        <Menu.Dropdown>
          <ActionMenuItems
            leading={
              change.available &&
              card.kind === "pair" && <Menu.Label>{sideLabel(card, side)}</Menu.Label>
            }
            groups={[
              ...(change.available
                ? [
                    suggestionItems(suggestions.action).map((option) => ({
                      ...option,
                      disabled: option.disabled || loading,
                    })),
                    [
                      {
                        id: "custom",
                        label: "Custom…",
                        icon: icons.custom,
                        disabled: loading,
                        onClick: () => setCustom(true),
                      },
                      suggestions.refresh,
                    ],
                  ]
                : []),
              more,
            ]}
          />
        </Menu.Dropdown>
      </Menu>
      {varying && (
        <VariationDialog
          item={item}
          direction={varying}
          prompt={prompt}
          onClose={() => setVarying(undefined)}
          onApplied={() => {
            onKeep();
            onApplied?.();
          }}
        />
      )}
      <CustomDialog
        opened={custom}
        title={item.type === "video" ? "Custom Animation" : "Custom Request"}
        draft={{ value: request, onChange: setRequest }}
        tools={[
          requestTool(
            instructionTemplates(
              (item.type === "video" ? assistant?.themes : assistant?.changes) ?? [],
              setRequest,
            ),
            suggestions,
          ),
        ]}
        action="Run"
        onClose={() => setCustom(false)}
        onSend={send}
      />
    </>
  );
}

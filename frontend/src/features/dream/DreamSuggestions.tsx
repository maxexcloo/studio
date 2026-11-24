import { ActionIcon, Menu, Tooltip } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { menuWidth } from "../../theme";
import type { MediaItem } from "../../types";
import { type Action, ActionMenuItems, useActionMenuBounds } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { useStageComparison } from "../compare/variants";
import { useItemChange } from "../gallery/useItemChange";
import { typedPrompt, useMediaAction, useMediaIteration } from "../gallery/useMediaAction";
import { suggestionItems, useChangeSuggestions } from "../generation/AskChange";
import { CustomDialog } from "../generation/CustomDialog";
import { askNextSteps, nextStepsQuery } from "../taste/suggestions";
import type { DeckCard } from "./deck";
import { sideControl, sideIconSize } from "./DeckButtons";
import { sideLabel } from "./PairCard";

interface DreamSuggestionsProps {
  card: DeckCard;
  side: number;
  onMore: () => void;
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
  const available = change.available && Boolean(prompt.trim());
  const canAskForMore = card.kind === "dream" && item.type === "image" && Boolean(prompt.trim());
  const menuBounds = useActionMenuBounds(opened, false);
  const send = (request: string) => change.send(request, prompt);
  const suggestions = useChangeSuggestions({
    query: nextStepsQuery(item.jobId!, undefined, item.id),
    fresh: () => askNextSteps(item.jobId!, true, undefined, item.id),
    enabled: opened && available,
    disabled: change.pending || iteration.isPending,
    onPick: send,
  });
  const more: Action[] = [
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
  const unavailable = !available && !more.length && "Suggestions are unavailable for this result.";
  const trigger = (
    <ActionIcon
      {...sideControl}
      data-touch-target
      aria-label="Suggestions"
      aria-disabled={Boolean(unavailable) || undefined}
      aria-description={unavailable || undefined}
      data-disabled={Boolean(unavailable) || undefined}
      loading={loading}
    >
      <icons.assistant size={sideIconSize} />
    </ActionIcon>
  );
  if (unavailable) return <Tooltip label={unavailable}>{trigger}</Tooltip>;
  return (
    <>
      <Menu {...menuBounds} position="top-end" width={menuWidth} onChange={setOpened}>
        <PopupTooltip label="Suggestions">
          <Menu.Target>{trigger}</Menu.Target>
        </PopupTooltip>
        <Menu.Dropdown>
          <ActionMenuItems
            leading={
              available && card.kind === "pair" && <Menu.Label>{sideLabel(card, side)}</Menu.Label>
            }
            groups={[
              ...(available
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
      <CustomDialog
        opened={custom}
        title="Custom Change"
        action="Run"
        onClose={() => setCustom(false)}
        onSend={send}
      />
    </>
  );
}

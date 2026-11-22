import { ActionIcon, Menu, Tooltip } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { menuWidth } from "../../theme";
import { ActionMenuItems } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { useStageComparison } from "../compare/variants";
import { useItemChange } from "../gallery/useItemChange";
import { typedPrompt, useMediaIteration } from "../gallery/useMediaAction";
import { useChangeSuggestions } from "../generation/AskChange";
import { askNextSteps, nextStepsQuery } from "../taste/suggestions";
import type { DeckCard } from "./deck";
import { sideLabel } from "./PairCard";

export function DreamSuggestions({
  card,
  side,
  onMore,
}: {
  card: DeckCard;
  side: number;
  onMore: () => void;
}) {
  const item = card.kind === "pair" || card.kind === "set" ? card.items[side] : card.item;
  const stage = useStageComparison();
  const pair = card.kind === "pair" ? card.items : undefined;
  const canEditPair = pair?.every(
    (entry) => entry.type === "image" && entry.jobId && entry.settings?.profileId,
  );
  const compare = useMutation({ mutationFn: () => stage.again(pair!) });
  const [opened, setOpened] = useState(false);
  const iteration = useMediaIteration(item);
  const change = useItemChange(item, {
    iterate: (next) => iteration.mutate(next),
    review: false,
    show: () => {},
    restore: () => {},
  });
  const prompt = typedPrompt(item);
  const available = change.available && Boolean(prompt.trim());
  const canAskForMore = card.kind === "dream" && item.type === "image" && Boolean(prompt.trim());
  const suggestions = useChangeSuggestions({
    query: nextStepsQuery(item.jobId!, undefined, item.id),
    fresh: () => askNextSteps(item.jobId!, true, undefined, item.id),
    enabled: opened && available,
    disabled: change.pending || iteration.isPending,
    limit: 3,
    onPick: (request) => change.send(request, prompt),
  });
  const loading = change.pending || iteration.isPending || compare.isPending;
  const unavailable =
    !available && !canEditPair && !canAskForMore && "Suggestions are unavailable for this result.";
  const trigger = (
    <ActionIcon
      variant="default"
      radius="xl"
      size="md"
      aria-label="Suggestions"
      aria-disabled={Boolean(unavailable) || undefined}
      aria-description={unavailable || undefined}
      data-disabled={Boolean(unavailable) || undefined}
      loading={loading}
    >
      <icons.assistant size={18} />
    </ActionIcon>
  );
  if (unavailable) return <Tooltip label={unavailable}>{trigger}</Tooltip>;
  return (
    <Menu position="top-end" width={menuWidth} onChange={setOpened}>
      <PopupTooltip label="Suggestions">
        <Menu.Target>{trigger}</Menu.Target>
      </PopupTooltip>
      <Menu.Dropdown>
        {available && (
          <>
            {card.kind === "pair" && <Menu.Label>{sideLabel(card, side)}</Menu.Label>}
            <ActionMenuItems groups={suggestions.action.menu!} />
          </>
        )}
        {canEditPair && (
          <>
            {available && <Menu.Divider />}
            <Menu.Item leftSection={<icons.compare size={16} />} onClick={() => compare.mutate()}>
              Edit Comparison
            </Menu.Item>
          </>
        )}
        {canAskForMore && (
          <>
            {available && <Menu.Divider />}
            <Menu.Item leftSection={<icons.moreLikeThis size={16} />} onClick={onMore}>
              More Like This
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

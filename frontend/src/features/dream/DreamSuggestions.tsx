import { ActionIcon, Menu } from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { ChangeAction, VariationDirection } from "../../../../shared/suggestions";
import { menuWidth } from "../../theme";
import type { MediaItem } from "../../types";
import { type Action, ActionMenuItems, useActionMenuBounds } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { useStageComparison } from "../compare/variants";
import { AnimateDialog } from "../gallery/AnimateDialog";
import { useItemChange } from "../gallery/useItemChange";
import {
  type AnimateRequest,
  animateProfileQuery,
  typedPrompt,
  useAnimateModifiers,
  useAnimateReview,
  useAnimateTemplates,
  useMediaAction,
  useMediaIteration,
} from "../gallery/useMediaAction";
import { VariationDialog, keepAndVaryAction } from "../gallery/VariationDialog";
import {
  assistMenu,
  instructionTemplates,
  requestTool,
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
  const [requestActions, setRequestActions] = useState<ChangeAction[]>();
  const [animating, setAnimating] = useState<AnimateRequest>();
  const modifiers = useAnimateModifiers();
  const [review] = useAnimateReview();
  const animateProfile = useQuery({
    ...animateProfileQuery(item),
    enabled: opened && item.status === "done" && Boolean(item.url),
  });
  const themes = useAnimateTemplates(animateProfile.data?.sound);

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
  const send = (request: string, actions?: ChangeAction[]) => change.send(request, prompt, actions);
  const setSuggested = (text: string) => {
    setRequestActions(undefined);
    setRequest(text);
  };
  const animate = (theme: string) => {
    const choice = { theme, modifiers: modifiers.ticked };
    if (review) setAnimating(choice);
    else iteration.mutate({ kind: "animate", ...choice });
  };
  const suggestions = useChangeSuggestions({
    query: nextStepsQuery(item),
    fresh: () => askNextSteps(item, true),
    enabled: (opened || custom) && change.available,
    disabled: change.pending || iteration.isPending,
    onPick: custom ? setSuggested : send,
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
  const templates = [
    ...(item.type === "image" ? instructionTemplates(assistant?.changes ?? [], send) : []),
    ...themes
      .filter((theme) => theme.id !== "custom")
      .map((theme): Action => ({
        id: `animate:${theme.id}`,
        label: theme.label,
        description: theme.description,
        marker: theme.uncensored ? icons.uncensored : undefined,
        disabled: !animateProfile.data,
        onClick: () => animate(theme.id),
      })),
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
                ? assistMenu({
                    suggestions,
                    templates,
                    custom: [
                      {
                        id: "custom",
                        label: item.type === "video" ? "Rewrite Video Prompt…" : "Custom…",
                        icon: icons.custom,
                        disabled: loading,
                        onClick: () => setCustom(true),
                      },
                    ],
                    last: [],
                  })
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
      {animating && (
        <AnimateDialog item={item} {...animating} onClose={() => setAnimating(undefined)} />
      )}
      <CustomDialog
        opened={custom}
        title={item.type === "video" ? "Rewrite Video Prompt" : "Custom Request"}
        draft={{ value: request, onChange: setRequest }}
        tools={[
          requestTool(
            instructionTemplates(
              item.type === "image" ? (assistant?.changes ?? []) : [],
              (text, actions) => {
                setRequest(text);
                setRequestActions(actions);
              },
            ),
            suggestions,
          ),
        ]}
        action="Run"
        onClose={() => setCustom(false)}
        onSend={(text) => send(text, requestActions)}
      />
    </>
  );
}

import { Box } from "@mantine/core";
import { type Ref, type RefObject, useState } from "react";

import type { MediaItem } from "../../types";
import { ActionBarGroups, ActionBarSurface, type ActionGroups } from "../../ui/ActionBar";
import { usePhone } from "../../ui/usePhone";
import { AnimateDialog } from "./AnimateDialog";
import { namedItemActions } from "./itemActions";
import { useMediaActions } from "./MediaActions";
import { useMediaTransfer } from "./mediaShare";
import type { AnimateRequest, Iteration } from "./useMediaAction";
import { TrimVideoDialog } from "./videoEdits";
import { ViewerPrompt, useViewerPrompt } from "./ViewerPrompt";

import classes from "./MediaViewer.module.css";

/** A viewer bar of the opening surface's own actions in place of the item's (Dream's verdicts). */
export interface ViewerActions {
  /** The bar's accessible name. */
  label: string;
  groups: ActionGroups;
  /** The actions named beside their icons. */
  labelled: string[];
}

/**
 * The bar's controls in groups on one row, phones naming them under their icons. Every one stays
 * in sight: where they outgrow the bar the last named ones show as icons alone, and only then do
 * they wrap onto another row.
 */
export function ViewerActionGroups({ groups, labelled }: Omit<ViewerActions, "label">) {
  return <ActionBarGroups groups={groups} labelled={labelled} fit stacked={usePhone()} />;
}

/** The viewer's action bar: the prompt field above the shared item actions. */
export function MediaViewerActions({
  item,
  compare,
  iterate,
  pending,
  onApplied,
  onCompare,
  onDelete,
  onRetried,
  onVersionChange,
  shortcuts,
  ref,
  promptHidden,
}: {
  item: MediaItem;
  compare: boolean;
  iterate: (iteration: Iteration) => void;
  /** The run being queued from this item. */
  pending?: Iteration;
  onApplied: () => void;
  onCompare: () => void;
  onDelete: () => void;
  onRetried: (jobId: string) => void;
  onVersionChange: (id: string, active: boolean) => void;
  /** Holds the current actions for the viewer's keyboard shortcuts. */
  shortcuts?: RefObject<ActionGroups>;
  /** The bar, which the phone details sheet stays above. */
  ref?: Ref<HTMLDivElement>;
  /** Hides the prompt field, keeping what was typed (the phone details sheet). */
  promptHidden?: boolean;
}) {
  const transfer = useMediaTransfer(item, true);
  const [animating, setAnimating] = useState<AnimateRequest | null>(null);
  const [trimming, setTrimming] = useState(false);
  const itemGroups = useMediaActions(item, {
    transfer,
    compare,
    iterate,
    onApplied,
    onCompare,
    onAnimate: setAnimating,
    onDelete,
    onRetried,
    onTrim: () => setTrimming(true),
    onVersionChange,
  });
  const prompt = useViewerPrompt(item, { groups: itemGroups, iterate });
  // Edit opens with the prompt's assistance, before the item's own edits.
  const ai = prompt.ai;
  const groups = ai
    ? itemGroups.map((group) =>
        group.map((action) =>
          action.id === "edit"
            ? {
                ...action,
                loading: action.loading || ai.loading,
                menu: [...ai.menu!, ...action.menu!],
              }
            : action,
        ),
      )
    : itemGroups;
  if (shortcuts) shortcuts.current = itemGroups;
  return (
    <ActionBarSurface
      ref={ref}
      aria-label="Generation Actions"
      radius="lg"
      className={classes.actions}
      onClick={(event) => event.stopPropagation()}
    >
      {item.jobId && (
        <Box className={classes.promptRow} display={promptHidden ? "none" : undefined}>
          <ViewerPrompt state={prompt} iterate={iterate} pending={pending} />
        </Box>
      )}
      <ViewerActionGroups groups={groups} labelled={namedItemActions} />
      {animating && (
        <AnimateDialog
          item={item}
          iterate={iterate}
          {...animating}
          onClose={() => setAnimating(null)}
        />
      )}
      {trimming && <TrimVideoDialog item={item} onClose={() => setTrimming(false)} />}
    </ActionBarSurface>
  );
}

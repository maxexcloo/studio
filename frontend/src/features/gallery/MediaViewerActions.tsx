import { Box } from "@mantine/core";
import { type Ref, type RefObject, useRef } from "react";

import type { MediaItem } from "../../types";
import { ActionBarGroups, ActionBarSurface, type ActionGroups } from "../../ui/ActionBar";
import { usePhone } from "../../ui/usePhone";
import { compactViewerActions, namedItemActions } from "./itemActions";
import { useMediaActions, useMediaDialogs } from "./MediaActions";
import { useMediaTransfer } from "./mediaShare";
import type { Iteration } from "./useMediaAction";
import { ViewerPrompt, useViewerPrompt } from "./ViewerPrompt";

import classes from "./MediaViewer.module.css";

/** A viewer bar of the opening surface's own actions in place of the item's (Dream's verdicts). */
export interface ViewerActions {
  /** The bar's accessible name. */
  label: string;
  groups: ActionGroups;
  /** The actions named beside their icons. */
  labelled: string[];
  /** Keep every choice named and equally wide. */
  equal?: boolean;
}

/**
 * Ordinary item bars use icons alone on phones; equal vote bars keep their names. Controls stay
 * in sight by dropping the last names where they outgrow the bar, then wrapping if needed.
 */
export function ViewerActionGroups({ groups, labelled, equal }: Omit<ViewerActions, "label">) {
  const phone = usePhone();
  return (
    <ActionBarGroups
      groups={phone && !equal ? compactViewerActions(groups) : groups}
      labelled={labelled}
      fit={!equal}
      stacked={phone}
      equal={equal}
    />
  );
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
  const { handlers, dialogs } = useMediaDialogs(item, iterate);
  // Edit's changes run through the viewer's own actions (an Upscale), read once they exist.
  const current = useRef<ActionGroups>([]);
  const prompt = useViewerPrompt(item, { groups: () => current.current, iterate });
  const groups = useMediaActions(item, {
    transfer,
    compare,
    edit: prompt.edit,
    iterate,
    onApplied,
    onCompare,
    onDelete,
    onRetried,
    ...handlers,
    onVersionChange,
  });
  current.current = groups;
  if (shortcuts) shortcuts.current = groups;
  return (
    <ActionBarSurface
      ref={ref}
      aria-label="Generation Actions"
      radius="lg"
      className={classes.actions}
      onClick={(event) => event.stopPropagation()}
    >
      {item.jobId && (
        <Box className={classes.promptRow} miw={0} display={promptHidden ? "none" : undefined}>
          <ViewerPrompt state={prompt} iterate={iterate} pending={pending} />
        </Box>
      )}
      <ViewerActionGroups groups={groups} labelled={namedItemActions} />
      {dialogs}
    </ActionBarSurface>
  );
}

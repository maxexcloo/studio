import { Box } from "@mantine/core";
import { type RefObject } from "react";

import type { MediaItem } from "../../types";
import { ActionBarGroups, ActionBarSurface, type ActionGroups } from "../../ui/ActionBar";
import { usePhone } from "../../ui/usePhone";
import { namedItemActions } from "./itemActions";
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
      groups={groups}
      labelled={labelled}
      fit={!equal}
      stacked={phone}
      equal={equal}
    />
  );
}

interface ItemActionsProps {
  item: MediaItem;
  compare: boolean;
  iterate: (iteration: Iteration, onQueued?: () => void) => void;
  promptDrafts: Map<string, string>;
  /** The run being queued from this item. */
  pending?: Iteration;
  onApplied: () => void;
  onCompare: () => void;
  onDelete: () => void;
  onReportQueued: (jobId: string) => void;
  onRetried: (jobId: string) => void;
  onVersionChange: (id: string, active: boolean) => void;
  /** Holds the current actions for the viewer's keyboard shortcuts. */
  shortcuts?: RefObject<ActionGroups>;
}

/**
 * The viewer's action bar: the prompt field above the shared item actions. The bar stays as the
 * viewer steps; its contents start afresh for each item, so a draft or a pending change stays
 * with the item it began on.
 */
export function MediaViewerActions(props: ItemActionsProps) {
  return (
    <ActionBarSurface
      aria-label="Generation Actions"
      data-viewer-actions
      radius="lg"
      className={classes.actions}
      onClick={(event) => event.stopPropagation()}
    >
      <ItemActions key={props.item.id} {...props} />
    </ActionBarSurface>
  );
}

function ItemActions({
  item,
  compare,
  iterate,
  promptDrafts,
  pending,
  onApplied,
  onCompare,
  onDelete,
  onReportQueued,
  onRetried,
  onVersionChange,
  shortcuts,
}: ItemActionsProps) {
  const transfer = useMediaTransfer(item, true);
  const { handlers, dialogs } = useMediaDialogs(item, iterate, onReportQueued);
  const prompt = useViewerPrompt(item, iterate, promptDrafts);
  const groups = useMediaActions(item, {
    transfer,
    compare,
    draft: prompt.draft,
    iterate,
    onApplied,
    onCompare,
    onDelete,
    onRetried,
    ...handlers,
    onVersionChange,
    retryInStage: !item.url,
  });
  if (shortcuts) shortcuts.current = groups;
  return (
    <>
      {item.jobId && (
        <Box className={classes.promptRow} miw={0}>
          <ViewerPrompt state={prompt} iterate={iterate} pending={pending} />
        </Box>
      )}
      <ViewerActionGroups groups={groups} labelled={namedItemActions} />
      {dialogs}
    </>
  );
}

import { useState, type Ref, type RefObject } from "react";
import type { MediaItem } from "../../types";
import { Box } from "@mantine/core";
import { usePhone, useTouch } from "../../ui/usePhone";
import { ActionBarGroups, ActionBarSurface, type ActionGroups } from "./ActionBar";
import { AnimateDialog } from "./AnimateDialog";
import { useMediaActions } from "./MediaActions";
import { useMediaTransfer } from "./mediaShare";
import type { AnimateTheme, Iteration } from "./useMediaAction";
import { TrimVideoDialog } from "./videoEdits";
import { ViewerPrompt } from "./ViewerPrompt";
import classes from "./MediaViewer.module.css";

// Desktop names Animate, Edit, Upscale, Copy and Download beside their icons; phones show every
// action as an icon.
const labelled = ["animate", "edit", "upscale", "copy", "download"];

/** A viewer bar of the opening surface's own actions in place of the item's (Dream's verdicts). */
export interface ViewerActions {
  /** The bar's accessible name. */
  label: string;
  groups: ActionGroups;
  /** The actions named beside their icons. */
  labelled: string[];
}

/**
 * The bar's controls in divided groups. Phones and touch screens, whose touch targets outgrow the
 * bar, show every one, wrapping onto another row rather than scrolling actions out of sight.
 */
export function ViewerActionGroups({ groups, labelled }: Omit<ViewerActions, "label">) {
  const phone = usePhone();
  const touch = useTouch();
  return <ActionBarGroups groups={groups} labelled={labelled} wrap={phone || touch} />;
}

/** The viewer's action bar: the prompt field above the shared item actions. */
export function MediaViewerActions({
  item,
  sessionId,
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
  sessionId?: string;
  compare: boolean;
  iterate: (iteration: Iteration) => void;
  /** The run being queued from here. */
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
  const phone = usePhone();
  const transfer = useMediaTransfer(item, true);
  const [animating, setAnimating] = useState<AnimateTheme | null>(null);
  const [trimming, setTrimming] = useState(false);
  const groups = useMediaActions(item, {
    transfer,
    sessionId,
    compare,
    iterate,
    iterating: pending?.kind,
    onApplied,
    onCompare,
    // Compare shows in menus and the selection bar, not under the open item.
    omit: ["compare"],
    onAnimate: setAnimating,
    onDelete,
    onRetried,
    onTrim: () => setTrimming(true),
    onVersionChange,
  });
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
        <Box className={classes.promptRow} display={promptHidden ? "none" : undefined}>
          <ViewerPrompt
            key={item.id}
            item={item}
            groups={groups}
            iterate={iterate}
            pending={pending}
            onApplied={onApplied}
          />
        </Box>
      )}
      <ViewerActionGroups
        // Desktop's prompt field carries Continue in Chat.
        groups={
          phone ? groups : groups.map((group) => group.filter((action) => action.id !== "chat"))
        }
        labelled={phone ? [] : labelled}
      />
      {animating && (
        <AnimateDialog
          item={item}
          sessionId={sessionId}
          iterate={iterate}
          theme={animating}
          onClose={() => setAnimating(null)}
        />
      )}
      {trimming && <TrimVideoDialog item={item} onClose={() => setTrimming(false)} />}
    </ActionBarSurface>
  );
}

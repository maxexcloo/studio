import { useState, type Ref, type RefObject } from "react";
import type { MediaItem } from "../../types";
import { Box } from "@mantine/core";
import { usePhone } from "../../ui/usePhone";
import { ActionBarGroups, ActionBarSurface, type ActionGroups } from "../../ui/ActionBar";
import { AnimateDialog } from "./AnimateDialog";
import { useMediaActions } from "./MediaActions";
import { useMediaTransfer } from "./mediaShare";
import type { AnimateTheme, Iteration } from "./useMediaAction";
import { TrimVideoDialog } from "./videoEdits";
import { useViewerPrompt, ViewerPrompt } from "./ViewerPrompt";
import classes from "./MediaViewer.module.css";

// Desktop names Animate, Edit, AI, Upscale, Copy, Download and Similar beside their icons. Phones
// show every action as a compact icon on one row.
const labelled = ["animate", "edit", "ai", "upscale", "copy", "download", "similar"];

/** A viewer bar of the opening surface's own actions in place of the item's (Dream's verdicts). */
export interface ViewerActions {
  /** The bar's accessible name. */
  label: string;
  groups: ActionGroups;
  /** The actions named beside their icons. */
  labelled: string[];
}

/**
 * The bar's controls in groups on one row. Every one stays in sight: where they outgrow the bar
 * the last named ones show as icons alone, and only then do they wrap onto another row.
 */
export function ViewerActionGroups({ groups, labelled }: Omit<ViewerActions, "label">) {
  return <ActionBarGroups groups={groups} labelled={labelled} fit />;
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
  const phone = usePhone();
  const transfer = useMediaTransfer(item, true);
  const [animating, setAnimating] = useState<AnimateTheme | null>(null);
  const [trimming, setTrimming] = useState(false);
  const itemGroups = useMediaActions(item, {
    transfer,
    compare,
    iterate,
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
  const prompt = useViewerPrompt(item, { groups: itemGroups, iterate });
  // AI follows Edit: the prompt's assistance, beside the item's own iterations.
  const groups = prompt.ai
    ? itemGroups.map((group) => {
        const edit = group.findIndex((action) => action.id === "edit");
        return edit < 0
          ? group
          : [...group.slice(0, edit + 1), prompt.ai!, ...group.slice(edit + 1)];
      })
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
      {phone ? (
        <ActionBarGroups groups={groups} compact />
      ) : (
        <ViewerActionGroups groups={groups} labelled={labelled} />
      )}
      {animating && (
        <AnimateDialog
          item={item}
          iterate={iterate}
          theme={animating}
          onClose={() => setAnimating(null)}
        />
      )}
      {trimming && <TrimVideoDialog item={item} onClose={() => setTrimming(false)} />}
    </ActionBarSurface>
  );
}

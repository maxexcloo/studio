import { useState, type RefObject } from "react";
import type { MediaItem } from "../../types";
import { usePhone } from "../../ui/usePhone";
import {
  ActionBarGroups,
  ActionBarSurface,
  StackedActionBar,
  type ActionGroups,
} from "./ActionBar";
import { CustomAnimationDialog, useMediaActions } from "./MediaActions";
import { useMediaTransfer } from "./mediaShare";
import { UpscaleDialog } from "./UpscaleControls";
import type { Iteration } from "./useMediaAction";
import classes from "./MediaViewer.module.css";

// Phones keep these on the bar, in this order; the rest open from More.
const phonePrimary = ["retry", "stop", "edit", "animate", "prompt", "upscale"];

/** The viewer's action bar: the shared item actions. */
export function MediaViewerActions({
  item,
  sessionId,
  compare,
  iterate,
  iterating,
  onApplied,
  onCompare,
  onDelete,
  onRetried,
  onVersionChange,
  shortcuts,
}: {
  item: MediaItem;
  sessionId?: string;
  compare: boolean;
  iterate: (iteration: Iteration) => void;
  iterating?: Iteration["kind"];
  onApplied: () => void;
  onCompare: () => void;
  onDelete: () => void;
  onRetried: (jobId: string) => void;
  onVersionChange: (id: string, active: boolean) => void;
  /** Holds the current actions for the viewer's keyboard shortcuts. */
  shortcuts?: RefObject<ActionGroups>;
}) {
  const phone = usePhone();
  const transfer = useMediaTransfer(item, true);
  const [instructing, setInstructing] = useState(false);
  const [upscaling, setUpscaling] = useState(false);
  const groups = useMediaActions(item, {
    transfer,
    sessionId,
    compare,
    iterate,
    iterating,
    onApplied,
    onCompare,
    // Compare shows in menus and the selection bar, not under the open item.
    omit: ["compare"],
    onCustomAnimation: () => setInstructing(true),
    onDelete,
    onRetried,
    onUpscale: () => setUpscaling(true),
    onVersionChange,
  });
  if (shortcuts) shortcuts.current = groups;
  return (
    <ActionBarSurface
      aria-label="Generation Actions"
      className={classes.actions}
      onClick={(event) => event.stopPropagation()}
    >
      {phone ? (
        <StackedActionBar
          primary={phonePrimary.flatMap((id) => groups.flat().filter((action) => action.id === id))}
          more={groups.map((group) => group.filter((action) => !phonePrimary.includes(action.id)))}
        />
      ) : (
        <ActionBarGroups groups={groups} />
      )}
      <CustomAnimationDialog
        item={item}
        sessionId={sessionId}
        iterate={iterate}
        opened={instructing}
        onClose={() => setInstructing(false)}
      />
      {item.status === "done" && (
        <UpscaleDialog item={item} opened={upscaling} onClose={() => setUpscaling(false)} />
      )}
    </ActionBarSurface>
  );
}

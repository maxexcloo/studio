import { useState, type Ref, type RefObject } from "react";
import type { MediaItem } from "../../types";
import { usePhone } from "../../ui/usePhone";
import {
  ActionBarGroups,
  ActionBarSurface,
  StackedActionBar,
  type ActionGroups,
} from "./ActionBar";
import { AnimateDialog, useMediaActions } from "./MediaActions";
import { useMediaTransfer } from "./mediaShare";
import { UpscaleDialog } from "./UpscaleControls";
import type { AnimateTheme, Iteration } from "./useMediaAction";
import { TrimVideoDialog } from "./videoEdits";
import { ViewerPrompt } from "./ViewerPrompt";
import classes from "./MediaViewer.module.css";

// Desktop names Animate, Edit, Recreate and Upscale beside their icons; phones keep Retry or Stop,
// Animate, Edit and Recreate on the bar, labelled under their icons, and list the rest under More.
const labelled = ["animate", "edit", "recreate", "upscale"];
const primary = ["retry", "stop", "animate", "edit", "recreate"];

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
}) {
  const phone = usePhone();
  const transfer = useMediaTransfer(item, true);
  const [animating, setAnimating] = useState<AnimateTheme | null>(null);
  const [upscaling, setUpscaling] = useState(false);
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
    onUpscale: () => setUpscaling(true),
    onVersionChange,
  });
  if (shortcuts) shortcuts.current = groups;
  const primaries = primary.flatMap((id) => groups.flat().filter((action) => action.id === id));
  const more = groups.map((group) => group.filter((action) => !primary.includes(action.id)));
  // Desktop's prompt field carries Continue in Chat.
  const bar = groups.map((group) => group.filter((action) => action.id !== "chat"));
  return (
    <ActionBarSurface
      ref={ref}
      aria-label="Generation Actions"
      radius="lg"
      className={classes.actions}
      onClick={(event) => event.stopPropagation()}
    >
      {item.jobId && (
        <ViewerPrompt
          key={item.id}
          item={item}
          groups={groups}
          iterate={iterate}
          pending={pending}
          onApplied={onApplied}
        />
      )}
      {phone ? (
        <StackedActionBar primary={primaries} more={more} />
      ) : (
        <ActionBarGroups groups={bar} labelled={labelled} />
      )}
      {animating && (
        <AnimateDialog
          item={item}
          sessionId={sessionId}
          iterate={iterate}
          theme={animating}
          onClose={() => setAnimating(null)}
        />
      )}
      {item.status === "done" && (
        <UpscaleDialog item={item} opened={upscaling} onClose={() => setUpscaling(false)} />
      )}
      {trimming && <TrimVideoDialog item={item} onClose={() => setTrimming(false)} />}
    </ActionBarSurface>
  );
}

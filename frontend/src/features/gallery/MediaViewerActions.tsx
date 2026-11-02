import { useState, type Ref, type RefObject } from "react";
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
import { TrimVideoDialog } from "./videoEdits";
import { ViewerPrompt } from "./ViewerPrompt";
import classes from "./MediaViewer.module.css";

// The labelled primaries, in this order; the rest follow as icons (phones: under More).
const primary = ["retry", "stop", "edit", "animate", "prompt"];

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
  const [instructing, setInstructing] = useState(false);
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
    onCustomAnimation: () => setInstructing(true),
    onDelete,
    onRetried,
    onTrim: () => setTrimming(true),
    onUpscale: () => setUpscaling(true),
    onVersionChange,
  });
  if (shortcuts) shortcuts.current = groups;
  const primaries = primary.flatMap((id) => groups.flat().filter((action) => action.id === id));
  // Desktop's prompt field carries Continue in Chat; phones list it under More.
  const rest = groups.map((group) =>
    group.filter((action) => !primary.includes(action.id) && (phone || action.id !== "chat")),
  );
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
        <StackedActionBar primary={primaries} more={rest} />
      ) : (
        <ActionBarGroups groups={[primaries, ...rest]} labelled={primary} />
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
      {trimming && <TrimVideoDialog item={item} onClose={() => setTrimming(false)} />}
    </ActionBarSurface>
  );
}

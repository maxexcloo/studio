import { Paper, Transition } from "@mantine/core";
import { useClickOutside, useDisclosure, useMergedRef } from "@mantine/hooks";
import { type CSSProperties, memo, useEffect, useId, useRef, useState } from "react";

import { api, failure } from "../../api";
import type { MediaKind, ReferenceAsset } from "../../types";
import { useMotionDuration } from "../../ui/Appearance";
import { closingPopup, layerAbove, popupLayer } from "../../ui/popupClicks";
import { TextEntrySheet } from "../../ui/TextEntrySheet";
import { useKeyboard, useTypingIn } from "../../ui/useKeyboard";
import { usePhone, useTouch } from "../../ui/usePhone";
import { ComposerPromptProvider, GenerationForm } from "./GenerationForm";
import { galleryReferenceType, useGalleryReference, useReferenceFiles } from "./references";

import classes from "./ComposerDock.module.css";
const composerLayers = `[role="dialog"], [data-composer-layer], ${popupLayer}`;
/**
 * The gallery's generation composer; it answers `useOpenComposer` and shared images. The gallery
 * passes what it needs from its history state, so stepping through the viewer doesn't render it.
 */
export const ComposerDock = memo(function ComposerDock({
  compose,
  shared,
  opening,
  onDropState,
  onKindChange,
  onCompared,
}: {
  /** Keeps the composer open (`?compose=1`) until it closes. */
  compose: boolean;
  /** An image shared to the installed app. */
  shared: string;
  /** The key of a navigation from `useOpenComposer`, asking the composer to open. */
  opening: string;
  onDropState: (name: "compose" | "shared") => void;
  onKindChange: (kind: MediaKind) => void;
  onCompared: (comparisonId: string) => void;
}) {
  const [opened, { open, close }] = useDisclosure(compose);
  // The compact bar stays under the expanded panel until it has slid in, so nothing blinks and
  // keystrokes typed meanwhile land in the shared draft.
  const [expanded, setExpanded] = useState(opened);
  const [compactFocused, setCompactFocused] = useState(false);
  // Exactly one prompt is exposed: the compact bar until the panel has slid in or taken focus.
  const handingOver = opened && !expanded && compactFocused;
  const phone = usePhone();
  const motionDuration = useMotionDuration();
  const dock = useRef<HTMLDivElement>(null);
  const returningFocus = useRef(false);
  const tabbing = useRef(false);
  const focusIntent = useRef("[data-profile-picker]");
  const [dragging, setDragging] = useState(false);
  const reference = useGalleryReference();
  const placement = useReferenceFiles();
  const { uploadFiles } = placement;
  function pasteReferences(event: React.ClipboardEvent<HTMLElement>) {
    if (
      event.defaultPrevented ||
      ![...event.clipboardData.files].some((file) => file.type.startsWith("image/"))
    )
      return;
    event.preventDefault();
    void uploadFiles([...event.clipboardData.files]);
  }
  function dragReferences(event: React.DragEvent<HTMLElement>) {
    if (event.defaultPrevented) return;
    if (
      event.dataTransfer.types.includes(galleryReferenceType) ||
      event.dataTransfer.types.includes("Files")
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDragging(true);
    }
  }
  function dropReferences(event: React.DragEvent<HTMLElement>) {
    if (event.defaultPrevented) return;
    if (event.dataTransfer.files.length) {
      event.preventDefault();
      setDragging(false);
      void uploadFiles([...event.dataTransfer.files]);
      return;
    }
    const data = event.dataTransfer.getData(galleryReferenceType);
    if (!data) return;
    event.preventDefault();
    setDragging(false);
    try {
      reference.mutate(JSON.parse(data));
    } catch (error) {
      failure(error);
    }
  }
  const controlsId = useId();
  // Phones type in the Generate sheet instead, so the dock stays put there. On other touch screens
  // (a phone held sideways, a tablet) only typing in the dock lifts it above the keyboard, and the
  // open panel fits the room left above it (`--dock-room`); a desktop keeps its own scroll.
  const touch = useTouch();
  const typingInDock = useTypingIn(!phone && touch, (field) =>
    Boolean(dock.current?.contains(field)),
  );
  const dockKeyboard = useKeyboard(typingInDock);
  const keyboardInset = dockKeyboard.inset;
  useEffect(() => {
    if (compose) open();
  }, [compose, open]);
  // An action staging a draft (`useOpenComposer`) opens the composer with its prompt focused, even
  // when it is already open; phones bring up the sheet and leave the keyboard down.
  useEffect(() => {
    if (!opening) return;
    focusIntent.current = "[data-expanded-prompt]";
    open();
    if (phone) return;
    const frame = requestAnimationFrame(() =>
      dock.current
        ?.querySelector<HTMLElement>("[data-expanded-prompt]")
        ?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [opening]);
  // An image shared to the installed app (POST /share) arrives as a reference to place.
  useEffect(() => {
    if (!shared) return;
    void api<{ asset: ReferenceAsset }>(`/api/reference-assets/${encodeURIComponent(shared)}`)
      .then(({ asset }) => placement.place(asset))
      .catch(failure);
    onDropState("shared");
  }, [shared]);
  function collapse(restoreFocus = true) {
    returningFocus.current = restoreFocus;
    close();
    setExpanded(false);
    if (compose) onDropState("compose");
  }
  const submitted = () => collapse();
  // A layer over the composer (a dialog, popup or picker) is not outside it, unless it is the
  // surface the composer sits in.
  const inLayer = (element: Element) => {
    const layer = element.closest(composerLayers);
    return Boolean(layer && !layer.contains(dock.current));
  };
  function focusCompact() {
    if (!returningFocus.current) return;
    dock.current
      ?.querySelector<HTMLTextAreaElement>("[data-composer-prompt]")
      ?.focus({ preventScroll: true });
    returningFocus.current = false;
  }
  const outside = useClickOutside<HTMLDivElement>(
    (event) => {
      // A layer over the composer, such as Compare or a confirmation, takes the press itself.
      if (closingPopup() || inLayer(event.target as HTMLElement) || layerAbove(dock.current))
        return;
      collapse(false);
      // The click that closes the composer does nothing else, such as opening what lies under it.
      const swallow = (click: Event) => {
        click.preventDefault();
        click.stopPropagation();
      };
      document.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener("click", swallow, true), 500);
    },
    ["mousedown", "touchstart"],
    undefined,
    !phone && opened,
  );
  const dockRef = useMergedRef(dock, outside);
  useEffect(() => {
    if (phone) return;
    const frame = requestAnimationFrame(() => {
      if (opened)
        dock.current
          ?.querySelector<HTMLElement>(focusIntent.current)
          ?.focus({ preventScroll: true });
      else focusCompact();
    });
    return () => cancelAnimationFrame(frame);
  }, [opened, phone]);
  return (
    <ComposerPromptProvider>
      <div
        ref={dockRef}
        className={classes.dock}
        data-composer-dock
        hidden={phone && opened && expanded}
        data-reference-drop={dragging || undefined}
        onPaste={pasteReferences}
        onDragOver={dragReferences}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={dropReferences}
        onBlurCapture={(event) => {
          if (phone || !opened) return;
          const next = event.relatedTarget;
          const keyboardDeparture = tabbing.current;
          tabbing.current = false;
          if (next instanceof Element) {
            if (!event.currentTarget.contains(next) && !inLayer(next)) collapse(false);
          } else if (keyboardDeparture) collapse(false);
        }}
        onKeyUp={(event) => {
          if (event.key === "Tab") tabbing.current = false;
        }}
        onKeyDown={(event) => {
          tabbing.current = event.key === "Tab";
          if (
            !opened &&
            event.target instanceof HTMLTextAreaElement &&
            event.key === "Enter" &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            focusIntent.current = "[data-expanded-prompt]";
            open();
            return;
          }
          if (
            !phone &&
            opened &&
            event.key === "Escape" &&
            !event.defaultPrevented &&
            event.currentTarget.contains(event.target as Node) &&
            !(event.target as HTMLElement).closest('[role="combobox"][aria-expanded="true"]')
          ) {
            event.preventDefault();
            collapse();
          }
        }}
        style={
          {
            ...(typingInDock && {
              "--dock-keyboard-inset": `${keyboardInset}px`,
              "--dock-room": `${window.innerHeight - dockKeyboard.top - keyboardInset}px`,
            }),
          } as CSSProperties
        }
      >
        {(!opened || !expanded) && (
          <Paper
            radius="xl"
            shadow="xl"
            className={classes.compactSurface}
            // While handing over, it leaves the accessibility tree once focus has moved on.
            aria-hidden={(opened && !compactFocused) || undefined}
            onFocus={() => setCompactFocused(true)}
            onBlur={() => setCompactFocused(false)}
            onClick={(event) => {
              if (
                (event.target as HTMLElement).closest('button,a,[role="radio"],input[type="radio"]')
              )
                return;
              focusIntent.current = "[data-expanded-prompt]";
              open();
            }}
          >
            <GenerationForm compact onKindChange={onKindChange} onCompared={onCompared} />
          </Paper>
        )}
        {!phone && (
          <Transition
            mounted={opened}
            transition="slide-up"
            duration={motionDuration}
            onEntered={() => setExpanded(true)}
            onExited={focusCompact}
          >
            {(styles) => (
              <Paper
                withBorder
                p="md"
                radius="xl"
                shadow="xl"
                className={classes.surface}
                style={{ ...styles, position: "absolute", bottom: 0, width: "100%" }}
              >
                <div
                  id={controlsId}
                  role="region"
                  aria-label="Generate"
                  aria-hidden={handingOver || !opened || undefined}
                  inert={!opened}
                >
                  <GenerationForm
                    onSubmitted={submitted}
                    onKindChange={onKindChange}
                    onCompared={onCompared}
                    focusPrompt={focusIntent.current === "[data-expanded-prompt]"}
                  />
                </div>
              </Paper>
            )}
          </Transition>
        )}
      </div>
      {phone && (
        <TextEntrySheet
          id="generate"
          opened={opened}
          onClose={collapse}
          title="Generate"
          fieldTitles={{ prompt: "Prompt", negative: "Negative Prompt" }}
          hidden={handingOver}
          onPaste={pasteReferences}
          onDragOver={dragReferences}
          onDrop={dropReferences}
          returnFocus={false}
          onEnterTransitionEnd={() => setExpanded(true)}
          onExitTransitionEnd={focusCompact}
        >
          {({ field, done }) => (
            <GenerationForm
              fill
              onDone={done}
              onNegativeWritten={() => {
                if (field === "prompt") done();
              }}
              onSubmitted={submitted}
              onKindChange={onKindChange}
              onCompared={onCompared}
            />
          )}
        </TextEntrySheet>
      )}
    </ComposerPromptProvider>
  );
});

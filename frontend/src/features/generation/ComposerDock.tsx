import { useMotionDuration } from "../../ui/Appearance";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Drawer,
  FocusTrap,
  Paper,
  ScrollArea,
  type ScrollAreaProps,
  Transition,
} from "@mantine/core";
import { useClickOutside, useDisclosure, useMergedRef } from "@mantine/hooks";
import { useSearchParams } from "react-router";
import { GenerationForm } from "./GenerationForm";
import { galleryReferenceType, useGalleryReference, useReferenceFiles } from "./references";
import { api, failure } from "../../api";
import type { ReferenceAsset } from "../../types";
import { closingPopup, popupLayer } from "../../ui/popupClicks";
import { usePhone } from "../../ui/usePhone";
import classes from "./ComposerDock.module.css";
function GenerationScrollArea(props: ScrollAreaProps) {
  return (
    <ScrollArea
      {...props}
      viewportProps={{ "aria-label": "Generation Controls Scroll Area" }}
      styles={{ content: { display: "flex", flexDirection: "column", minHeight: "100%" } }}
    />
  );
}
const composerLayers = `[role="dialog"], [data-composer-layer], ${popupLayer}`;
/**
 * Gallery modes render the generation composer; Chat passes its own composer as `chat`. An
 * `embedded` composer (the viewer's, in its own GenerationProvider) sits in its surface's flow and
 * leaves the page's URL alone.
 */
export function ComposerDock({
  chat,
  embedded = false,
  onSubmitted,
}: {
  chat?: ReactNode;
  embedded?: boolean;
  onSubmitted?: (jobId: string) => void;
}) {
  const [params, setParams] = useSearchParams();
  // The page's composer answers `?compose=1` and shared images.
  const main = !chat && !embedded;
  const [opened, { open, close }] = useDisclosure(main && params.get("compose") === "1");
  // The compact bar stays under the expanded panel until it has slid in, so nothing blinks and
  // keystrokes typed meanwhile land in the shared draft.
  const [expanded, setExpanded] = useState(opened);
  const [compactFocused, setCompactFocused] = useState(false);
  // Exactly one prompt is exposed: the compact bar until the panel has slid in or taken focus.
  const handingOver = !chat && opened && !expanded && compactFocused;
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
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const resize = () =>
      setKeyboardInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  }, []);
  useEffect(() => {
    if (main && params.get("compose") === "1") open();
  }, [params, open, main]);
  // An image shared to the installed app (POST /share) arrives as a reference to place.
  const shared = main ? params.get("shared") || "" : "";
  useEffect(() => {
    if (!shared) return;
    void api<{ asset: ReferenceAsset }>(`/api/reference-assets/${encodeURIComponent(shared)}`)
      .then(({ asset }) => placement.place(asset))
      .catch(() => {});
    const next = new URLSearchParams(params);
    next.delete("shared");
    setParams(next, { replace: true });
  }, [shared]);
  function collapse(restoreFocus = true) {
    returningFocus.current = restoreFocus;
    close();
    setExpanded(false);
    if (main && params.has("compose")) {
      const next = new URLSearchParams(params);
      next.delete("compose");
      setParams(next, { replace: true });
    }
  }
  function submitted(jobId: string) {
    collapse();
    onSubmitted?.(jobId);
  }
  // A layer over the composer (a dialog, popup or picker) is not outside it, unless it is the
  // surface the composer sits in, such as the viewer.
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
      if (closingPopup() || inLayer(event.target as HTMLElement)) return;
      collapse(false);
      // In the viewer the press only folds the composer back to its bar; the click that follows
      // must not also act beneath it (closing the viewer). The next press drops a stale guard.
      if (!embedded) return;
      const swallow = (click: MouseEvent) => {
        click.preventDefault();
        click.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.addEventListener(
        "pointerdown",
        () => window.removeEventListener("click", swallow, true),
        { capture: true, once: true },
      );
    },
    ["mousedown", "touchstart"],
    undefined,
    !chat && !phone && opened,
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
    <>
      <div
        ref={dockRef}
        className={classes.dock}
        data-composer-dock
        data-chat={chat ? true : undefined}
        data-embedded={embedded || undefined}
        hidden={!chat && phone && opened && expanded}
        data-reference-drop={dragging || undefined}
        onPaste={pasteReferences}
        onDragOver={dragReferences}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={dropReferences}
        onBlurCapture={(event) => {
          if (chat || phone || !opened) return;
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
            !chat &&
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
          embedded
            ? undefined
            : {
                bottom: `calc(var(--studio-composer-gap) + env(safe-area-inset-bottom) + ${keyboardInset}px)`,
                marginBottom: chat ? keyboardInset : undefined,
              }
        }
      >
        {(chat || !opened || !expanded) && (
          <Paper
            withBorder
            p={8}
            radius="xl"
            shadow="xl"
            className={classes.surface}
            // While handing over, it leaves the accessibility tree once focus has moved on.
            aria-hidden={(!chat && opened && !compactFocused) || undefined}
            onFocus={() => setCompactFocused(true)}
            onBlur={() => setCompactFocused(false)}
            onClick={(event) => {
              if (
                chat ||
                (event.target as HTMLElement).closest('button,a,[role="radio"],input[type="radio"]')
              )
                return;
              focusIntent.current = "[data-expanded-prompt]";
              open();
            }}
          >
            {chat || <GenerationForm compact embedded={embedded} onSubmitted={onSubmitted} />}
          </Paper>
        )}
        {!chat && !phone && (
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
                  aria-label="Generation Controls"
                  aria-hidden={handingOver || !opened || undefined}
                  inert={!opened}
                >
                  <GenerationForm
                    onSubmitted={submitted}
                    embedded={embedded}
                    focusPrompt={focusIntent.current === "[data-expanded-prompt]"}
                  />
                </div>
              </Paper>
            )}
          </Transition>
        )}
      </div>
      {!chat && phone && (
        <Drawer
          onPaste={pasteReferences}
          onDragOver={dragReferences}
          onDrop={dropReferences}
          scrollAreaComponent={GenerationScrollArea}
          styles={{
            body: {
              flex: 1,
              display: "flex",
              flexDirection: "column",
              paddingBottom: 0,
            },
          }}
          opened={opened}
          onClose={collapse}
          title="Generation Controls"
          closeButtonProps={{ "aria-label": "Close Generation Controls" }}
          position="bottom"
          transitionProps={{ duration: motionDuration }}
          size="100%"
          returnFocus={false}
          onEnterTransitionEnd={() => setExpanded(true)}
          onExitTransitionEnd={focusCompact}
        >
          {/* Without a prompt focus intent, initial focus lands here rather than on Close. */}
          {focusIntent.current !== "[data-expanded-prompt]" && <FocusTrap.InitialFocus />}
          <div
            className={classes.panel}
            aria-hidden={handingOver || !opened || undefined}
            inert={!opened}
          >
            <GenerationForm
              fill
              onSubmitted={submitted}
              embedded={embedded}
              autoFocusPrompt={focusIntent.current === "[data-expanded-prompt]"}
              focusPrompt={focusIntent.current === "[data-expanded-prompt]"}
            />
          </div>
        </Drawer>
      )}
    </>
  );
}

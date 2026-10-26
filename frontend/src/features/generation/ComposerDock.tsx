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
import { failure } from "../../api";
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
const composerLayers =
  '[role="dialog"], [data-composer-layer], .mantine-Combobox-dropdown, .mantine-Popover-dropdown';
/** Gallery modes render the generation composer; Chat passes its own composer as `chat`. */
export function ComposerDock({ chat }: { chat?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const [opened, { open, close }] = useDisclosure(!chat && params.get("compose") === "1");
  // The compact bar stays under the expanded panel until it has slid in, so nothing blinks and
  // keystrokes typed meanwhile land in the shared draft.
  const [expanded, setExpanded] = useState(opened);
  const [compactFocused, setCompactFocused] = useState(false);
  const phone = usePhone();
  const motionDuration = useMotionDuration();
  const dock = useRef<HTMLDivElement>(null);
  const returningFocus = useRef(false);
  const tabbing = useRef(false);
  const focusIntent = useRef("[data-profile-picker]");
  const [dragging, setDragging] = useState(false);
  const reference = useGalleryReference();
  const { uploadFiles } = useReferenceFiles();
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
    if (!chat && params.get("compose") === "1") open();
  }, [params, open, chat]);
  function collapse(restoreFocus = true) {
    returningFocus.current = restoreFocus;
    close();
    setExpanded(false);
    if (params.has("compose")) {
      const next = new URLSearchParams(params);
      next.delete("compose");
      setParams(next, { replace: true });
    }
  }
  function focusCompact() {
    if (!returningFocus.current) return;
    dock.current
      ?.querySelector<HTMLTextAreaElement>("[data-composer-prompt]")
      ?.focus({ preventScroll: true });
    returningFocus.current = false;
  }
  const outside = useClickOutside<HTMLDivElement>(
    (event) => {
      if ((event.target as HTMLElement).closest(composerLayers)) return;
      collapse(false);
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
            if (!event.currentTarget.contains(next) && !next.closest(composerLayers))
              collapse(false);
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
        style={{
          bottom: `calc(var(--studio-composer-gap) + env(safe-area-inset-bottom) + ${keyboardInset}px)`,
          marginBottom: chat ? keyboardInset : undefined,
        }}
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
            {chat || <GenerationForm compact />}
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
                  aria-hidden={!opened}
                  inert={!opened}
                >
                  <GenerationForm
                    onSubmitted={collapse}
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
          <div className={classes.panel} aria-hidden={!opened} inert={!opened}>
            <GenerationForm
              fill
              onSubmitted={collapse}
              autoFocusPrompt={focusIntent.current === "[data-expanded-prompt]"}
              focusPrompt={focusIntent.current === "[data-expanded-prompt]"}
            />
          </div>
        </Drawer>
      )}
    </>
  );
}

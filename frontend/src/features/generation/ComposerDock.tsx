import { useMotionDuration } from "../../ui/Appearance";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Drawer, FocusTrap, Paper, Transition } from "@mantine/core";
import { useClickOutside, useDisclosure, useMergedRef } from "@mantine/hooks";
import { useLocation, useSearchParams } from "react-router";
import type { OpenComposerState } from "./openComposer";
import { GenerationForm } from "./GenerationForm";
import { galleryReferenceType, useGalleryReference, useReferenceFiles } from "./references";
import { api, failure } from "../../api";
import type { ReferenceAsset } from "../../types";
import { closeWhenTop, closingPopup, layerAbove, popupLayer } from "../../ui/popupClicks";
import { useKeyboard } from "../../ui/useKeyboard";
import { usePhone } from "../../ui/usePhone";
import classes from "./ComposerDock.module.css";
export const composerLayers = `[role="dialog"], [data-composer-layer], ${popupLayer}`;
/** Gallery modes render the generation composer; Chat passes its own composer as `chat`. */
export function ComposerDock({ chat }: { chat?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  // The gallery's composer answers `?compose=1` and shared images.
  const main = !chat;
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
  const keyboard = useKeyboard(!chat && phone && opened);
  // Tapping a text box flips the sheet's typing layout at once, rather than once iOS reports the
  // keyboard after its animation; it ends as the text loses focus or the keyboard drops (Android's
  // Back keeps focus). The bar's lift still follows the viewport.
  const keyboardUp = keyboard.inset > 0;
  const [tappedField, setTappedField] = useState(false);
  const tapping = useRef(false);
  useEffect(() => {
    if (!keyboardUp) setTappedField(false);
  }, [keyboardUp]);
  const typing = keyboardUp || tappedField;
  const sheetField = (panel: HTMLElement, target: unknown) =>
    target instanceof HTMLTextAreaElement && panel.contains(target);
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    // Phones type in the Generate sheet instead, so the dock stays put there.
    if (!viewport || phone) return;
    // Only typing in the dock lifts it above the keyboard; scrolling and the address bar never move it.
    const resize = () => {
      const field = document.activeElement;
      const typing = dock.current?.contains(field) && field?.matches("input, textarea");
      setKeyboardInset(
        typing ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0,
      );
    };
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  }, [phone]);
  useEffect(() => {
    if (main && params.get("compose") === "1") open();
  }, [params, open, main]);
  // An action staging a draft (`useOpenComposer`) opens the composer with its prompt focused, even
  // when it is already open; phones bring up the sheet and leave the keyboard down.
  const location = useLocation();
  useEffect(() => {
    if (!main || !(location.state as OpenComposerState | null)?.openComposer) return;
    focusIntent.current = "[data-expanded-prompt]";
    open();
    if (phone) return;
    const frame = requestAnimationFrame(() =>
      dock.current
        ?.querySelector<HTMLElement>("[data-expanded-prompt]")
        ?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [location.key, main]);
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
    // The sheet unmounts without a blur.
    setTappedField(false);
    close();
    setExpanded(false);
    if (main && params.has("compose")) {
      const next = new URLSearchParams(params);
      next.delete("compose");
      setParams(next, { replace: true });
    }
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
        style={{
          // The safe area stands in for the gap rather than adding to it, so the bar sits as far
          // from the bottom as from the sides.
          bottom: `calc(max(var(--studio-composer-gap), env(safe-area-inset-bottom)) + ${keyboardInset}px)`,
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
                  aria-label="Generate"
                  aria-hidden={handingOver || !opened || undefined}
                  inert={!opened}
                >
                  <GenerationForm
                    onSubmitted={submitted}
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
          classNames={{
            content: classes.sheet,
            header: classes.sheetHeader,
            body: classes.sheetBody,
          }}
          styles={{
            // Opaque, like the phone text editor, so the page never shows through the prompt; it
            // follows the visible viewport, so the keyboard lifts its bottom bar.
            content: {
              background: "var(--mantine-color-body)",
              backdropFilter: "none",
              WebkitBackdropFilter: "none",
              translate: keyboard.top ? `0 ${keyboard.top}px` : undefined,
              "--keyboard-inset": `${keyboard.inset}px`,
            } as CSSProperties,
          }}
          id="generate"
          opened={opened}
          onClose={closeWhenTop("generate", collapse)}
          title="Generate"
          closeButtonProps={{ "aria-label": "Close Generate" }}
          position="bottom"
          transitionProps={{ duration: motionDuration }}
          size="100%"
          returnFocus={false}
          onEnterTransitionEnd={() => setExpanded(true)}
          onExitTransitionEnd={focusCompact}
        >
          {/* Initial focus lands here rather than on Close or the prompt, so the keyboard waits for a tap. */}
          <FocusTrap.InitialFocus />
          <div
            className={classes.panel}
            data-generate-drawer
            data-typing={typing || undefined}
            onPointerDown={(event) => {
              tapping.current = sheetField(event.currentTarget, event.target);
            }}
            onFocus={(event) => {
              if (tapping.current && sheetField(event.currentTarget, event.target))
                setTappedField(true);
              tapping.current = false;
            }}
            onBlur={(event) => {
              if (!sheetField(event.currentTarget, event.relatedTarget)) setTappedField(false);
            }}
            aria-hidden={handingOver || !opened || undefined}
            inert={!opened}
          >
            <GenerationForm fill onSubmitted={submitted} />
          </div>
        </Drawer>
      )}
    </>
  );
}

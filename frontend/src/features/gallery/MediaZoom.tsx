import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActionIcon, Button, Group, Transition } from "@mantine/core";
import { useFocusWithin, useHover, useMergedRef } from "@mantine/hooks";
import { Minus, Plus } from "lucide-react";
import type { ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import { useMotionDuration } from "../../ui/Appearance";
import classes from "./MediaZoom.module.css";

type Mode = "Fit" | "Fill" | "Actual Size" | "Custom";

export function useMediaZoom({
  width,
  height,
  disabled = false,
}: {
  width: number;
  height: number;
  disabled?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLButtonElement>(null);
  const transform = useRef<ReactZoomPanPinchRef>(null);
  const percentage = useRef<HTMLSpanElement>(null);
  const modeRef = useRef<Mode>("Fit");
  const [mode, setMode] = useState<Mode>("Fit");
  const duration = useMotionDuration();
  const [recent, setRecent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function revealControls() {
    setRecent(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setRecent(false), 2000);
  }
  function changeMode(next: Mode) {
    modeRef.current = next;
    setMode(next);
  }
  function layout(next: Mode, animationTime = duration) {
    const api = transform.current;
    if (!api || !picture.current) return;
    // zoomToElement cancels queued native animations even for an immediate resize refit.
    if (next === "Fit" || next === "Actual Size")
      void api.zoomToElement(
        picture.current,
        next === "Actual Size" ? { scale: 1 } : undefined,
        animationTime,
      );
    else if (next === "Fill") {
      if (!animationTime) void api.zoomToElement(picture.current, { scale: api.state.scale }, 0);
      void api.fitToView({ mode: "cover", animationTime });
    }
  }
  function cycle() {
    const next =
      modeRef.current === "Fit" ? "Fill" : modeRef.current === "Fill" ? "Actual Size" : "Fit";
    changeMode(next);
    layout(next);
    revealControls();
  }
  function toggleAt(x: number, y: number) {
    const api = transform.current;
    if (!api) return;
    if (modeRef.current === "Fit") {
      changeMode("Custom");
      void api.zoomToPoint(api.state.scale * 2.5, x, y, duration);
    } else {
      changeMode("Fit");
      layout("Fit");
    }
    revealControls();
  }
  function manualZoom() {
    changeMode("Custom");
    revealControls();
  }
  function zoom(direction: -1 | 1) {
    manualZoom();
    if (direction < 0) void transform.current?.zoomOut(0.2, duration);
    else void transform.current?.zoomIn(0.2, duration);
  }
  useLayoutEffect(() => {
    if (disabled) return;
    const observer = new ResizeObserver(() => layout(modeRef.current, 0));
    observer.observe(viewport.current!);
    layout(modeRef.current, 0);
    return () => observer.disconnect();
  }, [disabled, width, height]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Before paint: a key pressed as soon as the loaded image shows must not reach the stale
  // listener that still sees it as loading.
  useLayoutEffect(() => {
    function key(event: KeyboardEvent) {
      if (
        disabled ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.target as Element).closest(
          'input,textarea,select,[contenteditable="true"],[role="slider"]',
        )
      )
        return;
      if (["+", "=", "-"].includes(event.key)) {
        event.preventDefault();
        zoom(event.key === "-" ? -1 : 1);
      } else if (event.key === "0") {
        event.preventDefault();
        changeMode("Fit");
        layout("Fit");
        revealControls();
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [disabled, duration]);

  function onTransform(_: unknown, state: { scale: number }) {
    if (percentage.current) percentage.current.textContent = `${Math.round(state.scale * 100)}%`;
    if (viewport.current) viewport.current.dataset.zoomScale = String(state.scale);
  }
  return {
    viewport,
    picture,
    transform,
    percentage,
    modeRef,
    mode,
    duration,
    disabled,
    recent,
    cycle,
    toggleAt,
    manualZoom,
    revealControls,
    zoom,
    onTransform,
  };
}

export function MediaZoomControls({ zoom }: { zoom: ReturnType<typeof useMediaZoom> }) {
  const { ref: focusRef, focused } = useFocusWithin<HTMLDivElement>();
  // The controls stay while the pointer rests on them, not only for a moment after it arrives.
  const { ref: hoverRef, hovered } = useHover<HTMLDivElement>();
  const ref = useMergedRef(focusRef, hoverRef);
  return (
    <Transition
      mounted={zoom.recent || focused || hovered}
      transition="fade"
      duration={zoom.duration}
      keepMounted
    >
      {(style) => (
        <Group
          ref={ref}
          className={classes.controls}
          style={style}
          gap={2}
          data-zoom-controls=""
          role="group"
          aria-label="Image Zoom"
          onPointerEnter={zoom.revealControls}
          onClick={(event) => event.stopPropagation()}
        >
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label="Zoom Out"
            disabled={zoom.disabled}
            onClick={() => zoom.zoom(-1)}
          >
            <Minus size={14} />
          </ActionIcon>
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            aria-label={`Zoom: ${zoom.mode}`}
            disabled={zoom.disabled}
            onClick={zoom.cycle}
          >
            <span ref={zoom.percentage}>100%</span>
          </Button>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label="Zoom In"
            disabled={zoom.disabled}
            onClick={() => zoom.zoom(1)}
          >
            <Plus size={14} />
          </ActionIcon>
        </Group>
      )}
    </Transition>
  );
}

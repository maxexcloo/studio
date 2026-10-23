import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Button, Group, Loader, Text, VisuallyHidden } from "@mantine/core";
import classes from "./MediaViewer.module.css";

type Mode = "Fit" | "Fill" | "Actual Size" | "Custom";
type Point = { x: number; y: number };

/** Image transforms are painted once per frame; pointer movement never renders React. */
export function ZoomImage({
  src,
  alt,
  width,
  height,
  navigate,
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  navigate?: (direction: -1 | 1) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLButtonElement>(null);
  const percent = useRef<HTMLSpanElement>(null);
  const instructions = useId();
  const [mode, setMode] = useState<Mode>("Fit");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const geometry = useRef({
    width: width || 1,
    height: height || 1,
    viewWidth: 0,
    viewHeight: 0,
    scale: 1,
    x: 0,
    y: 0,
  });
  const modeRef = useRef<Mode>("Fit");
  const frame = useRef(0);
  const points = useRef(new Map<number, Point>());
  const moved = useRef(false);
  const imagePress = useRef(false);
  const origin = useRef<Point>({ x: 0, y: 0 });
  const ready = useRef(false);
  const fit = () =>
    Math.min(
      geometry.current.viewWidth / geometry.current.width,
      geometry.current.viewHeight / geometry.current.height,
    );
  const fill = () =>
    Math.max(
      geometry.current.viewWidth / geometry.current.width,
      geometry.current.viewHeight / geometry.current.height,
    );
  function paint() {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const g = geometry.current;
      const maxX = Math.max(0, (g.width * g.scale - g.viewWidth) / 2);
      const maxY = Math.max(0, (g.height * g.scale - g.viewHeight) / 2);
      g.x = Math.max(-maxX, Math.min(maxX, g.x));
      g.y = Math.max(-maxY, Math.min(maxY, g.y));
      if (picture.current)
        picture.current.style.transform = `translate3d(calc(-50% + ${g.x}px), calc(-50% + ${g.y}px), 0) scale(${g.scale})`;
      if (viewport.current) {
        viewport.current.dataset.zoomScale = String(g.scale);
        viewport.current.dataset.pannable = String(maxX > 0 || maxY > 0);
      }
      if (percent.current) percent.current.textContent = `${Math.round(g.scale * 100)}%`;
    });
  }
  function choose(next: Mode) {
    const g = geometry.current;
    modeRef.current = next;
    setMode(next);
    g.scale =
      next === "Fit" ? fit() : next === "Fill" ? fill() : next === "Actual Size" ? 1 : g.scale;
    g.x = 0;
    g.y = 0;
    paint();
  }
  const cycle = () =>
    choose(modeRef.current === "Fit" ? "Fill" : modeRef.current === "Fill" ? "Actual Size" : "Fit");
  function manual() {
    if (modeRef.current !== "Custom") {
      modeRef.current = "Custom";
      setMode("Custom");
    }
  }
  function zoomAt(scale: number, from: Point, to = from) {
    const g = geometry.current;
    const next = Math.max(fit() / 4, Math.min(Math.max(1, fill()) * 8, scale));
    const ratio = next / g.scale;
    g.x = to.x - g.viewWidth / 2 - (from.x - g.viewWidth / 2 - g.x) * ratio;
    g.y = to.y - g.viewHeight / 2 - (from.y - g.viewHeight / 2 - g.y) * ratio;
    g.scale = next;
    manual();
    paint();
  }
  useEffect(() => {
    const element = viewport.current!;
    const resize = () => {
      geometry.current.viewWidth = element.clientWidth;
      geometry.current.viewHeight = element.clientHeight;
      if (modeRef.current !== "Custom") choose(modeRef.current);
      else paint();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const wheel = (event: WheelEvent) => {
      if (
        (event.target as Element).closest("[data-zoom-controls]") ||
        !ready.current ||
        !geometry.current.viewWidth
      )
        return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      zoomAt(geometry.current.scale * Math.exp(-delta * 0.002), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", wheel);
      cancelAnimationFrame(frame.current);
    };
  }, []);
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as Element).closest("[data-zoom-controls]") || event.button !== 0) return;
    if (!points.current.size) {
      moved.current = false;
      imagePress.current = Boolean(picture.current?.contains(event.target as Node));
      origin.current = { x: event.clientX, y: event.clientY };
    } else moved.current = true;
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.dragging = "true";
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const old = points.current.get(event.pointerId);
    if (!old) return;
    const before = [...points.current.values()];
    const next = { x: event.clientX, y: event.clientY };
    points.current.set(event.pointerId, next);
    if (Math.hypot(next.x - origin.current.x, next.y - origin.current.y) > 5) moved.current = true;
    if (points.current.size > 1) {
      const after = [...points.current.values()];
      const distance = (values: Point[]) =>
        Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y);
      const middle = (values: Point[]) => {
        const rect = viewport.current!.getBoundingClientRect();
        return {
          x: (values[0].x + values[1].x) / 2 - rect.left,
          y: (values[0].y + values[1].y) / 2 - rect.top,
        };
      };
      if (distance(before))
        zoomAt(
          (geometry.current.scale * distance(after)) / distance(before),
          middle(before),
          middle(after),
        );
    } else {
      geometry.current.x += next.x - old.x;
      geometry.current.y += next.y - old.y;
      paint();
    }
  }
  function up(event: ReactPointerEvent<HTMLDivElement>) {
    const dx = event.clientX - origin.current.x;
    const dy = event.clientY - origin.current.y;
    const swipe =
      event.type === "pointerup" &&
      event.pointerType === "touch" &&
      points.current.size === 1 &&
      imagePress.current &&
      modeRef.current === "Fit" &&
      Math.abs(dx) > 64 &&
      Math.abs(dx) > Math.abs(dy) * 1.3;
    points.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (!points.current.size) event.currentTarget.dataset.dragging = "false";
    if (event.type === "pointercancel") moved.current = true;
    if (swipe && navigate) {
      moved.current = true;
      navigate(dx < 0 ? 1 : -1);
    }
  }
  return (
    <div
      ref={viewport}
      className={classes.zoom}
      data-zoom-mode={mode}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClick={(event) => {
        if (moved.current && event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
          moved.current = false;
          imagePress.current = false;
          return;
        }
        if (imagePress.current || picture.current?.contains(event.target as Node)) {
          event.stopPropagation();
          imagePress.current = false;
          cycle();
        }
      }}
    >
      <VisuallyHidden id={instructions}>
        Click to cycle Fit, Fill and Actual Size. Drag to pan. Use the mouse wheel or pinch to zoom.
        {navigate && " Swipe left or right at Fit to move between generations."}
      </VisuallyHidden>
      <button
        ref={picture}
        type="button"
        className={classes.picture}
        aria-label="Change Image Zoom"
        aria-describedby={instructions}
        hidden={failed}
        style={{
          width: width || 1,
          height: height || 1,
          visibility: loading ? "hidden" : "visible",
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget;
            geometry.current.width = image.naturalWidth;
            geometry.current.height = image.naturalHeight;
            ready.current = true;
            picture.current!.style.width = `${image.naturalWidth}px`;
            picture.current!.style.height = `${image.naturalHeight}px`;
            choose(modeRef.current);
            setLoading(false);
          }}
          onError={() => {
            setFailed(true);
            setLoading(false);
          }}
        />
      </button>
      {loading && <Loader className={classes.loading} aria-label="Loading Image" />}
      {failed && (
        <Text className={classes.loading} c="dimmed" role="alert">
          This image is unavailable.
        </Text>
      )}
      <Group
        className={classes.zoomControls}
        gap="xs"
        data-zoom-controls=""
        role="group"
        aria-label="Image Zoom"
        onClick={(event) => event.stopPropagation()}
      >
        <Button size="compact-xs" variant="default" disabled={failed || loading} onClick={cycle}>
          Zoom: {mode}
        </Button>
        <Button
          size="compact-xs"
          variant="default"
          disabled={failed || loading}
          onClick={() => choose("Fit")}
        >
          Fit Image
        </Button>
        <Text component="span" ref={percent} size="xs">
          100%
        </Text>
      </Group>
    </div>
  );
}

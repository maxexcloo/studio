import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { ActionIcon, Button, Group, Loader, Text, Transition, VisuallyHidden } from "@mantine/core";
import { useFocusWithin } from "@mantine/hooks";
import { Minus, Plus } from "lucide-react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import type { ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import { useMotionDuration } from "../../ui/Appearance";
import classes from "./ZoomImage.module.css";

type Mode = "Fit" | "Fill" | "Actual Size" | "Custom";

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
  const transform = useRef<ReactZoomPanPinchRef>(null);
  const percent = useRef<HTMLSpanElement>(null);
  const picture = useRef<HTMLButtonElement>(null);
  const instructions = useId();
  const duration = useMotionDuration();
  const [size, setSize] = useState({ width: width || 1, height: height || 1 });
  const [mode, setMode] = useState<Mode>("Fit");
  const modeRef = useRef<Mode>("Fit");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [recent, setRecent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { ref: controls, focused } = useFocusWithin<HTMLDivElement>();
  const suppressClick = useRef(false);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    touch: boolean;
    image: boolean;
    fit: boolean;
    multiple: boolean;
  } | null>(null);

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
    if (!api) return;
    if (next === "Fit" || next === "Fill")
      void api.fitToView({ mode: next === "Fit" ? "contain" : "cover", animationTime });
    else if (next === "Actual Size") void api.centerView(1, animationTime);
  }
  function cycle() {
    const next =
      modeRef.current === "Fit" ? "Fill" : modeRef.current === "Fill" ? "Actual Size" : "Fit";
    changeMode(next);
    layout(next);
    revealControls();
  }
  function manualZoom() {
    changeMode("Custom");
    revealControls();
  }
  useEffect(() => {
    if (loading) return;
    // Refit named views when the responsive viewer changes its available area.
    const observer = new ResizeObserver(() => layout(modeRef.current));
    observer.observe(viewport.current!);
    layout(modeRef.current, 0);
    return () => observer.disconnect();
  }, [loading, size.width, size.height]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (
        loading ||
        failed ||
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
        manualZoom();
        if (event.key === "-") void transform.current?.zoomOut(0.2, duration);
        else void transform.current?.zoomIn(0.2, duration);
      } else if (event.key === "0") {
        event.preventDefault();
        changeMode("Fit");
        layout("Fit");
        revealControls();
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [loading, failed, duration]);

  // The library owns all transforms; Studio only recognises clicks and Fit-only navigation.
  function down(event: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    if ((event.target as Element).closest("[data-zoom-controls]") || event.button !== 0) return;
    if (gesture.current) {
      gesture.current.multiple = true;
      suppressClick.current = true;
      return;
    }
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      touch: event.pointerType === "touch",
      image: Boolean(picture.current?.contains(event.target as Node)),
      fit: modeRef.current === "Fit",
      multiple: false,
    };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5)
      suppressClick.current = true;
  }
  function up(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    gesture.current = null;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (event.type === "pointercancel") suppressClick.current = true;
    else if (
      navigate &&
      start.touch &&
      start.image &&
      start.fit &&
      !start.multiple &&
      modeRef.current === "Fit" &&
      Math.abs(dx) > 64 &&
      Math.abs(dx) > Math.abs(dy) * 1.3
    ) {
      suppressClick.current = true;
      navigate(dx < 0 ? 1 : -1);
    }
  }
  return (
    <div
      ref={viewport}
      className={classes.zoom}
      data-zoom-mode={mode}
      onPointerDownCapture={down}
      onPointerMoveCapture={move}
      onPointerUpCapture={up}
      onPointerCancelCapture={up}
      onClickCapture={(event) => {
        if (suppressClick.current && event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      }}
    >
      <VisuallyHidden id={instructions}>
        Click to cycle Fit, Fill and Actual Size. Drag to pan. Use the mouse wheel or pinch to zoom.
        {navigate && " Swipe left or right at Fit to move between generations."}
      </VisuallyHidden>
      <TransformWrapper
        ref={transform}
        fitOnInit
        minScale={0.0001}
        maxScale={1000}
        limitToBounds
        centerZoomedOut
        disablePadding
        disabled={loading || failed}
        doubleClick={{ disabled: true }}
        panning={{ velocityDisabled: true }}
        zoomAnimation={{ disabled: duration === 0, animationTime: duration }}
        autoAlignment={{ animationTime: duration, velocityAlignmentTime: duration }}
        onWheelStart={manualZoom}
        onWheel={revealControls}
        onPinchStart={() => {
          suppressClick.current = true;
          manualZoom();
        }}
        onPinch={revealControls}
        onTransform={(_, state) => {
          if (percent.current) percent.current.textContent = `${Math.round(state.scale * 100)}%`;
          if (viewport.current) viewport.current.dataset.zoomScale = String(state.scale);
        }}
      >
        <TransformComponent
          wrapperStyle={{ width: "100%", height: "100%" }}
          contentStyle={{ width: size.width, height: size.height }}
        >
          <button
            ref={picture}
            type="button"
            className={classes.picture}
            aria-label="Change Image Zoom"
            aria-describedby={instructions}
            hidden={failed}
            style={{
              width: size.width,
              height: size.height,
              visibility: loading ? "hidden" : "visible",
            }}
            onClick={(event) => {
              event.stopPropagation();
              cycle();
            }}
          >
            <img
              src={src}
              alt={alt}
              draggable={false}
              width={size.width}
              height={size.height}
              onLoad={(event) => {
                setSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                });
                setLoading(false);
              }}
              onError={() => {
                setFailed(true);
                setLoading(false);
              }}
            />
          </button>
        </TransformComponent>
      </TransformWrapper>
      {loading && <Loader className={classes.loading} aria-label="Loading Image" />}
      {failed && (
        <Text className={classes.loading} c="dimmed" role="alert">
          This image is unavailable.
        </Text>
      )}
      <Transition mounted={recent || focused} transition="fade" duration={duration} keepMounted>
        {(style) => (
          <Group
            ref={controls}
            className={classes.zoomControls}
            style={style}
            gap={2}
            data-zoom-controls=""
            role="group"
            aria-label="Image Zoom"
            onPointerEnter={revealControls}
            onClick={(event) => event.stopPropagation()}
          >
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label="Zoom Out"
              disabled={loading || failed}
              onClick={() => {
                manualZoom();
                void transform.current?.zoomOut(0.2, duration);
              }}
            >
              <Minus size={14} />
            </ActionIcon>
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              aria-label={`Zoom: ${mode}`}
              onClick={cycle}
              disabled={loading || failed}
            >
              <span ref={percent}>100%</span>
            </Button>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label="Zoom In"
              disabled={loading || failed}
              onClick={() => {
                manualZoom();
                void transform.current?.zoomIn(0.2, duration);
              }}
            >
              <Plus size={14} />
            </ActionIcon>
          </Group>
        )}
      </Transition>
    </div>
  );
}

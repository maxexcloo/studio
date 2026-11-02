import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { Button, Loader, Stack, Text, VisuallyHidden } from "@mantine/core";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { MediaZoomControls, useMediaZoom } from "./MediaZoom";
import { swipeDirection, type SwipeDirection } from "./swipe";
import classes from "./ZoomImage.module.css";

export function ZoomImage({
  src,
  alt,
  width,
  height,
  placeholder,
  swipe,
  arrive,
}: {
  src: string;
  alt: string;
  /** The gallery's already-loaded thumbnail, shown at full size until the image itself loads. */
  placeholder?: string;
  width?: number;
  height?: number;
  /** Touch swipes at Fit: left/right navigate, down closes, up reveals details. */
  swipe?: (direction: SwipeDirection) => void;
  /** A picture reached by swiping slides in from the side it was pulled from. */
  arrive?: "next" | "previous";
}) {
  const instructions = useId();
  const [size, setSize] = useState({ width: width || 1, height: height || 1 });
  const [loading, setLoading] = useState(true);
  const [displayedSrc, setDisplayedSrc] = useState(src);
  const [switching, setSwitching] = useState(false);
  const [versionFailed, setVersionFailed] = useState(false);
  const [versionRetry, setVersionRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  const zoom = useMediaZoom({ ...size, disabled: loading || failed });
  const image = useRef<HTMLImageElement>(null);
  const suppressClick = useRef(false);
  const touched = useRef(false);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    touch: boolean;
    image: boolean;
    fit: boolean;
    multiple: boolean;
    drag?: "x" | "y";
  } | null>(null);

  useEffect(() => {
    if (src === displayedSrc) {
      setSwitching(false);
      setVersionFailed(false);
      if (zoom.picture.current?.querySelector("img")?.naturalWidth) setFailed(false);
      return;
    }
    let current = true;
    const replacement = new window.Image();
    setSwitching(true);
    setVersionFailed(false);
    replacement.src = src;
    void replacement
      .decode()
      .then(() => {
        if (current) {
          setDisplayedSrc(src);
          setFailed(false);
        }
      })
      .catch(() => {
        if (current) setVersionFailed(true);
      })
      .finally(() => {
        if (current) setSwitching(false);
      });
    return () => {
      current = false;
    };
  }, [src, displayedSrc, versionRetry]);

  function loaded(node: HTMLImageElement) {
    setFailed(false);
    setSize({ width: node.naturalWidth, height: node.naturalHeight });
    setLoading(false);
  }
  // A cached image shows in the first frame rather than after its load event.
  useLayoutEffect(() => {
    if (image.current?.complete && image.current.naturalWidth) loaded(image.current);
  }, []);

  // The library owns all transforms; Studio only recognises clicks and Fit-only navigation.
  // At Fit the picture follows a swiping finger, then slides back if the swipe goes nowhere.
  function follow(transform: string) {
    const node = zoom.viewport.current!;
    node.style.transition = transform ? "none" : "";
    node.style.transform = transform;
  }
  function down(event: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    touched.current = event.pointerType === "touch";
    if ((event.target as Element).closest("[data-zoom-controls]") || event.button !== 0) return;
    if (gesture.current) {
      gesture.current.multiple = true;
      suppressClick.current = true;
      follow("");
      return;
    }
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      touch: event.pointerType === "touch",
      image: Boolean(zoom.picture.current?.contains(event.target as Node)),
      fit: zoom.modeRef.current === "Fit",
      multiple: false,
    };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > 5) suppressClick.current = true;
    if (!swipe || !start.touch || start.multiple || !start.fit || zoom.modeRef.current !== "Fit")
      return;
    start.drag ??=
      Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)
        ? "x"
        : dy > 10 && dy > Math.abs(dx)
          ? "y"
          : undefined;
    if (start.drag === "x") follow(`translateX(${dx}px)`);
    else if (start.drag === "y")
      follow(
        `translateY(${Math.max(0, dy)}px) scale(${1 - Math.min(Math.max(0, dy), 400) / 2000})`,
      );
  }
  function up(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    gesture.current = null;
    if (start.drag) follow("");
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (event.type === "pointercancel" || !start.touch || start.multiple) {
      if (event.type === "pointercancel") suppressClick.current = true;
      return;
    }
    const direction = swipeDirection(dx, dy);
    if (swipe && start.fit && zoom.modeRef.current === "Fit" && direction) {
      suppressClick.current = true;
      swipe(direction);
      return;
    }
    // A double tap on the picture zooms in at that point, or back to Fit.
    if (!start.image || suppressClick.current) return;
    const previous = lastTap.current;
    lastTap.current = { at: event.timeStamp, x: event.clientX, y: event.clientY };
    if (
      previous &&
      event.timeStamp - previous.at < 320 &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 32
    ) {
      lastTap.current = null;
      zoom.toggleAt(event.clientX, event.clientY);
    }
  }
  return (
    <div
      ref={zoom.viewport}
      className={classes.zoom}
      data-zoom-mode={zoom.mode}
      data-arrive={arrive}
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
        Click to cycle Fit, Fill and Actual Size, or double-tap to zoom. Drag to pan. Use the mouse
        wheel or pinch to zoom.
        {swipe &&
          " At Fit, swipe left or right to move between generations, up for details and down to close."}
      </VisuallyHidden>
      <TransformWrapper
        ref={zoom.transform}
        minScale={0.0001}
        maxScale={1000}
        limitToBounds
        centerZoomedOut
        disablePadding
        disabled={zoom.disabled}
        doubleClick={{ disabled: true }}
        panning={{ velocityDisabled: true }}
        zoomAnimation={{ disabled: zoom.duration === 0, animationTime: zoom.duration }}
        autoAlignment={{ animationTime: zoom.duration, velocityAlignmentTime: zoom.duration }}
        onWheelStart={zoom.manualZoom}
        onWheel={zoom.revealControls}
        onPinchStart={() => {
          suppressClick.current = true;
          zoom.manualZoom();
        }}
        onPinch={zoom.revealControls}
        onTransform={zoom.onTransform}
      >
        <TransformComponent
          // Native focus scrolling must not shift the library's transformed viewport.
          wrapperStyle={{ width: "100%", height: "100%", overflow: "clip" }}
          contentStyle={{ width: size.width, height: size.height }}
        >
          <button
            ref={zoom.picture}
            type="button"
            className={classes.picture}
            aria-label="Change Image Zoom"
            aria-describedby={instructions}
            hidden={failed}
            style={{
              width: size.width,
              height: size.height,
              visibility: loading && !placeholder ? "hidden" : "visible",
              backgroundImage:
                loading && placeholder ? `url(${JSON.stringify(placeholder)})` : undefined,
            }}
            onClick={(event) => {
              event.stopPropagation();
              // Touch zooms with a double tap; a single tap must not change the zoom.
              if (!touched.current || event.detail === 0) zoom.cycle();
            }}
          >
            <img
              ref={image}
              src={displayedSrc}
              alt={alt}
              draggable={false}
              width={size.width}
              height={size.height}
              style={{ visibility: loading ? "hidden" : undefined }}
              onLoad={(event) => loaded(event.currentTarget)}
              onError={() => {
                setFailed(true);
                setLoading(false);
              }}
            />
          </button>
        </TransformComponent>
      </TransformWrapper>
      {((loading && !placeholder) || switching) && (
        <Loader
          className={classes.loading}
          aria-label={switching ? "Loading Selected Version" : "Loading Image"}
        />
      )}
      {failed && !switching && (
        <Text className={classes.loading} c="dimmed" role="alert">
          This image is unavailable.
        </Text>
      )}
      {versionFailed && !switching && (
        <Stack
          className={classes.loading}
          gap="xs"
          align="center"
          onClick={(event) => event.stopPropagation()}
        >
          <Text size="sm" role="alert">
            The selected version could not be loaded. The previous image is still shown.
          </Text>
          <Button
            size="compact-sm"
            variant="default"
            onClick={() => setVersionRetry((value) => value + 1)}
          >
            Retry Selected Version
          </Button>
        </Stack>
      )}
      <MediaZoomControls zoom={zoom} />
    </div>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { Button, Loader, Stack, Text, VisuallyHidden } from "@mantine/core";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { MediaZoomControls, useMediaZoom } from "./MediaZoom";
import classes from "./ZoomImage.module.css";

export function ZoomImage({
  src,
  alt,
  width,
  height,
  swipe,
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  /** Touch swipes at Fit: left/right navigate, down closes, up reveals details. */
  swipe?: (direction: "left" | "right" | "up" | "down") => void;
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

  // The library owns all transforms; Studio only recognises clicks and Fit-only navigation.
  function down(event: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    touched.current = event.pointerType === "touch";
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
      image: Boolean(zoom.picture.current?.contains(event.target as Node)),
      fit: zoom.modeRef.current === "Fit",
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
    if (event.type === "pointercancel" || !start.touch || start.multiple) {
      if (event.type === "pointercancel") suppressClick.current = true;
      return;
    }
    const horizontal = Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.3;
    const vertical = Math.abs(dy) > 80 && Math.abs(dy) > Math.abs(dx) * 1.3;
    if (swipe && start.fit && zoom.modeRef.current === "Fit" && (horizontal || vertical)) {
      suppressClick.current = true;
      swipe(horizontal ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down");
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
        fitOnInit
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
              visibility: loading ? "hidden" : "visible",
            }}
            onClick={(event) => {
              event.stopPropagation();
              // Touch zooms with a double tap; a single tap must not change the zoom.
              if (!touched.current || event.detail === 0) zoom.cycle();
            }}
          >
            <img
              src={displayedSrc}
              alt={alt}
              draggable={false}
              width={size.width}
              height={size.height}
              onLoad={(event) => {
                setFailed(false);
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
      {(loading || switching) && (
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

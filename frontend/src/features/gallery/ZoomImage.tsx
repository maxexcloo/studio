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
  navigate,
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  navigate?: (direction: -1 | 1) => void;
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
    if (event.type === "pointercancel") suppressClick.current = true;
    else if (
      navigate &&
      start.touch &&
      start.image &&
      start.fit &&
      !start.multiple &&
      zoom.modeRef.current === "Fit" &&
      Math.abs(dx) > 64 &&
      Math.abs(dx) > Math.abs(dy) * 1.3
    ) {
      suppressClick.current = true;
      navigate(dx < 0 ? 1 : -1);
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
        Click to cycle Fit, Fill and Actual Size. Drag to pan. Use the mouse wheel or pinch to zoom.
        {navigate && " Swipe left or right at Fit to move between generations."}
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
              zoom.cycle();
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

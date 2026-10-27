import { useRef, useState } from "react";
import { Group, Slider, Text } from "@mantine/core";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { MediaZoomControls, useMediaZoom } from "./MediaZoom";
import classes from "./MediaComparison.module.css";

export function MediaComparison({
  original,
  upscale,
  width,
  height,
}: {
  original: string;
  upscale: string;
  width?: number;
  height?: number;
}) {
  const [position, setPosition] = useState(50);
  const [size, setSize] = useState({ width: width || 1, height: height || 1 });
  const zoom = useMediaZoom(size);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

  return (
    <div className={classes.layout}>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          Original
        </Text>
        <Text size="xs" c="dimmed">
          Upscale
        </Text>
      </Group>
      <div
        ref={zoom.viewport}
        className={classes.viewport}
        aria-label="Comparison Viewport"
        data-zoom-mode={zoom.mode}
        onPointerDownCapture={(event) => {
          pointer.current = { x: event.clientX, y: event.clientY };
          dragged.current = false;
        }}
        onPointerMoveCapture={(event) => {
          if (
            pointer.current &&
            Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) > 5
          )
            dragged.current = true;
        }}
        onPointerUpCapture={() => {
          pointer.current = null;
        }}
        onPointerCancelCapture={() => {
          pointer.current = null;
          dragged.current = true;
        }}
        onClickCapture={(event) => {
          if (dragged.current && event.detail !== 0) {
            event.preventDefault();
            event.stopPropagation();
            dragged.current = false;
          }
        }}
      >
        <TransformWrapper
          ref={zoom.transform}
          minScale={0.0001}
          maxScale={1000}
          limitToBounds
          centerZoomedOut
          disablePadding
          doubleClick={{ disabled: true }}
          panning={{ velocityDisabled: true }}
          zoomAnimation={{ disabled: zoom.duration === 0, animationTime: zoom.duration }}
          autoAlignment={{ animationTime: zoom.duration, velocityAlignmentTime: zoom.duration }}
          onWheelStart={zoom.manualZoom}
          onWheel={zoom.revealControls}
          onPinchStart={() => {
            dragged.current = true;
            zoom.manualZoom();
          }}
          onPinch={zoom.revealControls}
          onTransform={zoom.onTransform}
        >
          <TransformComponent
            wrapperStyle={{ width: "100%", height: "100%", overflow: "clip" }}
            contentStyle={{ width: size.width, height: size.height }}
          >
            <button
              ref={zoom.picture}
              type="button"
              className={classes.picture}
              aria-label="Change Comparison Zoom"
              style={{ width: size.width, height: size.height }}
              onClick={(event) => {
                event.stopPropagation();
                zoom.cycle();
              }}
            >
              <img
                src={upscale}
                alt="Upscaled Result"
                draggable={false}
                onLoad={(event) =>
                  setSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
              <div
                className={classes.original}
                style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
              >
                <img
                  src={original}
                  alt="Original Result"
                  draggable={false}
                  onError={(event) => {
                    event.currentTarget.hidden = true;
                  }}
                />
              </div>
              <div className={classes.divider} style={{ left: `${position}%` }} />
            </button>
          </TransformComponent>
        </TransformWrapper>
        <MediaZoomControls zoom={zoom} />
      </div>
      <div onClick={(event) => event.stopPropagation()}>
        <Slider
          thumbLabel="Comparison Position"
          value={position}
          onChange={setPosition}
          min={0}
          max={100}
          label={(value) => `${value}% original`}
        />
      </div>
    </div>
  );
}

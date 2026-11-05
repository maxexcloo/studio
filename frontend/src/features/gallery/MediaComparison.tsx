import { useRef, useState } from "react";
import { Group, Slider, Text } from "@mantine/core";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { usePhone } from "../../ui/usePhone";
import { MediaZoomControls, useMediaZoom } from "./MediaZoom";
import classes from "./MediaComparison.module.css";

const name = (label: string) => (
  <Text size="xs" c="dimmed">
    {label}
  </Text>
);

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
  // Phones stack the upscale over the original, the share of original rising from the bottom
  // with the vertical slider's value; desktop shows the original from the left.
  const vertical = usePhone();
  const [position, setPosition] = useState(50);
  const [size, setSize] = useState({ width: width || 1, height: height || 1 });
  const zoom = useMediaZoom(size);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

  return (
    <div className={classes.layout} data-vertical={vertical || undefined}>
      {vertical ? (
        name("Upscale")
      ) : (
        <Group justify="space-between">
          {name("Original")}
          {name("Upscale")}
        </Group>
      )}
      <div className={classes.stage}>
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
                  style={{
                    clipPath: vertical
                      ? `inset(${100 - position}% 0 0 0)`
                      : `inset(0 ${100 - position}% 0 0)`,
                  }}
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
                <div
                  className={classes.divider}
                  style={vertical ? { top: `${100 - position}%` } : { left: `${position}%` }}
                />
              </button>
            </TransformComponent>
          </TransformWrapper>
          <MediaZoomControls zoom={zoom} />
        </div>
        <div className={classes.slider} onClick={(event) => event.stopPropagation()}>
          <Slider
            orientation={vertical ? "vertical" : "horizontal"}
            h={vertical ? "100%" : undefined}
            thumbLabel="Comparison Position"
            value={position}
            onChange={setPosition}
            min={0}
            max={100}
            // A vertical slider's label would sit past the screen's edge; the divider shows it.
            label={vertical ? null : (value) => `${value}% original`}
          />
        </div>
      </div>
      {vertical && name("Original")}
    </div>
  );
}

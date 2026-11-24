import { Group, Text } from "@mantine/core";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

import { icons } from "../../ui/icons";
import { usePhone } from "../../ui/usePhone";
import { MediaZoomControls, useMediaZoom } from "./MediaZoom";

import classes from "./MediaComparison.module.css";

const name = (label: string) => (
  <Text size="xs" c="dimmed">
    {label}
  </Text>
);

export interface ComparisonImage {
  src: string;
  label: string;
  alt?: string;
}

export function MediaComparison({
  first,
  second,
  width,
  height,
  inPage = false,
}: {
  first: ComparisonImage;
  second: ComparisonImage;
  width?: number;
  height?: number;
  inPage?: boolean;
}) {
  // Phones reveal the first image from the bottom, while desktop reveals it from the left.
  const vertical = usePhone();
  const [position, setPosition] = useState(50);
  const [size, setSize] = useState({ width: width || 1, height: height || 1 });
  const zoom = useMediaZoom(size);
  const allowScroll = inPage && zoom.mode === "Fit";
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const dividing = useRef<number | null>(null);
  const moveDivider = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = zoom.picture.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return;
    const fraction = vertical
      ? (bounds.bottom - event.clientY) / bounds.height
      : (event.clientX - bounds.left) / bounds.width;
    setPosition(Math.round(Math.max(0, Math.min(1, fraction)) * 100));
  };
  const steps: Record<string, (value: number) => number> = {
    ArrowDown: (value) => value - 1,
    ArrowLeft: (value) => value - 1,
    ArrowRight: (value) => value + 1,
    ArrowUp: (value) => value + 1,
    End: () => 100,
    Home: () => 0,
    PageDown: (value) => value - 10,
    PageUp: (value) => value + 10,
  };
  const keyDivider = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    setPosition((value) => Math.max(0, Math.min(100, step(value))));
  };

  return (
    <div className={classes.layout} data-vertical={vertical || undefined}>
      {vertical ? (
        name(second.label)
      ) : (
        <Group justify="space-between">
          {name(first.label)}
          {name(second.label)}
        </Group>
      )}
      <div
        ref={zoom.viewport}
        className={classes.viewport}
        aria-label="Comparison Viewport"
        data-zoom-mode={zoom.mode}
        data-allow-scroll={allowScroll || undefined}
        onPointerDownCapture={(event) => {
          if (
            event.isPrimary &&
            event.button === 0 &&
            (event.target as Element).closest("[data-comparison-divider]")
          ) {
            event.preventDefault();
            event.stopPropagation();
            dividing.current = event.pointerId;
            dragged.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
          }
          pointer.current = { x: event.clientX, y: event.clientY };
          dragged.current = false;
        }}
        onPointerMoveCapture={(event) => {
          if (dividing.current === event.pointerId) {
            moveDivider(event);
            return;
          }
          if (
            pointer.current &&
            Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) > 5
          )
            dragged.current = true;
        }}
        onPointerUpCapture={(event) => {
          if (dividing.current === event.pointerId) moveDivider(event);
          pointer.current = null;
        }}
        onPointerCancelCapture={() => {
          pointer.current = null;
          dragged.current = true;
        }}
        onLostPointerCapture={(event) => {
          if (dividing.current === event.pointerId) dividing.current = null;
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
          panning={{ disabled: allowScroll, velocityDisabled: true, excluded: [classes.divider] }}
          wheel={inPage ? { activationKeys: ["Control"] } : undefined}
          zoomAnimation={{ disabled: zoom.duration === 0, animationTime: zoom.duration }}
          autoAlignment={{ animationTime: zoom.duration, velocityAlignmentTime: zoom.duration }}
          onWheelStart={zoom.manualZoom}
          onWheel={zoom.revealControls}
          onPinchStart={() => {
            dragged.current = true;
            zoom.manualZoom();
          }}
          onPinch={zoom.revealControls}
          onTransform={(reference, state) => {
            zoom.onTransform(reference, state);
            zoom.viewport.current?.style.setProperty("--comparison-scale", String(state.scale));
          }}
        >
          <TransformComponent
            wrapperStyle={{ width: "100%", height: "100%", overflow: "clip" }}
            contentStyle={{ width: size.width, height: size.height }}
          >
            <div className={classes.frame} style={{ width: size.width, height: size.height }}>
              <button
                ref={zoom.picture}
                type="button"
                className={classes.picture}
                aria-label="Change Comparison Zoom"
                onClick={(event) => {
                  event.stopPropagation();
                  zoom.cycle();
                }}
              >
                <img
                  src={second.src}
                  alt={second.alt || second.label}
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
                    src={first.src}
                    alt={first.alt || first.label}
                    draggable={false}
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                  />
                </div>
              </button>
              <div
                role="slider"
                tabIndex={0}
                aria-label="Comparison Position"
                aria-orientation={vertical ? "vertical" : "horizontal"}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={position}
                aria-valuetext={`${position}% ${first.label}`}
                data-comparison-divider
                className={classes.divider}
                style={vertical ? { top: `${100 - position}%` } : { left: `${position}%` }}
                onKeyDown={keyDivider}
              >
                <span className={classes.handle}>
                  <icons.compareSideBySide size={16} />
                </span>
              </div>
            </div>
          </TransformComponent>
        </TransformWrapper>
        <MediaZoomControls zoom={zoom} />
      </div>
      {vertical && name(first.label)}
    </div>
  );
}

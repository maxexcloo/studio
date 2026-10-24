import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Group,
  LoadingOverlay,
  Modal,
  SegmentedControl,
  Slider,
  Stack,
  Text,
} from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import type { ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import type { ReferenceAsset } from "../../types";
import { useMotionDuration } from "../../ui/Appearance";
import classes from "./MaskEditor.module.css";

type Snapshot = { pixels: ImageData; error: string | null };

export default function MaskEditor({
  asset,
  initialMask,
  close,
  save,
}: {
  asset: ReferenceAsset;
  initialMask?: string;
  close: () => void;
  save: (data: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const transform = useRef<ReactZoomPanPinchRef>(null);
  const percentage = useRef<HTMLSpanElement>(null);
  const pinching = useRef(false);
  const [spaceHand, setSpaceHand] = useState(false);
  const duration = useMotionDuration();
  const [brush, setBrush] = useState(50);
  const [tool, setTool] = useState("paint");
  const [loading, setLoading] = useState(Boolean(initialMask));
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const touchStroke = useRef<{
    snapshot: Snapshot;
    undo: Snapshot[];
    redo: Snapshot[];
  } | null>(null);
  const drawing = useRef<number | null>(null);
  const previous = useRef<{ x: number; y: number } | null>(null);
  const ratio = Math.min(1, 1024 / Math.max(asset.width || 1024, asset.height || 1024));
  const width = Math.max(1, Math.round((asset.width || 1024) * ratio));
  const height = Math.max(1, Math.round((asset.height || 1024) * ratio));
  // Bound pixel history (including the live canvas) to about 48 MiB.
  const historyLimit = Math.max(1, Math.floor((48 * 1024 * 1024) / (width * height * 4)) - 1);
  const context = () => canvas.current!.getContext("2d")!;
  const snapshot = (): Snapshot => ({ pixels: context().getImageData(0, 0, width, height), error });
  function historyChanged() {
    setHistory({ undo: undoStack.current.length, redo: redoStack.current.length });
  }
  function remember() {
    const saved = snapshot();
    undoStack.current.push(saved);
    if (undoStack.current.length > historyLimit) undoStack.current.shift();
    redoStack.current = [];
    historyChanged();
    return saved;
  }
  function restore(from: Snapshot[], to: Snapshot[]) {
    if (loading || drawing.current !== null || !from.length) return;
    const saved = from.pop()!;
    to.push(snapshot());
    context().putImageData(saved.pixels, 0, 0);
    setError(saved.error);
    historyChanged();
  }
  const undo = () => restore(undoStack.current, redoStack.current);
  const redo = () => restore(redoStack.current, undoStack.current);
  useHotkeys([
    ["mod+Z", undo],
    ["mod+shift+Z", redo],
    ["mod+Y", redo],
  ]);

  useEffect(() => {
    if (!initialMask) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      try {
        const ctx = context();
        ctx.drawImage(image, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const alpha = (pixels.data[i] * pixels.data[i + 3]) / 255;
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
          pixels.data[i + 3] = alpha;
        }
        ctx.putImageData(pixels, 0, 0);
      } catch {
        context().clearRect(0, 0, width, height);
        setError(
          "The saved mask could not be opened. Close to keep it, or clear the mask to start again.",
        );
      }
      setLoading(false);
    };
    image.onerror = () => {
      if (!cancelled) {
        setError(
          "The saved mask could not be opened. Close to keep it, or clear the mask to start again.",
        );
        setLoading(false);
      }
    };
    image.src = initialMask;
    return () => {
      cancelled = true;
    };
  }, [initialMask, width, height]);

  const hand = tool === "hand" || spaceHand;
  useEffect(() => {
    function down(event: KeyboardEvent) {
      if (
        event.code !== "Space" ||
        (event.target as HTMLElement).closest(
          'input,textarea,select,button,a,[role="slider"],[role="radio"],[contenteditable="true"]',
        )
      )
        return;
      event.preventDefault();
      setSpaceHand(true);
    }
    function up(event: KeyboardEvent) {
      if (event.code === "Space") setSpaceHand(false);
    }
    const reset = () => setSpaceHand(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
    };
  }, []);

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (drawing.current !== event.pointerId) return;
    const el = event.currentTarget;
    const box = el.getBoundingClientRect();
    const ctx = context();
    ctx.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = ctx.fillStyle = "white";
    ctx.lineWidth = brush;
    ctx.lineCap = ctx.lineJoin = "round";
    const samples = event.nativeEvent.getCoalescedEvents?.() || [];
    for (const sample of samples.length ? samples : [event]) {
      const point = {
        x: ((sample.clientX - box.left) * width) / box.width,
        y: ((sample.clientY - box.top) * height) / box.height,
      };
      ctx.beginPath();
      if (previous.current) {
        ctx.moveTo(previous.current.x, previous.current.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      } else {
        ctx.arc(point.x, point.y, brush / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      previous.current = point;
    }
    ctx.globalCompositeOperation = "source-over";
  }
  function finish(event: PointerEvent<HTMLCanvasElement>) {
    if (drawing.current !== event.pointerId) return;
    drawing.current = null;
    previous.current = null;
    touchStroke.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return (
    <Modal
      opened
      onClose={close}
      title="Paint the Area to Refine"
      closeButtonProps={{ "aria-label": "Close Mask Editor" }}
      size="xl"
      removeScrollProps={{ allowPinchZoom: true }}
    >
      <Stack>
        <Text size="sm" c="dimmed">
          Paint over the parts that should change. The rest of your image is preserved.
        </Text>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        <Box pos="relative" h="min(55dvh, 600px)" w="100%" aria-label="Mask Viewport">
          <LoadingOverlay visible={loading} />
          <TransformWrapper
            ref={transform}
            fitOnInit
            minScale={0.0001}
            maxScale={8}
            centerZoomedOut
            limitToBounds
            disablePadding
            disabled={loading}
            panning={{ disabled: !hand, velocityDisabled: true }}
            doubleClick={{ disabled: true }}
            zoomAnimation={{ disabled: duration === 0, animationTime: duration }}
            autoAlignment={{ animationTime: duration, velocityAlignmentTime: duration }}
            onPinchStart={() => {
              pinching.current = true;
              // A second finger changes a tentative paint stroke into a pinch, not a mask edit.
              const stroke = touchStroke.current;
              if (stroke) {
                context().putImageData(stroke.snapshot.pixels, 0, 0);
                undoStack.current = stroke.undo;
                redoStack.current = stroke.redo;
                historyChanged();
                drawing.current = null;
                previous.current = null;
                touchStroke.current = null;
              }
            }}
            onPinchStop={() => {
              pinching.current = false;
            }}
            onTransform={(_, state) => {
              if (percentage.current)
                percentage.current.textContent = `${Math.round(state.scale * 100)}%`;
            }}
          >
            <TransformComponent
              wrapperStyle={{ width: "100%", height: "100%", overflow: "clip" }}
              contentStyle={{ width, height }}
            >
              <Box className={classes.wrap} style={{ width, height }}>
                <img
                  src={asset.url || asset.thumbnailUrl}
                  alt="Reference to Mask"
                  onError={(event) => {
                    event.currentTarget.hidden = true;
                  }}
                />
                <canvas
                  ref={canvas}
                  className={classes.mask}
                  aria-label="Mask Painting"
                  tabIndex={0}
                  style={{ cursor: hand ? "grab" : "crosshair" }}
                  width={width}
                  height={height}
                  onPointerDown={(event) => {
                    if (
                      loading ||
                      error ||
                      hand ||
                      pinching.current ||
                      event.button !== 0 ||
                      drawing.current !== null
                    )
                      return;
                    event.currentTarget.focus({ preventScroll: true });
                    const undo = [...undoStack.current],
                      redo = [...redoStack.current];
                    const saved = remember();
                    touchStroke.current =
                      event.pointerType === "touch" ? { snapshot: saved, undo, redo } : null;
                    drawing.current = event.pointerId;
                    previous.current = null;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    draw(event);
                  }}
                  onPointerMove={draw}
                  onPointerUp={finish}
                  onPointerCancel={finish}
                  onLostPointerCapture={finish}
                />
              </Box>
            </TransformComponent>
          </TransformWrapper>
        </Box>
        <Group justify="center" gap="xs" aria-label="Mask Zoom">
          <Button
            variant="default"
            size="compact-sm"
            aria-label="Zoom Mask Out"
            disabled={loading}
            onClick={() => void transform.current?.zoomOut(0.2, duration)}
          >
            −
          </Button>
          <Button
            variant="default"
            size="compact-sm"
            aria-label="Fit Mask"
            disabled={loading}
            onClick={() => {
              if (canvas.current)
                void transform.current?.zoomToElement(canvas.current, undefined, duration);
            }}
          >
            Fit · <span ref={percentage}>100%</span>
          </Button>
          <Button
            variant="default"
            size="compact-sm"
            aria-label="Zoom Mask In"
            disabled={loading}
            onClick={() => void transform.current?.zoomIn(0.2, duration)}
          >
            +
          </Button>
        </Group>
        <Group justify="space-between">
          <SegmentedControl
            aria-label="Mask Tool"
            value={tool}
            onChange={setTool}
            disabled={loading}
            data={[
              { label: "Paint", value: "paint" },
              { label: "Erase", value: "erase" },
              { label: "Hand", value: "hand" },
            ]}
          />
          <Group gap="xs">
            <Button variant="default" disabled={loading || !history.undo} onClick={undo}>
              Undo
            </Button>
            <Button variant="default" disabled={loading || !history.redo} onClick={redo}>
              Redo
            </Button>
          </Group>
        </Group>
        <Text size="sm" id="mask-brush-label">
          Brush Size
        </Text>
        <Slider
          aria-labelledby="mask-brush-label"
          thumbLabel="Brush Size"
          min={10}
          max={150}
          value={brush}
          onChange={setBrush}
          disabled={loading}
        />
        <Group justify="space-between">
          <Button
            variant="default"
            disabled={loading}
            onClick={() => {
              remember();
              context().clearRect(0, 0, width, height);
              setError(null);
            }}
          >
            Clear Mask
          </Button>
          <Button
            disabled={loading || Boolean(error)}
            onClick={() => {
              const output = document.createElement("canvas");
              output.width = width;
              output.height = height;
              const ctx = output.getContext("2d")!;
              ctx.fillStyle = "black";
              ctx.fillRect(0, 0, width, height);
              ctx.drawImage(canvas.current!, 0, 0);
              save(output.toDataURL("image/png"));
              close();
            }}
          >
            Use Mask
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

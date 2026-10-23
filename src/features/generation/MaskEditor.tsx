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
import type { ReferenceAsset } from "../../types";

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
  const [brush, setBrush] = useState(50);
  const [tool, setTool] = useState("paint");
  const [loading, setLoading] = useState(Boolean(initialMask));
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
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
    undoStack.current.push(snapshot());
    if (undoStack.current.length > historyLimit) undoStack.current.shift();
    redoStack.current = [];
    historyChanged();
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
        <Box
          className="studio-mask-wrap"
          style={{ aspectRatio: `${width}/${height}`, width: "100%" }}
        >
          <LoadingOverlay visible={loading} />
          <img
            src={asset.url || asset.thumbnailUrl}
            alt="Reference to Mask"
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
          <canvas
            ref={canvas}
            className="studio-mask"
            aria-label="Mask Painting"
            width={width}
            height={height}
            onPointerDown={(event) => {
              if (loading || error || event.button !== 0 || drawing.current !== null) return;
              remember();
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
        <Group justify="space-between">
          <SegmentedControl
            aria-label="Mask Tool"
            value={tool}
            onChange={setTool}
            disabled={loading}
            data={[
              { label: "Paint", value: "paint" },
              { label: "Erase", value: "erase" },
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

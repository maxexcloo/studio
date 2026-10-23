import { useRef, useState } from "react";
import { Button, Group, Modal, Slider, Stack, Text } from "@mantine/core";
import type { ReferenceAsset } from "../../types";
export default function MaskEditor({
  asset,
  close,
  save,
}: {
  asset: ReferenceAsset;
  close: () => void;
  save: (data: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [brush, setBrush] = useState(50);
  const drawing = useRef(false);
  const previous = useRef<{ x: number; y: number } | null>(null);
  const width = Math.min(asset.width || 1024, 1024);
  const height = Math.round((width * (asset.height || 1024)) / (asset.width || 1024));
  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const el = event.currentTarget,
      box = el.getBoundingClientRect(),
      context = el.getContext("2d")!;
    const point = {
      x: ((event.clientX - box.left) * el.width) / box.width,
      y: ((event.clientY - box.top) * el.height) / box.height,
    };
    context.strokeStyle = "white";
    context.fillStyle = "white";
    context.lineWidth = brush;
    context.lineCap = "round";
    context.beginPath();
    if (previous.current) {
      context.moveTo(previous.current.x, previous.current.y);
      context.lineTo(point.x, point.y);
      context.stroke();
    } else {
      context.arc(point.x, point.y, brush / 2, 0, Math.PI * 2);
      context.fill();
    }
    previous.current = point;
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
        <div className="studio-mask-wrap" style={{ aspectRatio: `${width}/${height}` }}>
          <img
            src={asset.url || asset.thumbnailUrl}
            alt="Reference to Mask"
            onError={(e) => {
              e.currentTarget.hidden = true;
            }}
          />
          <canvas
            ref={canvas}
            className="studio-mask"
            width={width}
            height={height}
            onPointerDown={(event) => {
              drawing.current = true;
              previous.current = null;
              event.currentTarget.setPointerCapture(event.pointerId);
              draw(event);
            }}
            onPointerMove={draw}
            onPointerUp={() => {
              drawing.current = false;
              previous.current = null;
            }}
            onPointerCancel={() => {
              drawing.current = false;
              previous.current = null;
            }}
          />
        </div>
        <Text size="sm">Brush Size</Text>
        <Slider thumbLabel="Brush Size" min={10} max={150} value={brush} onChange={setBrush} />
        <Group justify="space-between">
          <Button
            variant="default"
            onClick={() => canvas.current?.getContext("2d")?.clearRect(0, 0, width, height)}
          >
            Clear Mask
          </Button>
          <Button
            onClick={() => {
              const el = canvas.current!;
              const output = document.createElement("canvas");
              output.width = width;
              output.height = height;
              const ctx = output.getContext("2d")!;
              ctx.fillStyle = "black";
              ctx.fillRect(0, 0, width, height);
              ctx.drawImage(el, 0, 0);
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

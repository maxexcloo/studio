import { useState } from "react";
import { Group, Slider, Stack, Text } from "@mantine/core";
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
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          Original
        </Text>
        <Text size="xs" c="dimmed">
          Upscale
        </Text>
      </Group>
      <div className="studio-comparison" style={{ aspectRatio: `${width || 1}/${height || 1}` }}>
        <img
          src={upscale}
          alt="Upscaled Result"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
        <div
          className="studio-comparison-original"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        >
          <img
            src={original}
            alt="Original Result"
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
        </div>
        <div className="studio-comparison-divider" style={{ left: `${position}%` }} />
      </div>
      <Slider
        thumbLabel="Comparison Position"
        value={position}
        onChange={setPosition}
        min={0}
        max={100}
        label={(value) => `${value}% original`}
      />
    </Stack>
  );
}

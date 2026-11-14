import { Group, NumberInput, Slider } from "@mantine/core";
import { useState } from "react";

/**
 * A strength as a slider with its exact value beside it, for a LoRA or a guiding reference.
 * Dragging previews locally and commits once, so the draft doesn't rerender every frame.
 */
export function StrengthControl({
  label,
  value,
  min,
  max,
  step,
  mark,
  onChange,
}: {
  /** The accessible name of both fields, such as "Detail LoRA Strength". */
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** A default to mark on the track. */
  mark?: number;
  onChange: (value: number) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const current = dragging ?? value;
  return (
    <Group gap="sm" wrap="nowrap">
      <Slider
        flex={1}
        size="sm"
        min={min}
        max={max}
        step={step}
        value={current}
        thumbLabel={label}
        marks={mark !== undefined ? [{ value: mark }] : undefined}
        onChange={setDragging}
        onChangeEnd={(value) => {
          setDragging(null);
          onChange(value);
        }}
      />
      <NumberInput
        size="xs"
        w={76}
        aria-label={label}
        value={current}
        min={min}
        max={max}
        clampBehavior="blur"
        hideControls
        step={step}
        onChange={(value) => {
          if (value !== "" && Number.isFinite(Number(value))) onChange(Number(value));
        }}
      />
    </Group>
  );
}

import {
  Button,
  NumberInput,
  Popover,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { useState } from "react";
import type { GenerationInput, Profile } from "../../types";
import { primaryReference } from "./payload";
export function SizePicker({
  input,
  profile,
  onChange,
}: {
  input: GenerationInput;
  profile?: Profile;
  onChange: (patch: Partial<GenerationInput>) => void;
}) {
  const [mode, setMode] = useState("presets");
  const presets = profile?.aspectPresets || [];
  const reference = primaryReference(input.referenceDetails || [], profile);
  const framed =
    profile?.aspectPolicy === "reference" &&
    (input.referenceRole !== "reference" || Boolean(input.inpaint)) &&
    reference &&
    reference.width > 0 &&
    reference.height > 0
      ? reference
      : undefined;
  const divisor = (a: number, b: number): number => (b ? divisor(b, a % b) : a);
  const common = framed ? divisor(framed.width, framed.height) : 1;
  const aspect = framed ? `${framed.width / common}:${framed.height / common}` : "";
  return (
    <Popover position="top-start" width={300} trapFocus shadow="md">
      <Popover.Target>
        <Button variant="default" size="sm" aria-label="Image Size">
          {framed ? `Reference · ${aspect}` : `${input.width} × ${input.height}`}
        </Button>
      </Popover.Target>
      <Popover.Dropdown
        data-composer-layer
        onFocusCapture={(event) => {
          // Mantine overlays reserve Escape for the focused inner control.
          (event.target as HTMLElement).setAttribute("data-mantine-stop-propagation", "true");
        }}
      >
        <Stack gap="sm">
          <Text fw={500} size="sm">
            Size & Aspect
          </Text>
          {framed ? (
            <Stack gap="xs">
              <Text size="sm">The reference sets the output framing to {aspect}.</Text>
              <Text size="xs" c="dimmed">
                Remove the reference or use Reference mode to choose a different aspect. Your custom
                size is kept for when you return.
              </Text>
            </Stack>
          ) : (
            <>
              <SegmentedControl
                value={mode}
                onChange={setMode}
                data={[
                  { value: "presets", label: "Presets" },
                  { value: "custom", label: "Custom" },
                ]}
                size="xs"
              />
              {mode === "presets" ? (
                <Stack gap="xs">
                  {presets.length ? (
                    presets.map((preset) => (
                      <Button
                        key={`${preset.w}:${preset.h}`}
                        size="sm"
                        fullWidth
                        justify="space-between"
                        aria-pressed={input.width === preset.w && input.height === preset.h}
                        rightSection={
                          <Text component="span" size="xs" c="dimmed">
                            {preset.w} × {preset.h}
                          </Text>
                        }
                        variant={
                          input.width === preset.w && input.height === preset.h
                            ? "light"
                            : "default"
                        }
                        onClick={() => onChange({ width: preset.w, height: preset.h })}
                      >
                        {preset.label}
                      </Button>
                    ))
                  ) : (
                    <Text c="dimmed" size="xs">
                      This profile has no size presets. Set a custom size.
                    </Text>
                  )}
                </Stack>
              ) : (
                <SimpleGrid cols={2}>
                  {(["width", "height"] as const).map((key) => (
                    <NumberInput
                      key={key}
                      label={key === "width" ? "Width" : "Height"}
                      value={input[key]}
                      min={profile?.constraints?.[key]?.min}
                      max={profile?.constraints?.[key]?.max}
                      step={profile?.constraints?.[key]?.step}
                      onChange={(value) => onChange({ [key]: Number(value) })}
                    />
                  ))}
                </SimpleGrid>
              )}
            </>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

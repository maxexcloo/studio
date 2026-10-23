import {
  Button,
  Group,
  NumberInput,
  Popover,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { useState } from "react";
import type { GenerationInput, Profile } from "../../types";
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
  return (
    <Popover position="top-start" width={300} trapFocus shadow="md">
      <Popover.Target>
        <Button variant="default" size="sm" aria-label="Image Size">
          {input.width} × {input.height}
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
            <Group gap="xs">
              {presets.length ? (
                presets.map((preset) => (
                  <Button
                    key={`${preset.w}:${preset.h}`}
                    size="compact-sm"
                    variant={
                      input.width === preset.w && input.height === preset.h ? "light" : "default"
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
            </Group>
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
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

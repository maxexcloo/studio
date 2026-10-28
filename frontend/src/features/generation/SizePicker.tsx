import {
  Button,
  NumberInput,
  Popover,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { ChevronDown, RectangleHorizontal } from "lucide-react";
import type { GenerationInput, Profile } from "../../types";
import { chipProps } from "./chip";
import { primaryReference } from "./payload";
import {
  defaultResolution,
  resolutionApplies,
  resolutionPlan,
  resolutions,
  resolutionSize,
  type Resolution,
} from "../../../../shared/resolution";

type Size = { w: number; h: number };

export function SizePicker({
  input,
  profile,
  onChange,
}: {
  input: GenerationInput;
  profile?: Profile;
  onChange: (patch: Partial<GenerationInput>) => void;
}) {
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
  // Images whose size is the composer's to pick draw at a tier; the shape comes from the preset.
  const tiered = resolutionApplies(input, profile);
  const tier = input.resolutionTier || defaultResolution;
  const plan = resolutionPlan(profile, tier);
  const at = (size: Size) => {
    const { width, height } = resolutionSize({ width: size.w, height: size.h }, tier, profile);
    return { w: width, h: height };
  };
  const current = { w: input.width, h: input.height };
  const shown = tiered ? at(current) : current;
  // A preset of the current shape is the active one; the exact size is in the title.
  const active = presets.find((preset) => preset.w * current.h === preset.h * current.w);
  const label = framed
    ? `Reference · ${aspect}`
    : active
      ? `${active.label}${tiered ? ` · ${tier}` : ""}`
      : `${shown.w} × ${shown.h}`;
  return (
    <Popover position="top-start" width={300} trapFocus>
      <Popover.Target>
        <Button
          {...chipProps}
          aria-label="Aspect"
          title={framed ? undefined : `${shown.w} × ${shown.h}`}
          leftSection={<RectangleHorizontal size={16} />}
          rightSection={<ChevronDown size={14} />}
        >
          {label}
        </Button>
      </Popover.Target>
      <Popover.Dropdown
        data-composer-layer
        aria-label="Size & Aspect"
        onFocusCapture={(event) => {
          // Mantine overlays reserve Escape for the focused inner control.
          (event.target as HTMLElement).setAttribute("data-mantine-stop-propagation", "true");
        }}
      >
        {framed ? (
          <Stack gap="xs">
            <Text size="sm">The reference sets the output framing to {aspect}.</Text>
            <Text size="xs" c="dimmed">
              Remove the reference or use Reference mode to choose a different aspect. Your custom
              size is kept for when you return.
            </Text>
          </Stack>
        ) : (
          <Stack gap="sm">
            {tiered && (
              <Stack gap={4}>
                <SegmentedControl
                  aria-label="Resolution"
                  fullWidth
                  value={tier}
                  onChange={(value) => onChange({ resolutionTier: value as Resolution })}
                  data={[...resolutions]}
                />
                {plan.upscaleTo && (
                  <Text size="xs" c="dimmed">
                    This model draws {tier} at {plan.draws}, then Upscale enlarges it.
                  </Text>
                )}
              </Stack>
            )}
            {!!presets.length && (
              <Stack gap={4} role="group" aria-label="Aspect Presets">
                {presets.map((preset) => {
                  const size = tiered ? at(preset) : preset;
                  const selected = preset === active;
                  return (
                    <Button
                      key={preset.label}
                      fullWidth
                      justify="space-between"
                      variant={selected ? "light" : "subtle"}
                      color={selected ? undefined : "gray"}
                      aria-pressed={selected}
                      rightSection={
                        <Text component="span" size="xs" c="dimmed">
                          {size.w} × {size.h}
                        </Text>
                      }
                      onClick={() => onChange({ width: preset.w, height: preset.h })}
                    >
                      {preset.label}
                    </Button>
                  );
                })}
              </Stack>
            )}
            {!tiered && (
              <SimpleGrid cols={2} spacing="xs">
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
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

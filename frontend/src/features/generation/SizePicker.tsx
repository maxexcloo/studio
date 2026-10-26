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

type Tier = "standard" | "2k" | "4k";
const tierLabels: Record<Tier, string> = { standard: "Standard", "2k": "2K", "4k": "4K" };
type Size = { w: number; h: number };

/** A preset drawn with its long side at the tier's size, snapped to 64 within the profile's limit. */
function drawnAt(size: Size, tier: Tier, max: number): Size {
  if (tier === "standard") return size;
  const scale = Math.min(tier === "4k" ? 4096 : 2048, max) / Math.max(size.w, size.h);
  const snap = (value: number) =>
    Math.max(64, Math.min(max, Math.round((value * scale) / 64) * 64));
  return { w: snap(size.w), h: snap(size.h) };
}

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
  const max = Math.min(
    profile?.constraints?.width?.max ?? 8192,
    profile?.constraints?.height?.max ?? 8192,
  );
  // 2K/4K only where the model draws them itself and the output size is the composer's to pick.
  const tiers: Tier[] = [
    "standard",
    ...(["2k", "4k"] as const).filter(
      (tier) => input.kind === "image" && !input.inpaint && profile?.native?.[tier],
    ),
  ];
  const current = { w: input.width, h: input.height };
  const same = (a: Size, b: Size) => a.w === b.w && a.h === b.h;
  const tier =
    tiers.find((tier) => presets.some((preset) => same(drawnAt(preset, tier, max), current))) ||
    "standard";
  const active = presets.find((preset) => same(drawnAt(preset, tier, max), current));
  const apply = ({ w, h }: Size) => onChange({ width: w, height: h });
  function changeTier(next: Tier) {
    // Keep the chosen shape: the active preset, else the preset nearest the current ratio.
    const ratio = current.w / current.h;
    const shape =
      active ||
      [...presets].sort((a, b) => Math.abs(a.w / a.h - ratio) - Math.abs(b.w / b.h - ratio))[0] ||
      current;
    apply(drawnAt(shape, next, max));
  }
  // A custom size of a preset's shape still reads as that aspect; the exact size is in the title.
  const shaped = presets.find((preset) => preset.w * current.h === preset.h * current.w);
  const label = framed
    ? `Reference · ${aspect}`
    : active
      ? `${active.label}${tier === "standard" ? "" : ` · ${tierLabels[tier]}`}`
      : shaped
        ? shaped.label
        : `${input.width} × ${input.height}`;
  return (
    <Popover position="top-start" width={300} trapFocus>
      <Popover.Target>
        <Button
          {...chipProps}
          aria-label="Aspect"
          title={framed ? undefined : `${input.width} × ${input.height}`}
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
            {tiers.length > 1 && (
              <SegmentedControl
                aria-label="Resolution"
                fullWidth
                size="xs"
                value={tier}
                onChange={(value) => changeTier(value as Tier)}
                data={tiers.map((value) => ({ value, label: tierLabels[value] }))}
              />
            )}
            {tier !== "standard" && profile?.native?.[tier] === "maybe" && (
              <Text size="xs" c="dimmed">
                This model isn’t known for {tierLabels[tier]}. Some pictures may repeat or warp.
              </Text>
            )}
            {!!presets.length && (
              <Stack gap={4} role="group" aria-label="Aspect Presets">
                {presets.map((preset) => {
                  const size = drawnAt(preset, tier, max);
                  const selected = preset === active;
                  return (
                    <Button
                      key={preset.label}
                      size="sm"
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
                      onClick={() => apply(size)}
                    >
                      {preset.label}
                    </Button>
                  );
                })}
              </Stack>
            )}
            <SimpleGrid cols={2} spacing="xs">
              {(["width", "height"] as const).map((key) => (
                <NumberInput
                  key={key}
                  size="sm"
                  label={key === "width" ? "Width" : "Height"}
                  value={input[key]}
                  min={profile?.constraints?.[key]?.min}
                  max={profile?.constraints?.[key]?.max}
                  step={profile?.constraints?.[key]?.step}
                  onChange={(value) => onChange({ [key]: Number(value) })}
                />
              ))}
            </SimpleGrid>
          </Stack>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

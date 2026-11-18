import {
  Button,
  FocusTrap,
  NumberInput,
  Popover,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { ChevronDown, RectangleHorizontal } from "lucide-react";
import { useState } from "react";

import {
  availableResolutions,
  isResolution,
  orderedAspects,
  resolutionSize,
  selectedResolution,
} from "../../../../shared/resolution";
import type { GenerationInput, Profile } from "../../types";
import { useTouch } from "../../ui/usePhone";
import { chipProps, fittedPopup } from "./chip";
import { primaryReference } from "./payload";

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
  const touch = useTouch();
  const presets = orderedAspects(profile?.aspectPresets || []);
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
  const choices = availableResolutions(profile, input);
  const tier = selectedResolution(input, profile);
  // A model with its own resolutions (Grok's 1K or 2K, 480p to 1080p) takes the shape from the
  // aspect and the size from its resolution: a preset shows the size it draws there where known.
  const native = profile?.options?.resolutions || [];
  const nativeResolution = String(
    input.resolution ||
      profile?.defaults?.resolution ||
      (input.kind === "video" ? "720p" : Math.max(input.width, input.height) > 1280 ? "2k" : "1k"),
  );
  // One tab per resolution the presets draw at (a single one reads Presets), then Custom's own
  // width and height where the model takes any size.
  const views: string[] = native.length ? native : choices.length ? choices : ["presets"];
  const tabs = [
    ...(presets.length
      ? views.map((value) => ({
          value,
          label: views.length > 1 ? value.toUpperCase() : "Presets",
        }))
      : []),
    ...(native.length ? [] : [{ value: "custom", label: "Custom" }]),
  ];
  const sizeAt = (preset: Size, view: string): Size | undefined => {
    if (native.length) return (preset as (typeof presets)[number]).sizes?.[view];
    if (!isResolution(view)) return preset;
    const { width, height } = resolutionSize({ width: preset.w, height: preset.h }, view, profile);
    return { w: width, h: height };
  };
  const current = { w: input.width, h: input.height };
  const same = (a: Size | undefined, b: Size) => a?.w === b.w && a?.h === b.h;
  // A preset of the current shape is the active one; the exact size is in the title.
  const active = presets.find((preset) => preset.w * current.h === preset.h * current.w);
  // The view whose preset draws the current size, explicitly or by matching it exactly.
  const matched = native.length
    ? nativeResolution
    : tier || views.find((view) => presets.some((preset) => same(sizeAt(preset, view), current)));
  const shown =
    (tier && sizeAt(current, tier)) ||
    (active && native.length && sizeAt(active, matched!)) ||
    current;
  const opening = matched || "custom";
  const [tab, setTab] = useState(opening);
  const view = tabs.some((item) => item.value === tab) ? tab : opening;
  const label = framed
    ? `Reference · ${aspect}`
    : active && matched && matched !== "presets"
      ? `${active.label} · ${matched.toUpperCase()}`
      : active
        ? `${active.label} · ${shown.w} × ${shown.h}`
        : `${shown.w} × ${shown.h}`;
  return (
    <Popover
      position="top-start"
      width={300}
      trapFocus
      onOpen={() => setTab(opening)}
      {...fittedPopup}
    >
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
        {/* Touch screens focus the popup itself, as ChipPopup does, so Width doesn't raise the keyboard. */}
        {touch && <FocusTrap.InitialFocus />}
        {framed ? (
          <Stack gap="xs">
            <Text size="sm">The reference sets the output framing to {aspect}.</Text>
            <Text size="xs" c="dimmed">
              Remove the reference or use Reference mode to change it. Your custom size is kept.
            </Text>
          </Stack>
        ) : (
          <Stack gap="sm">
            {tabs.length > 1 && (
              <SegmentedControl
                aria-label="Resolution"
                fullWidth
                value={view}
                onChange={(value) => {
                  setTab(value);
                  if (native.length) onChange({ resolution: value });
                  else if (isResolution(value)) onChange({ resolutionTier: value });
                  // Custom starts from the size drawn now.
                  else if (value === "custom" && tier)
                    onChange({ width: shown.w, height: shown.h, resolutionTier: undefined });
                }}
                data={tabs}
              />
            )}
            {view === "custom" || !tabs.length ? (
              <SimpleGrid cols={2} spacing="xs">
                {(["width", "height"] as const).map((key) => (
                  <NumberInput
                    key={key}
                    label={key === "width" ? "Width" : "Height"}
                    value={input[key]}
                    min={profile?.constraints?.[key]?.min}
                    max={profile?.constraints?.[key]?.max}
                    step={profile?.constraints?.[key]?.step}
                    onChange={(value) =>
                      onChange({ [key]: Number(value), resolutionTier: undefined })
                    }
                  />
                ))}
              </SimpleGrid>
            ) : (
              <Stack gap={4} role="group" aria-label="Aspect Presets">
                {presets.map((preset) => {
                  const size = sizeAt(preset, view);
                  const selected = preset === active && view === matched;
                  return (
                    <Button
                      key={preset.label}
                      fullWidth
                      justify="space-between"
                      variant={selected ? "light" : "subtle"}
                      color={selected ? undefined : "gray"}
                      aria-pressed={selected}
                      rightSection={
                        size && (
                          <Text component="span" size="xs" c="dimmed">
                            {size.w} × {size.h}
                          </Text>
                        )
                      }
                      onClick={() =>
                        onChange({
                          width: preset.w,
                          height: preset.h,
                          resolutionTier: isResolution(view) ? view : undefined,
                          ...(native.length ? { resolution: view } : {}),
                        })
                      }
                    >
                      {preset.label}
                    </Button>
                  );
                })}
              </Stack>
            )}
          </Stack>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

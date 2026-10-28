import type { ReactNode } from "react";
import { Button, ComboboxPopover, Tooltip } from "@mantine/core";
import { Bookmark, ChevronDown, Columns3, X } from "lucide-react";
import type { GenerationInput, Profile } from "../../types";
import { chipProps, iconChipProps } from "./chip";
import { ExpertSettings } from "./ExpertSettings";
import { LoraPicker, type LoraPickerState } from "./LoraPicker";
import { backendLabel } from "./payload";
import { ChipPopup } from "./Picker";
import { ProfilePicker } from "./ProfilePicker";
import { SizePicker } from "./SizePicker";
import { usePhone } from "../../ui/usePhone";
import classes from "./GenerationInputControls.module.css";

/** A chip's dropdown of a few fixed choices, such as Count or Reference Role. */
function ChoiceChip({
  label,
  value,
  data,
  onChange,
}: {
  label: string;
  value: string;
  data: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
}) {
  return (
    <ComboboxPopover
      allowDeselect={false}
      withCheckIcon={false}
      comboboxProps={{ width: 160, position: "top-start", withinPortal: true }}
      data={data}
      value={value}
      onChange={(next) => next && onChange(next)}
    >
      <ComboboxPopover.Target>
        <Button {...chipProps} aria-label={label} rightSection={<ChevronDown size={14} />}>
          {data.find((item) => item.value === value)?.label}
        </Button>
      </ComboboxPopover.Target>
    </ComboboxPopover>
  );
}

/**
 * The wrapping chip rail shared by the gallery composer and timeline cards, in one order on
 * every breakpoint: what runs (Profile, and its Backend when it has several), what it starts
 * from (Reference Role, References, Mask), what shapes it (LoRAs), what comes out (Aspect,
 * Count, a set Seed), then the tools (Expert, Compare, Presets).
 */
export function GenerationInputControls({
  input,
  profile,
  onChange,
  references,
  hasReferences = false,
  mask,
  presets,
  loraPicker,
  expert,
  onCompare,
}: {
  input: GenerationInput;
  profile?: Profile;
  onChange: (patch: Partial<GenerationInput>) => void;
  references?: ReactNode;
  /** Whether references are placed, which offers the Reference Role choice. */
  hasReferences?: boolean;
  mask?: ReactNode;
  presets?: {
    opened: boolean;
    onOpenedChange: (opened: boolean) => void;
    content: ReactNode;
  };
  loraPicker: LoraPickerState;
  expert: { opened: boolean; onOpenedChange: (opened: boolean) => void };
  /** Opens Compare Variants from this draft; the gallery composer passes it. */
  onCompare?: () => void;
}) {
  const phone = usePhone();
  const countMax = Math.min(profile?.constraints?.count?.max ?? 8, 8);
  const counted = (profile?.capabilities.variations ?? input.kind === "image") && countMax > 1;
  const backends = profile?.backendOptions || [];
  const seed = input.seed === "" || input.seed == null ? "" : String(input.seed);
  return (
    <div className={classes.rail} role="group" aria-label="Generation Inputs">
      <ProfilePicker value={input} onChange={onChange} />
      {profile?.backend && backends.length > 1 && (
        <ChoiceChip
          label="Backend"
          value={input.profileBackend || profile.backend}
          onChange={(profileBackend) => onChange({ profileBackend })}
          data={backends.map((option) => ({
            value: option.id,
            label: option.label || backendLabel(option.id),
          }))}
        />
      )}
      {references && hasReferences && (
        <ChoiceChip
          label="Reference Role"
          value={!input.inpaint && input.referenceRole === "reference" ? "reference" : "edit"}
          onChange={(referenceRole) => onChange({ referenceRole })}
          data={[
            { value: "edit", label: "Edit" },
            // A mask edits the image it is painted on.
            { value: "reference", label: "Reference", disabled: Boolean(input.inpaint) },
          ]}
        />
      )}
      {references}
      {mask}
      {profile?.capabilities.lora && (
        <LoraPicker value={input} onChange={onChange} picker={loraPicker} />
      )}
      <SizePicker input={input} profile={profile} onChange={onChange} />
      {counted && (
        <ChoiceChip
          label="Count"
          value={String(input.count || 1)}
          onChange={(count) => onChange({ count: Number(count) })}
          data={Array.from({ length: countMax }, (_, index) => ({
            value: String(index + 1),
            label: `${index + 1} ${index ? "Images" : "Image"}`,
          }))}
        />
      )}
      {seed && profile?.capabilities.seed !== false && (
        <Button
          {...chipProps}
          aria-label={`Clear Seed ${seed}`}
          rightSection={<X size={14} />}
          onClick={() => onChange({ seed: "" })}
        >
          Seed {seed}
        </Button>
      )}
      <ExpertSettings input={input} profile={profile} onChange={onChange} {...expert} />
      {onCompare && input.kind === "image" && (
        <Tooltip label="Compare Variants" disabled={phone}>
          <Button {...iconChipProps} aria-label="Compare Variants" onClick={onCompare}>
            <Columns3 size={16} />
          </Button>
        </Tooltip>
      )}
      {presets && (
        <ChipPopup
          title="Presets"
          tooltip
          position="top-end"
          width={360}
          opened={presets.opened}
          onOpenedChange={presets.onOpenedChange}
          target={
            <Button
              {...iconChipProps}
              aria-label="Presets"
              aria-expanded={presets.opened}
              onClick={() => presets.onOpenedChange(!presets.opened)}
            >
              <Bookmark size={16} />
            </Button>
          }
        >
          {presets.content}
        </ChipPopup>
      )}
    </div>
  );
}

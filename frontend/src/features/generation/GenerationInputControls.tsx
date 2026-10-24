import { useState, type ReactNode } from "react";
import { Button, ComboboxPopover, Popover, Tooltip } from "@mantine/core";
import { Bookmark, ChevronDown, Columns3, X } from "lucide-react";
import type { GenerationInput, Profile } from "../../types";
import { chipProps, iconChipProps } from "./chip";
import { ExpertSettings } from "./ExpertSettings";
import { LoraPicker, type LoraPickerState } from "./LoraPicker";
import { ProfilePicker } from "./ProfilePicker";
import { SizePicker } from "./SizePicker";
import { usePhone } from "../../ui/usePhone";
import classes from "./GenerationInputControls.module.css";

/** The wrapping chip rail shared by the gallery composer and timeline cards. */
export function GenerationInputControls({
  input,
  profile,
  onChange,
  references,
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
  mask?: ReactNode;
  presets?: (close: () => void) => ReactNode;
  loraPicker: LoraPickerState;
  expert: { opened: boolean; onOpenedChange: (opened: boolean) => void; hasReferences: boolean };
  /** Opens Compare Variants from this draft; the gallery composer passes it. */
  onCompare?: () => void;
}) {
  const phone = usePhone();
  const [presetsOpened, setPresetsOpened] = useState(false);
  const countMax = Math.min(profile?.constraints?.count?.max ?? 8, 8);
  const counted = (profile?.capabilities.variations ?? input.kind === "image") && countMax > 1;
  return (
    <div className={classes.rail} role="group" aria-label="Generation Inputs">
      <ProfilePicker value={input} onChange={onChange} />
      <SizePicker input={input} profile={profile} onChange={onChange} />
      {counted && (
        <ComboboxPopover
          allowDeselect={false}
          withCheckIcon={false}
          comboboxProps={{ width: 140, position: "top-start", withinPortal: true }}
          data={Array.from({ length: countMax }, (_, index) => ({
            value: String(index + 1),
            label: `${index + 1} ${index ? "Images" : "Image"}`,
          }))}
          value={String(input.count || 1)}
          onChange={(value) => value && onChange({ count: Number(value) })}
        >
          <ComboboxPopover.Target>
            <Button {...chipProps} aria-label="Count" rightSection={<ChevronDown size={14} />}>
              {input.count || 1} {(input.count || 1) === 1 ? "Image" : "Images"}
            </Button>
          </ComboboxPopover.Target>
        </ComboboxPopover>
      )}
      {references}
      {mask}
      {profile?.capabilities.lora && (
        <LoraPicker value={input} onChange={onChange} picker={loraPicker} />
      )}
      {presets && (
        <Popover
          position="top"
          width={320}
          trapFocus
          opened={presetsOpened}
          onChange={setPresetsOpened}
        >
          <Tooltip label="Presets" disabled={phone || presetsOpened}>
            <Popover.Target>
              <Button
                {...iconChipProps}
                aria-label="Presets"
                onClick={() => setPresetsOpened((opened) => !opened)}
              >
                <Bookmark size={16} />
              </Button>
            </Popover.Target>
          </Tooltip>
          <Popover.Dropdown data-composer-layer aria-label="Presets">
            {presets(() => setPresetsOpened(false))}
          </Popover.Dropdown>
        </Popover>
      )}
      <ExpertSettings input={input} profile={profile} onChange={onChange} {...expert} />
      {onCompare && input.kind === "image" && (
        <Tooltip label="Compare Variants" disabled={phone}>
          <Button {...iconChipProps} aria-label="Compare Variants" onClick={onCompare}>
            <Columns3 size={16} />
          </Button>
        </Tooltip>
      )}
      {input.seed !== "" && profile?.capabilities.seed !== false && (
        <Button
          {...chipProps}
          variant="light"
          aria-label={`Clear Seed ${input.seed}`}
          title="Use a random seed"
          rightSection={<X size={14} />}
          onClick={() => onChange({ seed: "" })}
        >
          Seed {input.seed}
        </Button>
      )}
    </div>
  );
}

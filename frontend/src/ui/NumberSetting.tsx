import { NumberInput } from "@mantine/core";
import { useState } from "react";

/** A whole-number setting saved on blur or Enter; an out-of-range entry snaps back. */
export function NumberSetting({
  label,
  description,
  value,
  min,
  max,
  disabled,
  onSave,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | number>(value);
  const commit = () => {
    const next = Number(draft);
    if (Number.isInteger(next) && next >= min && next <= max && next !== value) onSave(next);
    else setDraft(value);
  };
  return (
    <NumberInput
      label={label}
      description={description}
      value={draft}
      min={min}
      max={max}
      size="sm"
      allowDecimal={false}
      clampBehavior="strict"
      disabled={disabled}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(event) => event.key === "Enter" && commit()}
    />
  );
}

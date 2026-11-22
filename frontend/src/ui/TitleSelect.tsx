import {
  type ComboboxData,
  ComboboxPopover,
  InputBase,
  getOptionsLockup,
  getParsedComboboxData,
} from "@mantine/core";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

/** A compact title selector with a button target so iOS cannot open text AutoFill. */
export function TitleSelect({
  "aria-label": label,
  data,
  value,
  onChange,
  withinPortal,
}: {
  "aria-label": string;
  data: ComboboxData;
  value: string;
  onChange: (value: string) => void;
  withinPortal?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const selected = getOptionsLockup(getParsedComboboxData(data))[value]?.label;
  return (
    <ComboboxPopover
      comboboxProps={{ withinPortal, position: "bottom-start", returnFocus: false }}
      allowDeselect={false}
      checkIconPosition="right"
      data={data}
      dropdownOpened={opened}
      onDropdownOpen={() => setOpened(true)}
      onDropdownClose={() => setOpened(false)}
      maxDropdownHeight="min(640px, 75dvh)"
      value={value}
      onChange={(next) => {
        if (next !== null && next !== value) onChange(next);
      }}
    >
      <ComboboxPopover.Target>
        <InputBase
          component="button"
          type="button"
          aria-label={label}
          size="xs"
          w={180}
          miw={0}
          flex={1}
          pointer
          styles={{
            input: {
              fontSize: "var(--mantine-font-size-md)",
              textAlign: "start",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              overflow: "hidden",
            },
          }}
          rightSection={<ChevronDown size={16} />}
          rightSectionPointerEvents="none"
          onBlur={() => setOpened(false)}
        >
          {selected}
        </InputBase>
      </ComboboxPopover.Target>
    </ComboboxPopover>
  );
}

import { Button, Menu } from "@mantine/core";
import { Check, ChevronDown } from "lucide-react";
import { Fragment, type Ref } from "react";

import { PopupTooltip } from "./PopupTooltip";
import { usePhone } from "./usePhone";

export function ViewMenu<T extends string>({
  label,
  value,
  groups,
  onChange,
  describedBy,
  ref,
}: {
  label: string;
  value: T;
  groups: readonly (readonly { value: T; label: string; disabled?: boolean }[])[];
  onChange: (value: T) => void;
  describedBy?: string;
  ref?: Ref<HTMLButtonElement>;
}) {
  const phone = usePhone();
  const current = groups.flat().find((choice) => choice.value === value);
  return (
    <Menu position="bottom-start">
      <PopupTooltip label={label}>
        <Menu.Target>
          <Button
            ref={ref}
            size={phone ? "compact-sm" : "compact-md"}
            variant="subtle"
            color="gray"
            aria-label={label}
            aria-describedby={describedBy}
            rightSection={<ChevronDown size={14} />}
          >
            {current?.label}
          </Button>
        </Menu.Target>
      </PopupTooltip>
      <Menu.Dropdown>
        {groups.map((choices, index) => (
          <Fragment key={index}>
            {index > 0 && <Menu.Divider />}
            {choices.map((choice) => (
              <Menu.Item
                key={choice.value}
                disabled={choice.disabled}
                rightSection={choice.value === value ? <Check size={14} /> : undefined}
                onClick={() => onChange(choice.value)}
              >
                {choice.label}
              </Menu.Item>
            ))}
          </Fragment>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

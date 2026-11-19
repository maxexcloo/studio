import { ActionIcon, Menu } from "@mantine/core";
import { Check } from "lucide-react";

import { menuWidth } from "../theme";
import { icons } from "./icons";
import { PopupTooltip } from "./PopupTooltip";

export function SortMenu<Sort extends string>({
  label = "Sort",
  labels,
  value,
  onChange,
  withinPortal = false,
}: {
  label?: string;
  labels: Record<Sort, string>;
  value: Sort;
  onChange: (sort: Sort) => void;
  withinPortal?: boolean;
}) {
  return (
    <Menu
      position="bottom-end"
      width={menuWidth}
      withinPortal={withinPortal}
      checkIcon={<Check size={14} />}
    >
      <PopupTooltip label={`Sort: ${labels[value]}`}>
        <Menu.Target>
          <ActionIcon aria-label={label} variant="subtle" color="gray">
            <icons.sort size={18} />
          </ActionIcon>
        </Menu.Target>
      </PopupTooltip>
      <Menu.Dropdown aria-label={label}>
        <Menu.RadioGroup value={value}>
          {(Object.keys(labels) as Sort[]).map((sort) => (
            <Menu.RadioItem key={sort} value={sort} closeMenuOnClick onClick={() => onChange(sort)}>
              {labels[sort]}
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.Dropdown>
    </Menu>
  );
}

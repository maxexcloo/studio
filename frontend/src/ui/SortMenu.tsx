import { ActionIcon, Menu } from "@mantine/core";
import { Fragment, type ReactElement } from "react";

import { menuWidth } from "../theme";
import { icons } from "./icons";
import { ChosenMark } from "./NameWithFlags";
import { PopupTooltip } from "./PopupTooltip";

export const nameSortLabels = {
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
};

export function SortMenu<Sort extends string>({
  label,
  groups,
  value,
  onChange,
  withinPortal = false,
  trigger,
}: {
  label: string;
  groups: readonly Partial<Record<Sort, string>>[];
  value: Sort;
  onChange: (sort: Sort) => void;
  withinPortal?: boolean;
  /** Replaces the subtle icon button, for a toolbar of bordered chips. */
  trigger?: ReactElement;
}) {
  const selected = groups.find((group) => group[value])?.[value];
  return (
    <Menu
      position="bottom-end"
      width={menuWidth}
      withinPortal={withinPortal}
      checkIcon={<ChosenMark chosen />}
    >
      <PopupTooltip label={selected || label}>
        <Menu.Target>
          {trigger ?? (
            <ActionIcon aria-label={label} variant="subtle" color="gray">
              <icons.sort size={18} />
            </ActionIcon>
          )}
        </Menu.Target>
      </PopupTooltip>
      <Menu.Dropdown aria-label={label}>
        <Menu.RadioGroup value={value}>
          {groups.map((group, index) => {
            const choices = Object.entries(group) as [Sort, string][];
            return (
              <Fragment key={choices[0][0]}>
                {index > 0 && <Menu.Divider />}
                {choices.map(([sort, title]) => (
                  <Menu.RadioItem
                    key={sort}
                    value={sort}
                    closeMenuOnClick
                    onClick={() => onChange(sort)}
                  >
                    {title}
                  </Menu.RadioItem>
                ))}
              </Fragment>
            );
          })}
        </Menu.RadioGroup>
      </Menu.Dropdown>
    </Menu>
  );
}
